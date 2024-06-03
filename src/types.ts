import { ObjectId } from 'mongodb';

export interface DocumentUpdateKey {
	version?: string;
	action?: string;
	docName?: string;
	clock?:
		| number
		| {
				$gte: number;
				$lt: number;
		  };
}

export interface Query extends DocumentUpdateKey {
	[key: string]: any;
}

export interface DocumentUpdate {
	_id: ObjectId;
	action: string;
	version: string;
	docName: string;
	clock: number;
	value: Uint8Array;
	part?: number;
}
