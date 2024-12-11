import { RichText } from "@atproto/api";
import { sleep } from "../../utils/helpers";
import { canPerformAction, trackAction } from "../ratelimit/limiter";
import { agent } from "./agent";
import { PostReference } from "./types";

const VERDICT_EMOJIS = {
	True: "\u2705",
	False: "\u274C",
	Misleading: "\u26A0\uFE0F",
	Unverified: "\u2753",
} as const;

export async function formatFactCheckResponse(
	verdict: string,
	explanation: string
): Promise<string> {
	const verdictEmoji = VERDICT_EMOJIS[verdict as keyof typeof VERDICT_EMOJIS];
	return `${verdictEmoji} ${verdict}\n${explanation}`;
}

export async function createPost(
	text: string,
	replyTo?: PostReference
): Promise<PostReference> {
	console.log("[Post] Attempting to create post:", {
		text: text.slice(0, 50) + "...",
		replyTo,
	});

	if (!(await canPerformAction("CREATE"))) {
		throw new Error("Rate limit reached");
	}

	try {
		const richText = new RichText({ text });
		await richText.detectFacets(agent);

		const post = {
			text: richText.text,
			facets: richText.facets,
			...(replyTo && {
				reply: {
					root: { uri: replyTo.uri, cid: replyTo.cid },
					parent: { uri: replyTo.uri, cid: replyTo.cid },
				},
			}),
		};

		const response = await agent.post(post);
		await trackAction("CREATE");

		return {
			uri: response.uri,
			cid: response.cid,
		};
	} catch (error: any) {
		console.error("[Post] Error:", error);
		if (error.response?.status === 429) {
			console.log("[Post] Rate limit exceeded. Waiting before retrying...");
			await sleep(5 * 60 * 1000);
			return createPost(text, replyTo);
		}
		throw error;
	}
}
