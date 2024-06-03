import * as Y from 'yjs';
import * as binary from 'lib0/binary';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { Buffer } from 'buffer';
import { MongoAdapter } from './mongo-adapter';
import { DocumentUpdate, DocumentUpdateKey } from './types';

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
 * @param {any} db
 * @return {Promise<any>}
 */
export const flushDB = (db: MongoAdapter) => db.flush();

/**
 * @param {any} db
 * @param {string} docName
 * @return {Promise<number>} Returns -1 if this document doesn't exist yet
 */
export const getCurrentUpdateClock = async (db: MongoAdapter, docName: string) => {
	const cursor = db.readAsCursor(
		{
			...createDocumentUpdateKey(docName, 0),
			clock: {
				$gte: 0,
				$lt: binary.BITS32,
			},
		},
		{ reverse: true, limit: 1 },
	);
	const update = await cursor.next();
	return update ? update.clock : -1;
};

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

export const getAllSVDocs = async (db: MongoAdapter) =>
	db.readAsCursor({ version: 'v1_sv' }).toArray() as Promise<DocumentUpdate[]>;

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

export const getYDocFromDb = async (db: MongoAdapter, docName: string, flushSize: number) => {
	const ydoc = new Y.Doc();
	let updatesCount = 0;

	const cursor = await db.readAsCursor(createDocumentUpdateKey(docName));

	// loop through all updates and apply them to the Yjs document
	let currentUpdate: DocumentUpdate | null = (await cursor.next()) as DocumentUpdate | null;
	let parts: DocumentUpdate[] = [];
	while (currentUpdate) {
		// if we have parts stored in the array
		// and the current update has a different clock (aka its a new update),
		// we need to apply the parts
		if (parts.length && parts[0].clock !== currentUpdate.clock) {
			Y.applyUpdate(ydoc, Buffer.concat(parts.map((part) => part.value.buffer)));
			parts = [];
		}

		// if the current update is a part (and in order), we store it in the array
		// NOTE: we expect the parts to be in order, but we check it here just in case
		if (
			(parts.length === 0 && currentUpdate.part === 1) ||
			(parts.length > 0 && currentUpdate.part === (parts[parts.length - 1].part as number) + 1)
		) {
			parts.push(currentUpdate);
		} else {
			Y.applyUpdate(ydoc, currentUpdate.value.buffer);
		}

		updatesCount += 1;
		// eslint-disable-next-line no-await-in-loop
		currentUpdate = (await cursor.next()) as DocumentUpdate | null;
	}
	// when the last update is a part, we need to apply it
	if (parts.length) {
		Y.applyUpdate(ydoc, Buffer.concat(parts.map((part) => part.value.buffer)));
	}

	if (updatesCount > flushSize) {
		await flushDocument(db, docName, Y.encodeStateAsUpdate(ydoc), Y.encodeStateVector(ydoc));
	}

	return ydoc;
};
