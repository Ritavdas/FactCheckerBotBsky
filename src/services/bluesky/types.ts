export interface NotificationRecord {
	text: string;
	reply?: {
		parent: {
			uri: string;
			cid: string;
		};
	};
}

export interface PostReference {
	uri: string;
	cid: string;
}
