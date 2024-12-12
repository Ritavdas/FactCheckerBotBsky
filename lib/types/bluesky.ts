export interface BlueskyNotification {
	id: string;
	record: {
		text: string;
		reply?: {
			parent: {
				uri: string;
				cid: string;
			};
		};
	};
}
