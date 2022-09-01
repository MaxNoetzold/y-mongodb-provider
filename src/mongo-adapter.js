import mongojs from "mongojs";
import mongoist from "mongoist";

export class MongoAdapter {
	constructor(location, options) {
		this.location = location;
		this.collection = options.collection;
		this.multipleCollections = options.multipleCollections;
		this.db = null;
		this.open();
	}

	open() {
		let mongojsDb;
		if (this.multipleCollections) {
			mongojsDb = mongojs(this.location);
		} else {
			mongojsDb = mongojs(this.location, [this.collection]);
		}
		this.db = mongoist(mongojsDb);
	}

	_getCollectionName({ docName }) {
		if (this.multipleCollections) {
			return docName;
		} else {
			return this.collection;
		}
	}

	get(query) {
		return this.db[this._getCollectionName(query)].findOne(query);
	}

	put(query, values) {
		if (!query.docName || !query.version || !values.value) {
			throw new Error("Document and version must be provided");
		}

		// findAndModify with upsert:true should simulate leveldb put better
		return this.db[this._getCollectionName(query)].findAndModify({
			query,
			update: { ...query, ...values },
			upsert: true,
		});
	}

	del(query) {
		const bulk = this.db[this._getCollectionName(query)].initializeOrderedBulkOp();
		bulk.find(query).remove();
		return bulk.execute();
	}

	readAsCursor(query, opts = {}) {
		let curs = this.db[this._getCollectionName(query)].findAsCursor(query);
		if (opts.reverse) curs = curs.sort({ clock: -1 });
		if (opts.limit) curs = curs.limit(opts.limit);
		return curs.toArray();
	}

	close() {
		this.db.close();
	}

	getCollectionNames() {
		return this.db.getCollectionNames();
	}

	async flush() {
		await this.db.dropDatabase();
		await this.db.close();
	}
}
