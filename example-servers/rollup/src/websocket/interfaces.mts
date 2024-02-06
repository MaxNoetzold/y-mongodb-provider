import * as awarenessProtocol from 'y-protocols/awareness.js';
import * as Y from 'yjs';

export interface IWSSharedDoc extends Y.Doc {
	name: string;
	conns: Map<Object, Set<number>>;
	awareness: awarenessProtocol.Awareness;
}

export interface IPersistence {
	bindState: (arg1: string, arg2: IWSSharedDoc) => void;
	writeState: (arg1: string, arg2: IWSSharedDoc) => Promise<any>;
	provider?: any;
}
