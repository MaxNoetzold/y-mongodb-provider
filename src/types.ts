import { Binary, ObjectId } from 'mongodb';

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
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	[key: string]: any;
}

export interface DocumentUpdate {
	_id: ObjectId;
	action: string;
	version: string;
	docName: string;
	clock: number;
	value: Binary;
	part?: number;
}
