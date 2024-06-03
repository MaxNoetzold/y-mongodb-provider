import { Db, MongoClient, SortDirection } from 'mongodb';
import { DocumentUpdate, Query } from './types';

function parseMongoDBConnectionString(connectionString: string) {
	const url = new URL(connectionString);
	const database = url.pathname.slice(1);
	url.pathname = '/';

	return {
		database,
		linkWithoutDatabase: url.toString(),
	};
}

interface MongoAdapterOptions {
	/**
	 * Name of the collection where all documents are stored.
	 */
	collection: string;
	/**
	 * When set to true, each document gets an own collection
	 * (instead of all documents stored in the same one).
	 * When set to true, the option $collection gets ignored.
	 */
	multipleCollections: boolean;
}

export class MongoAdapter {
	private collection: string;
	private multipleCollections: boolean;
	private mongoUrl: string;
	private databaseName: string;
	private client: MongoClient;
	private db: Db;

	/**
	 * Create a MongoAdapter instance.
	 * @param {string} connectionString
	 * @param {object} opts
	 * @param {string} opts.collection Name of the collection where all documents are stored.
	 * @param {boolean} opts.multipleCollections When set to true, each document gets an own
	 * collection (instead of all documents stored in the same one).
	 * When set to true, the option $collection gets ignored.
	 */
	constructor(connectionString: string, { collection, multipleCollections }: MongoAdapterOptions) {
		this.collection = collection;
		this.multipleCollections = multipleCollections;
		const connectionParams = parseMongoDBConnectionString(connectionString);
		this.mongoUrl = connectionParams.linkWithoutDatabase;
		this.databaseName = connectionParams.database;
		this.client = new MongoClient(this.mongoUrl);
		/*
			client.connect() is optional since v4.7
			"However, MongoClient.connect can still be called manually and remains useful for
			learning about misconfiguration (auth, server not started, connection string correctness)
			early in your application's startup."

			I will not use it for now, but may change that in the future.
		*/
		this.db = this.client.db(this.databaseName);
	}

	/**
	 * Get the MongoDB collection name for any docName
	 * @param {Query} opts
	 * @param {string} opts.docName
	 * @returns {string} collectionName
	 */
	_getCollectionName({ docName }: { docName?: string }) {
		if (!docName && this.multipleCollections) {
			throw new Error(
				'_getCollectionName: docName must be provided when multipleCollections is true',
			);
		}
		if (this.multipleCollections) {
			return docName as string;
		} else {
			return this.collection;
		}
	}

	/**
	 * Apply a $query and get one document from MongoDB.
	 * @param {Query} query
	 * @returns {Promise<DocumentUpdate>}
	 */
	get(query: Query) {
		const collection = this.db.collection(this._getCollectionName(query));
		return collection.findOne(query) as Promise<DocumentUpdate>;
	}

	/**
	 * Store one document in MongoDB.
	 * @param {Query} query
	 * @param {{ value: Uint8Array }} values
	 * @returns {Promise<DocumentUpdate>} Stored document
	 */
	async put(query: Query, values: { value: Uint8Array }) {
		if (!query.docName || !query.version || !values.value) {
			throw new Error('Document and version must be provided');
		}

		const collection = this.db.collection(this._getCollectionName(query));

		await collection.updateOne(query, { $set: values }, { upsert: true });
		return this.get(query) as Promise<DocumentUpdate>;
	}

	/**
	 * Removes all documents that fit the $query
	 * @param {Query} query
	 * @returns {Promise<object>} Contains status of the operation
	 */
	del(query: Query) {
		const collection = this.db.collection(this._getCollectionName(query));

		/*
			Note from mongodb v4.7 release notes:
			"It's a known limitation that explicit sessions (client.startSession) and
			initializeOrderedBulkOp, initializeUnorderedBulkOp cannot be used until
			MongoClient.connect is first called.
			Look forward to a future patch release that will correct these inconsistencies."

			I dont know yet if this is a problem for me here.
		*/
		const bulk = collection.initializeOrderedBulkOp();
		bulk.find(query).delete();
		return bulk.execute();
	}

	// TODO: Actually read as cursor and not as array
	/**
	 * Get all or at least $opts.limit documents that fit the $query.
	 * @param {object} query
	 * @param {object} [opts]
	 * @param {number} [opts.limit]
	 * @param {boolean} [opts.reverse]
	 * @returns {Promise<DocumentUpdate[]>}
	 */
	readAsCursor(query: Query, opts: { limit?: number; reverse?: boolean } = {}) {
		const { limit = 0, reverse = false } = opts;

		const collection = this.db.collection(this._getCollectionName(query));

		const sortQuery: { clock: SortDirection; part: SortDirection } = reverse
			? { clock: -1, part: 1 }
			: { clock: 1, part: 1 };
		const curs = collection.find(query).sort(sortQuery).limit(limit);

		return curs.toArray() as Promise<DocumentUpdate[]>;
	}

	/**
	 * Close connection to MongoDB instance.
	 */
	async close() {
		await this.client.close();
	}

	/**
	 * Get all collection names stored on the MongoDB instance.
	 * @returns {Promise<string[]>}
	 */
	async getCollectionNames() {
		const collectionInfos = await this.db.listCollections().toArray();
		return collectionInfos.map((c) => c.name);
	}

	/**
	 * Delete database
	 */
	async flush() {
		await this.db.dropDatabase();
		await this.client.close();
	}

	/**
	 * Delete collection
	 * @param {string} collectionName
	 */
	dropCollection(collectionName: string) {
		return this.db.collection(collectionName).drop();
	}
}
