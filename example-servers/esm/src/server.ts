import 'dotenv/config';
import http from 'http';
import { WebSocketServer } from 'ws';
import * as Y from 'yjs';
import { MongodbPersistence } from 'y-mongodb-provider';
import { setPersistence, setupWSConnection } from './websocket/utils.js';

import { IWSSharedDoc } from './websocket/interfaces.js';

const server = http.createServer((request, response) => {
	response.writeHead(200, { 'Content-Type': 'text/plain' });
	response.end('okay');
});

// y-websocket
const wss = new WebSocketServer({ server });
wss.on('connection', setupWSConnection);

/*
 * y-mongodb-provider
 */
if (!process.env.MONGO_URL) {
	throw new Error('Please define the MONGO_URL environment variable');
}
const mdb = new MongodbPersistence(process.env.MONGO_URL, {
	flushSize: 100,
	multipleCollections: true,
});

setPersistence({
	bindState: async (docName: string, ydoc: IWSSharedDoc) => {
		const persistedYdoc = await mdb.getYDoc(docName);
		const newUpdates = Y.encodeStateAsUpdate(ydoc);
		mdb.storeUpdate(docName, newUpdates);
		Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedYdoc));
		ydoc.on('update', async (update: Uint8Array) => {
			mdb.storeUpdate(docName, update);
		});
	},
	writeState: (docName: string, ydoc: IWSSharedDoc) => {
		return new Promise((resolve) => {
			resolve(true);
		});
	},
});

server.listen(process.env.PORT, () => {
	console.log('listening on port:' + process.env.PORT);
});
