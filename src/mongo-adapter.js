import mongoist from 'mongoist';

export class MongoAdapter {
	/**
	 * Create a MongoAdapter instance.
	 * @param {string} location
	 * @param {object} [opts]
	 * @param {string} [opts.collection] Name of the collection where all documents are stored.
	 * @param {boolean} [opts.multipleCollections] When set to true, each document gets an own
	 * collection (instead of all documents stored in the same one).
	 * When set to true, the option $collection gets ignored.
	 */
	constructor(location, { collection, multipleCollections }) {
		this.location = location;
		this.collection = collection;
		this.multipleCollections = multipleCollections;
		this.db = null;
		this.open();
	}

	/**
	 * Open the connection to MongoDB instance.
	 */
	open() {
		this.db = mongoist(this.location);
	}

	/**
	 * Get the MongoDB collection name for any docName
	 * @param {object} [opts]
	 * @param {string} [opts.docName]
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
	 * Apply a $query and get one document from MongoDB.
	 * @param {object} query
	 * @returns {Promise<object>}
	 */
	get(query) {
		return this.db[this._getCollectionName(query)].findOne(query);
	}

	/**
	 * Store one document in MongoDB.
	 * @param {object} query
	 * @param {object} values
	 * @returns {Promise<object>} Stored document
	 */
	put(query, values) {
		if (!query.docName || !query.version || !values.value) {
			throw new Error('Document and version must be provided');
		}

		// findAndModify with upsert:true should simulate leveldb put better
		return this.db[this._getCollectionName(query)].findAndModify({
			query,
			update: { ...query, ...values },
			upsert: true,
			new: true,
		});
	}

	/**
	 * Removes all documents that fit the $query
	 * @param {object} query
	 * @returns {Promise<object>} Contains status of the operation
	 */
	del(query) {
		const bulk = this.db[this._getCollectionName(query)].initializeOrderedBulkOp();
		bulk.find(query).remove();
		return bulk.execute();
	}

	/**
	 * Get all or at least $opts.limit documents that fit the $query.
	 * @param {object} query
	 * @param {object} [opts]
	 * @param {number} [opts.limit]
	 * @param {boolean} [opts.reverse]
	 * @returns {Promise<Array<object>>}
	 */
	readAsCursor(query, { limit, reverse } = {}) {
		let curs = this.db[this._getCollectionName(query)].findAsCursor(query);
		if (reverse) curs = curs.sort({ clock: -1 });
		if (limit) curs = curs.limit(limit);
		return curs.toArray();
	}

	/**
	 * Close connection to MongoDB instance.
	 */
	close() {
		this.db.close();
	}

	/**
	 * Get all collection names stored on the MongoDB instance.
	 * @returns {Promise<Array<string>>}
	 */
	getCollectionNames() {
		return this.db.getCollectionNames();
	}

	/**
	 * Delete database
	 */
	async flush() {
		await this.db.dropDatabase();
		await this.db.close();
	}

	/**
	 * Delete collection
	 * @param {string} collectionName
	 */
	dropCollection(collectionName) {
		return this.db[collectionName].drop();
	}
}
