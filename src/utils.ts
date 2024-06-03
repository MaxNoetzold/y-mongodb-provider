import * as Y from 'yjs';
import * as binary from 'lib0/binary';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { Buffer } from 'buffer';
import { MongoAdapter } from './mongo-adapter';
import { DocumentUpdate, DocumentUpdateKey, Query } from './types';

export const PREFERRED_TRIM_SIZE = 400;
const MAX_DOCUMENT_SIZE = 15000000; // ~15MB (plus space for metadata)

/**
 * Remove all documents from db with Clock between $from and $to
 *
 * @param {MongoAdapter} db
 * @param {string} docName
 * @param {number} from Greater than or equal
 * @param {number} to lower than (not equal)
 * @return {Promise<void>}
 */
export const clearUpdatesRange = async (
	db: MongoAdapter,
	docName: string,
	from: number,
	to: number,
) =>
	db.del({
		docName,
		clock: {
			$gte: from,
			$lt: to,
		},
	});

/**
 * Create a unique key for a update message.
 * @param {string} docName
 * @param {number} [clock] must be unique
 * @return {DocumentUpdateKey}
 */
export const createDocumentUpdateKey = (docName: string, clock?: number) => {
	if (clock !== undefined) {
		return <DocumentUpdateKey>{
			version: 'v1',
			action: 'update',
			docName,
			clock,
		};
	} else {
		return <DocumentUpdateKey>{
			version: 'v1',
			action: 'update',
			docName,
		};
	}
};

/**
 * We have a separate state vector key so we can iterate efficiently over all documents
 * @param {string} docName
 * @return {Object} [opts.docName, opts.version]
 */
export const createDocumentStateVectorKey = (docName: string) => ({
	docName,
	version: 'v1_sv',
});

/**
 * @param {string} docName
 * @param {string} metaKey
 * @return {Object} [opts.docName, opts.version, opts.docType, opts.metaKey]
 */
export const createDocumentMetaKey = (docName: string, metaKey: string) => ({
	version: 'v1',
	docName,
	metaKey: `meta_${metaKey}`,
});

/**
 * @param {MongoAdapter} db
 * @param {Query} query
 * @param {object} opts
 * @return {Promise<DocumentUpdate[]>}
 */
const _getMongoBulkData = (db: MongoAdapter, query: Query, opts: object) =>
	db.readAsCursor(query, opts);

/**
 * @param {any} db
 * @return {Promise<any>}
 */
export const flushDB = (db: MongoAdapter) => db.flush();

/**
 *
 * This function converts MongoDB updates to a buffer that can be processed by the application.
 * It handles both complete documents and large documents that have been split into smaller 'parts' due to MongoDB's size limit.
 * For split documents, it collects all the parts and merges them together.
 * It assumes that the parts of a split document are ordered and located exactly after the document with part number 1.
 *
 * @param {DocumentUpdate[]} docs
 * @return {Buffer[]}
 */
const _convertMongoUpdates = (docs: DocumentUpdate[]) => {
	if (!Array.isArray(docs) || !docs.length) return [];

	const updates: Uint8Array[] = [];
	for (let i = 0; i < docs.length; i++) {
		const doc = docs[i];
		if (!doc.part) {
			/*
                Note: The code works fine without the new Unit8Array() wrapper,
                but it is added to make the code more consistent.
            */
			updates.push(new Uint8Array(doc.value.buffer));
		} else if (doc.part === 1) {
			// merge the docs together that got split because of mongodb size limits
			const parts: Uint8Array[] = [new Uint8Array(doc.value.buffer)];
			let j;
			let currentPartId = doc.part;
			for (j = i + 1; j < docs.length; j++) {
				const part = docs[j];
				if (part.clock === doc.clock) {
					if (!part.part || currentPartId !== part.part - 1) {
						throw new Error('Couldnt merge updates together because a part is missing!');
					}
					parts.push(new Uint8Array(part.value.buffer));
					currentPartId = part.part;
				} else {
					break;
				}
			}
			updates.push(Buffer.concat(parts));
			// set i to j - 1 because we already processed all parts
			i = j - 1;
		}
	}
	return updates;
};

/**
 * Get all document updates for a specific document.
 *
 * @param {any} db
 * @param {string} docName
 * @param {any} [opts]
 */
export const getMongoUpdates = async (db: MongoAdapter, docName: string, opts = {}) => {
	const docs = await _getMongoBulkData(db, createDocumentUpdateKey(docName), opts);
	return _convertMongoUpdates(docs);
};

/**
 * @param {any} db
 * @param {string} docName
 * @return {Promise<number>} Returns -1 if this document doesn't exist yet
 */
export const getCurrentUpdateClock = (db: MongoAdapter, docName: string) =>
	_getMongoBulkData(
		db,
		{
			...createDocumentUpdateKey(docName, 0),
			clock: {
				$gte: 0,
				$lt: binary.BITS32,
			},
		},
		{ reverse: true, limit: 1 },
	).then((updates) => {
		if (updates.length === 0) {
			return -1;
		} else {
			return updates[0].clock;
		}
	});

/**
 * @param {any} db
 * @param {string} docName
 * @param {Uint8Array} sv state vector
 * @param {number} clock current clock of the document so we can determine
 * when this statevector was created
 */
export const writeStateVector = async (
	db: MongoAdapter,
	docName: string,
	sv: Uint8Array,
	clock: number,
) => {
	const encoder = encoding.createEncoder();
	encoding.writeVarUint(encoder, clock);
	encoding.writeVarUint8Array(encoder, sv);
	await db.put(createDocumentStateVectorKey(docName), {
		value: encoding.toUint8Array(encoder),
	});
};

/**
 * @param {any} db
 * @param {string} docName
 * @param {Uint8Array} update
 * @return {Promise<number>} Returns the clock of the stored update
 */
export const storeUpdate = async (db: MongoAdapter, docName: string, update: Uint8Array) => {
	const clock = await getCurrentUpdateClock(db, docName);
	if (clock === -1) {
		// make sure that a state vector is always written, so we can search for available documents
		const ydoc = new Y.Doc();
		Y.applyUpdate(ydoc, update);
		const sv = Y.encodeStateVector(ydoc);
		await writeStateVector(db, docName, sv, 0);
	}

	// mongodb has a maximum document size of 16MB;
	//  if our buffer exceeds it, we store the update in multiple documents
	if (update.length <= MAX_DOCUMENT_SIZE) {
		await db.put(createDocumentUpdateKey(docName, clock + 1), {
			value: update,
		});
	} else {
		const totalChunks = Math.ceil(update.length / MAX_DOCUMENT_SIZE);

		const putPromises: Promise<DocumentUpdate>[] = [];
		for (let i = 0; i < totalChunks; i++) {
			const start = i * MAX_DOCUMENT_SIZE;
			const end = Math.min(start + MAX_DOCUMENT_SIZE, update.length);
			const chunk = update.subarray(start, end);

			putPromises.push(
				db.put({ ...createDocumentUpdateKey(docName, clock + 1), part: i + 1 }, { value: chunk }),
			);
		}

		await Promise.all(putPromises);
	}

	return clock + 1;
};

/**
 * For now this is a helper method that creates a Y.Doc and then re-encodes a document update.
 * In the future this will be handled by Yjs without creating a Y.Doc (constant memory consumption).
 *
 * @param {Uint8Array[]} updates
 * @return {{update:Uint8Array, sv: Uint8Array}}
 */
export const mergeUpdates = (updates: Uint8Array[]) => {
	const ydoc = new Y.Doc();
	ydoc.transact(() => {
		for (let i = 0; i < updates.length; i++) {
			Y.applyUpdate(ydoc, updates[i]);
		}
	});
	return { update: Y.encodeStateAsUpdate(ydoc), sv: Y.encodeStateVector(ydoc) };
};

/**
 * @param {Uint8Array} buf
 * @return {{ sv: Uint8Array, clock: number }}
 */
export const decodeMongodbStateVector = (buf: Uint8Array | { buffer: Uint8Array }) => {
	let decoder;
	if (Buffer.isBuffer(buf)) {
		decoder = decoding.createDecoder(buf);
	} else if (Buffer.isBuffer(buf?.buffer)) {
		decoder = decoding.createDecoder(buf.buffer);
	} else {
		throw new Error('No buffer provided at decodeMongodbStateVector()');
	}
	const clock = decoding.readVarUint(decoder);
	const sv = decoding.readVarUint8Array(decoder);
	return { sv, clock };
};

/**
 * @param {any} db
 * @param {string} docName
 */
export const readStateVector = async (db: MongoAdapter, docName: string) => {
	const doc = await db.get({ ...createDocumentStateVectorKey(docName) });
	if (!doc?.value) {
		// no state vector created yet or no document exists
		return { sv: null, clock: -1 };
	}
	return decodeMongodbStateVector(doc.value);
};

export const getAllSVDocs = async (db: MongoAdapter) => db.readAsCursor({ version: 'v1_sv' });

/**
 * Merge all MongoDB documents of the same yjs document together.
 * @param {any} db
 * @param {string} docName
 * @param {Uint8Array} stateAsUpdate
 * @param {Uint8Array} stateVector
 * @return {Promise<number>} returns the clock of the flushed doc
 */
export const flushDocument = async (
	db: MongoAdapter,
	docName: string,
	stateAsUpdate: Uint8Array,
	stateVector: Uint8Array,
) => {
	const clock = await storeUpdate(db, docName, stateAsUpdate);
	await writeStateVector(db, docName, stateVector, clock);
	await clearUpdatesRange(db, docName, 0, clock);
	return clock;
};
