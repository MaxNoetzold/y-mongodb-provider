import { MongoClient } from 'mongodb';

/**
 * Parse a MongoDB connection string and return the database name
 * and the connection string without the database name.
 *
 * @param {string} connectionString
 * @returns {{ database: string, linkWithoutDatabase: string }}
 */
function parseMongoDBConnectionString(connectionString) {
	const url = new URL(connectionString);
	const database = url.pathname.slice(1);
	url.pathname = '/';

	return {
		database,
		linkWithoutDatabase: url.toString(),
	};
}

export class MongoAdapter {
	/**
	 * Create a MongoAdapter instance.
	 * @param {string} connectionString
	 * @param {object} opts
	 * @param {string} opts.collection Name of the collection where all documents are stored.
	 * @param {boolean} opts.multipleCollections When set to true, each document gets an own
	 * collection (instead of all documents stored in the same one).
	 * When set to true, the option $collection gets ignored.
	 */
	constructor(connectionString, { collection, multipleCollections }) {
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
	 * @param {import('mongodb').Filter<import('mongodb').Document>} query
	 * @returns {string} collectionName
	 */
	_getCollectionName({ docName }) {
		if (this.multipleCollections) {
			return docName;
		} else {
			return this.collection;
		}
	}

	/**
	 *
	 * @param {import('mongodb').Filter<import('mongodb').Document>} query
	 * @param {{limit?: number; reverse?: boolean;}} [options]
	 * @returns {Promise<import('mongodb').WithId<import('mongodb').Document>[]>}
	 */
	find(query, options) {
		const { limit = 0, reverse = false } = options || {};

		/** @type {{ clock: 1 | -1, part: 1 | -1 }} */
		const sortQuery = reverse ? { clock: -1, part: 1 } : { clock: 1, part: 1 };

		const collection = this.db.collection(this._getCollectionName(query));
		return collection.find(query, { limit, sort: sortQuery }).toArray();
	}

	/**
	 * Apply a $query and get one document from MongoDB.
	 * @param {import('mongodb').Filter<import('mongodb').Document>} query
	 * @param {{limit?: number; reverse?: boolean;}} [options]
	 * @returns {Promise<import('mongodb').WithId<import('mongodb').Document> | null>}
	 */
	findOne(query, options) {
		return this.find(query, options).then((docs) => docs[0] || null);
	}

	/**
	 * Store one document in MongoDB.
	 * @param {import('mongodb').Filter<import('mongodb').Document>} query
	 * @param {import('mongodb').UpdateFilter<import('mongodb').Document>} values
	 * @returns {Promise<import('mongodb').WithId<import('mongodb').Document> | null>} Stored document
	 */
	async put(query, values) {
		if (!query.docName || !query.version || !values.value) {
			throw new Error('Document and version must be provided');
		}

		const collection = this.db.collection(this._getCollectionName(query));

		await collection.updateOne(query, { $set: values }, { upsert: true });
		return this.findOne(query);
	}

	/**
	 * Removes all documents that fit the $query
	 * @param {import('mongodb').Filter<import('mongodb').Document>} query
	 * @returns {Promise<import('mongodb').BulkWriteResult>} Contains status of the operation
	 */
	delete(query) {
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
	dropCollection(collectionName) {
		return this.db.collection(collectionName).drop();
	}
}
