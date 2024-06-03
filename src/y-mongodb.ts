import * as Y from 'yjs';
import * as binary from 'lib0/binary';
import { MongoAdapter } from './mongo-adapter';
import {
	PREFERRED_TRIM_SIZE,
	clearUpdatesRange,
	createDocumentMetaKey,
	createDocumentStateVectorKey,
	decodeMongodbStateVector,
	flushDB,
	flushDocument,
	getAllSVDocs,
	getCurrentUpdateClock,
	getMongoUpdates,
	mergeUpdates,
	readStateVector,
	storeUpdate,
} from './utils';

interface MongodbPersistenceOptions {
	/**
	 * Name of the collection where all documents are stored.
	 *
	 * Default: "yjs-writings"
	 */
	collectionName?: string;
	/**
	 * When set to true, each document gets an own collection
	 * (instead of all documents stored in the same one).
	 * In this case, the option collectionName gets ignored.
	 *
	 * Default: false
	 */
	multipleCollections?: boolean;
	/**
	 * The number of stored transactions needed until they are merged
	 * automatically into one Mongodb document.
	 *
	 * Default: 400
	 */
	flushSize?: number;
}

export class MongodbPersistence {
	private flushSize: number;
	private multipleCollections: boolean;
	private tr: { [docName: string]: Promise<any> };
	private _transact: <T>(docName: string, f: (db: MongoAdapter) => Promise<T>) => Promise<T>;

	/**
	 * Create a y-mongodb persistence instance.
	 * @param {string} location The connection string for the MongoDB instance.
	 * @param {MongodbPersistenceOptions} [opts] Additional optional parameters.
	 */
	constructor(location: string, opts: MongodbPersistenceOptions = {}) {
		const { collectionName = 'yjs-writings', multipleCollections = false, flushSize = 400 } = opts;
		if (typeof collectionName !== 'string' || !collectionName) {
			throw new Error(
				'Constructor option "collectionName" is not a valid string. Either dont use this option (default is "yjs-writings") or use a valid string! Take a look into the Readme for more information: https://github.com/MaxNoetzold/y-mongodb-provider#persistence--mongodbpersistenceconnectionlink-string-options-object',
			);
		}
		if (typeof multipleCollections !== 'boolean') {
			throw new Error(
				'Constructor option "multipleCollections" is not a boolean. Either dont use this option (default is "false") or use a valid boolean! Take a look into the Readme for more information: https://github.com/MaxNoetzold/y-mongodb-provider#persistence--mongodbpersistenceconnectionlink-string-options-object',
			);
		}
		if (typeof flushSize !== 'number' || flushSize <= 0) {
			throw new Error(
				'Constructor option "flushSize" is not a valid number. Either dont use this option (default is "400") or use a valid number larger than 0! Take a look into the Readme for more information: https://github.com/MaxNoetzold/y-mongodb-provider#persistence--mongodbpersistenceconnectionlink-string-options-object',
			);
		}
		const db = new MongoAdapter(location, {
			collection: collectionName,
			multipleCollections,
		});
		this.flushSize = flushSize ?? PREFERRED_TRIM_SIZE;
		this.multipleCollections = multipleCollections;

		// scope the queue of the transaction to each docName
		// -> this should allow concurrency for different rooms
		// Idea and adjusted code from: https://github.com/fadiquader/y-mongodb/issues/10
		this.tr = {};

		/**
		 * Execute an transaction on a database. This will ensure that other processes are
		 * currently not writing.
		 *
		 * This is a private method and might change in the future.
		 *
		 * @template T
		 *
		 * @param {function(any):Promise<T>} f A transaction that receives the db object
		 * @return {Promise<T>}
		 */
		this._transact = <T>(
			docName: string,
			f: (dbAdapter: MongoAdapter) => Promise<T>,
		): Promise<T> => {
			if (!this.tr[docName]) {
				this.tr[docName] = Promise.resolve();
			}

			const currTr = this.tr[docName];
			let nextTr: Promise<T | null> | null = null;

			nextTr = (async () => {
				await currTr;

				let res: T | null = null;
				try {
					res = await f(db);
				} catch (err) {
					// eslint-disable-next-line no-console
					console.warn('Error during saving transaction', err);
				}

				// once the last transaction for a given docName resolves, remove it from the queue
				if (this.tr[docName] === nextTr) {
					delete this.tr[docName];
				}

				return res;
			})();

			this.tr[docName] = nextTr;

			return this.tr[docName];
		};
	}

	/**
	 * Create a Y.Doc instance with the data persistet in mongodb.
	 * Use this to temporarily create a Yjs document to sync changes or extract data.
	 *
	 * @param {string} docName
	 * @return {Promise<Y.Doc>}
	 */
	getYDoc(docName: string) {
		return this._transact(docName, async (db) => {
			const updates = await getMongoUpdates(db, docName);
			const ydoc = new Y.Doc();
			ydoc.transact(() => {
				for (let i = 0; i < updates.length; i++) {
					Y.applyUpdate(ydoc, updates[i]);
				}
			});
			if (updates.length > this.flushSize) {
				await flushDocument(db, docName, Y.encodeStateAsUpdate(ydoc), Y.encodeStateVector(ydoc));
			}
			return ydoc;
		});
	}

	/**
	 * Store a single document update to the database.
	 *
	 * @param {string} docName
	 * @param {Uint8Array} update
	 * @return {Promise<number>} Returns the clock of the stored update
	 */
	storeUpdate(docName: string, update: Uint8Array) {
		return this._transact(docName, (db) => storeUpdate(db, docName, update));
	}

	/**
	 * The state vector (describing the state of the persisted document - see https://github.com/yjs/yjs#Document-Updates) is maintained in a separate field and constantly updated.
	 *
	 * This allows you to sync changes without actually creating a Yjs document.
	 *
	 * @param {string} docName
	 * @return {Promise<Uint8Array>}
	 */
	getStateVector(docName: string) {
		return this._transact(docName, async (db) => {
			const { clock, sv } = await readStateVector(db, docName);
			let curClock = -1;
			if (sv !== null) {
				curClock = await getCurrentUpdateClock(db, docName);
			}
			if (sv !== null && clock === curClock) {
				return sv;
			} else {
				// current state vector is outdated
				const updates = await getMongoUpdates(db, docName);
				const { update, sv: newSv } = mergeUpdates(updates);
				await flushDocument(db, docName, update, newSv);
				return newSv;
			}
		});
	}

	/**
	 * Get the differences directly from the database.
	 * The same as Y.encodeStateAsUpdate(ydoc, stateVector).
	 * @param {string} docName
	 * @param {Uint8Array} stateVector
	 */
	async getDiff(docName: string, stateVector: Uint8Array) {
		const ydoc = await this.getYDoc(docName);
		return Y.encodeStateAsUpdate(ydoc, stateVector);
	}

	/**
	 * Delete a document, and all associated data from the database.
	 * When option multipleCollections is set, it removes the corresponding collection
	 * @param {string} docName
	 * @return {Promise<void>}
	 */
	clearDocument(docName: string) {
		return this._transact(docName, async (db) => {
			if (!this.multipleCollections) {
				await db.del(createDocumentStateVectorKey(docName));
				await clearUpdatesRange(db, docName, 0, binary.BITS32);
			} else {
				await db.dropCollection(docName);
			}
		});
	}

	/**
	 * Persist some meta information in the database and associate it
	 * with a document. It is up to you what you store here.
	 * You could, for example, store credentials here.
	 *
	 * @param {string} docName
	 * @param {string} metaKey
	 * @param {any} value
	 * @return {Promise<void>}
	 */
	setMeta(docName: string, metaKey: string, value: any) {
		/*	Unlike y-leveldb, we simply store the value here without encoding
	 		 it in a buffer beforehand. */
		return this._transact(docName, async (db) => {
			await db.put(createDocumentMetaKey(docName, metaKey), { value });
		});
	}

	/**
	 * Retrieve a store meta value from the database. Returns undefined if the
	 * metaKey doesn't exist.
	 *
	 * @param {string} docName
	 * @param {string} metaKey
	 * @return {Promise<any>}
	 */
	getMeta(docName: string, metaKey: string) {
		return this._transact(docName, async (db) => {
			const res = await db.get({
				...createDocumentMetaKey(docName, metaKey),
			});
			if (!res?.value) {
				return undefined;
			}
			return res.value;
		});
	}

	/**
	 * Delete a store meta value.
	 *
	 * @param {string} docName
	 * @param {string} metaKey
	 * @return {Promise<any>}
	 */
	delMeta(docName: string, metaKey: string) {
		return this._transact(docName, (db) =>
			db.del({
				...createDocumentMetaKey(docName, metaKey),
			}),
		);
	}

	/**
	 * Retrieve the names of all stored documents.
	 *
	 * @return {Promise<string[]>}
	 */
	getAllDocNames() {
		return this._transact('global', async (db) => {
			if (this.multipleCollections) {
				// get all collection names from db
				return db.getCollectionNames();
			} else {
				// when all docs are stored in the same collection we just need to get all
				//  statevectors and return their names
				const docs = await getAllSVDocs(db);
				return docs.map((doc) => doc.docName);
			}
		});
	}

	/**
	 * Retrieve the state vectors of all stored documents.
	 * You can use this to sync two y-mongodb instances.
	 * !Note: The state vectors might be outdated if the associated document
	 * is not yet flushed. So use with caution.
	 * @return {Promise<{ name: string, sv: Uint8Array, clock: number }[]>}
	 * @todo may not work?
	 */
	getAllDocStateVectors() {
		return this._transact('global', async (db) => {
			const docs = await getAllSVDocs(db);
			return docs.map((doc) => {
				const { sv, clock } = decodeMongodbStateVector(doc.value);
				return { name: doc.docName, sv, clock };
			});
		});
	}

	/**
	 * Internally y-mongodb stores incremental updates. You can merge all document
	 * updates to a single entry. You probably never have to use this.
	 * It is done automatically every $options.flushsize (default 400) transactions.
	 *
	 * @param {string} docName
	 * @return {Promise<void>}
	 */
	flushDocument(docName: string) {
		return this._transact(docName, async (db) => {
			const updates = await getMongoUpdates(db, docName);
			const { update, sv } = mergeUpdates(updates);
			await flushDocument(db, docName, update, sv);
		});
	}

	/**
	 * Delete the whole yjs mongodb
	 * @return {Promise<void>}
	 */
	flushDB() {
		return this._transact('global', async (db) => {
			await flushDB(db);
		});
	}

	/**
	 * Closes open database connection
	 * @returns {Promise<void>}
	 */
	destroy() {
		return this._transact('global', async (db) => {
			await db.close();
		});
	}
}
