# Mongodb database adapter for [Yjs](https://github.com/yjs/yjs)

Persistent MongoDB storage for [y-websocket](https://github.com/yjs/y-websocket) server. You can use this adapter to easily store and retrieve Yjs documents in/from MongoDB.

### Notes:

- This was once a fork of the official [y-leveldb](https://github.com/yjs/y-leveldb) but for MongoDB
- This package is not officially supported by the Yjs team.

## Use it (Installation)

You need Node version 16 or newer.

It is available at [npm](https://www.npmjs.com/package/y-mongodb-provider).

```sh
npm i y-mongodb-provider
```

#### Simple Server Example

There are full working server examples in the `example-servers` directory.

```js
import http from 'http';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { MongodbPersistence } from 'y-mongodb-provider';
import yUtils from 'y-websocket/bin/utils';

const server = http.createServer((request, response) => {
	response.writeHead(200, { 'Content-Type': 'text/plain' });
	response.end('okay');
});

// y-websocket
const wss = new WebSocketServer({ server });
wss.on('connection', yUtils.setupWSConnection);

/*
 * y-mongodb-provider
 *  with all possible options (see API section below)
 */
const mdb = new MongodbPersistence(createConnectionString('yjstest'), {
	collectionName: 'transactions',
	flushSize: 100,
	multipleCollections: true,
});

/*
 Persistence must have the following signature:
{ bindState: function(string,WSSharedDoc):void, writeState:function(string,WSSharedDoc):Promise }
*/
yUtils.setPersistence({
	bindState: async (docName, ydoc) => {
		// Here you listen to granular document updates and store them in the database
		// You don't have to do this, but it ensures that you don't lose content when the server crashes
		// See https://github.com/yjs/yjs#Document-Updates for documentation on how to encode
		// document updates

		// official default code from: https://github.com/yjs/y-websocket/blob/37887badc1f00326855a29fc6b9197745866c3aa/bin/utils.js#L36
		const persistedYdoc = await mdb.getYDoc(docName);
		const newUpdates = Y.encodeStateAsUpdate(ydoc);
		mdb.storeUpdate(docName, newUpdates);
		Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedYdoc));
		ydoc.on('update', async (update) => {
			mdb.storeUpdate(docName, update);
		});
	},
	writeState: async (docName, ydoc) => {
		// This is called when all connections to the document are closed.
		// In the future, this method might also be called in intervals or after a certain number of updates.
		return new Promise((resolve) => {
			// When the returned Promise resolves, the document will be destroyed.
			// So make sure that the document really has been written to the database.
			resolve();
		});
	},
});

server.listen(port, () => {
	console.log('listening on port:' + port);
});
```

## API

### `persistence = MongodbPersistence(connectionObj: string|{ client: MongoClient, db: Db }, options: object)`

Create a y-mongodb-provider persistence instance.

```js
import { MongodbPersistence } from 'y-mongodb-provider';

const persistence = new MongodbPersistence(connectionObj, {
	collectionName,
	flushSize,
	multipleCollections,
});
```

`connectionObj` can be a connection string or an object with a client and db property. If you pass a connection string, the client and db will be created for you. [It is recommended to use the object form if you use the same client on other parts of your application as well](https://www.mongodb.com/docs/manual/administration/connection-pool-overview/#create-and-use-a-connection-pool).

Options:

- `collectionName`
  - Name of the collection where all documents are stored
  - Default: `"yjs-writings"`
- `flushSize`
  - The number of transactions needed until they are merged automatically into one document
  - Default: `400`
- `multipleCollections`
  - When set to true, each document gets an own collection (instead of all documents stored in the same one)
  - When set to true, the option collectionName gets ignored.
  - Default: `false`
  - **Note**: When you dont set this setting to true, you should [create an index for your MongoDB collection](https://github.com/MaxNoetzold/y-mongodb-provider?tab=readme-ov-file#indexes).

#### `persistence.getYDoc(docName: string): Promise<Y.Doc>`

Create a Y.Doc instance with the data persistet in MongoDB. Use this to
temporarily create a Yjs document to sync changes or extract data.

#### `persistence.storeUpdate(docName: string, update: Uint8Array): Promise`

Store a single document update to the database.

#### `persistence.getStateVector(docName: string): Promise<Uint8Array>`

The state vector (describing the state of the persisted document - see
[Yjs docs](https://github.com/yjs/yjs#Document-Updates)) is maintained in a separate
field and constantly updated.

This allows you to sync changes without actually creating a Yjs document.

#### `persistence.getDiff(docName: string, stateVector: Uint8Array): Promise<Uint8Array>`

Get the differences directly from the database. The same as
`Y.encodeStateAsUpdate(ydoc, stateVector)`.

#### `persistence.clearDocument(docName: string): Promise`

Delete a document, and all associated data from the database.

#### `persistence.setMeta(docName: string, metaKey: string, value: any): Promise`

Persist some meta information in the database and associate it with a document.
It is up to you what you store here. You could, for example, store credentials
here.

#### `persistence.getMeta(docName: string, metaKey: string): Promise<any|undefined>`

Retrieve a store meta value from the database. Returns undefined if the
`metaKey` doesn't exist.

#### `persistence.delMeta(docName: string, metaKey: string): Promise`

Delete a store meta value.

#### `persistence.getAllDocNames(docName: string): Promise<Array<string>>`

Retrieve the names of all stored documents.

#### `persistence.getAllDocStateVectors(docName: string): Promise<Array<{ name:string,clock:number,sv:Uint8Array}`

Retrieve the state vectors of all stored documents. You can use this to sync
two y-mongodb-provider instances.

!Note: The state vectors might be outdated if the associated document is not
yet flushed. So use with caution.

#### `persistence.flushDocument(docName: string): Promise`

Internally y-mongodb stores incremental updates. You can merge all document
updates to a single entry. You probably never have to use this.

#### `persistence.destroy(): Promise`

Close the database connection for a clean exit.

## Indexes

It is recommended that you create the following [compound index](https://www.mongodb.com/docs/manual/core/indexes/index-types/index-compound/) on your MongoDB collection to improve query performance:

```js
db['yjs-writings'].createIndex({
	version: 1,
	docName: 1,
	action: 1,
	clock: 1,
	part: 1,
});
```

## An other example

```js
yUtils.setPersistence({
	bindState: async (docName, ydoc) => {
		const persistedYdoc = await mdb.getYDoc(docName);
		// get the state vector so we can just store the diffs between client and server
		const persistedStateVector = Y.encodeStateVector(persistedYdoc);

		/* we could also retrieve that sv with a mdb function
		 *  however this takes longer;
		 *  it would also flush the document (which merges all updates into one)
		 *   thats prob a good thing, which is why we always do this on document close (see writeState)
		 */
		//const persistedStateVector = await mdb.getStateVector(docName);

		// in the default code the following value gets saved in the db
		//  this however leads to the case that multiple complete Y.Docs are saved in the db (https://github.com/fadiquader/y-mongodb/issues/7)
		//const newUpdates = Y.encodeStateAsUpdate(ydoc);

		// better just get the differences and save those:
		const diff = Y.encodeStateAsUpdate(ydoc, persistedStateVector);

		// store the new data in db (if there is any: empty update is an array of 0s)
		if (diff.reduce((previousValue, currentValue) => previousValue + currentValue, 0) > 0)
			mdb.storeUpdate(docName, diff);

		// send the persisted data to clients
		Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedYdoc));

		// store updates of the document in db
		ydoc.on('update', async (update) => {
			mdb.storeUpdate(docName, update);
		});

		// cleanup some memory
		persistedYdoc.destroy();
	},
	writeState: async (docName, ydoc) => {
		// This is called when all connections to the document are closed.

		// flush document on close to have the smallest possible database
		await mdb.flushDocument(docName);
	},
});
```

## Contributing

We welcome contributions! Please follow these steps to contribute:

1. Fork the repository.
2. Set up your development environment: `npm install`.
3. Make your changes and ensure tests pass: `npm test`.
4. Submit a pull request with your changes.

### Note about TypeScript

We use type checking and type file generation with JSDoc comments. We do not use TypeScript in this project. We want to keep close to the original Yjs project, which is written in JavaScript. To read more about the decision to use JSDoc comments instead of the more conventional TypeScript, see [this issue](https://discuss.yjs.dev/t/why-are-yjs-types-writen-with-jsdocs-and-not-typescript/2668/3).

If you are adding new functionality, please ensure that you add JSDoc comments to your code.

### Testing

To run the test suite, use the following command:

```sh
npm test
```

## License

y-mongodb-provider is licensed under the [MIT License](./LICENSE).

<max.noetzold@gmail.com>
