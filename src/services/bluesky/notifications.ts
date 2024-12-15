// @ts-nocheck
import { agent } from "./agent";
import { NotificationRecord } from "./types";
import { createPost } from "./post";
import { queryPerplexity } from "../perplexity/api";
import { canPerformAction } from "../ratelimit/limiter";
import { formatFactCheckResponse } from "./post";
import { sleep } from "../../utils/helpers";

const MAX_POST_LENGTH = 300;

function splitCitationsForPosts(citations: string[]): string[] {
	const posts: string[] = [];
	let currentPost = "Sources:\n";
	let currentNumber = 1;

	for (const citation of citations) {
		const nextCitation = `${currentNumber}. ${citation}\n`;

		if ((currentPost + nextCitation).length > MAX_POST_LENGTH) {
			// Save current post if it has content
			if (currentPost !== "Sources:\n") {
				posts.push(currentPost.trim());
			}
			// Start new post
			currentPost = `Sources (cont.):\n${nextCitation}`;
		} else {
			currentPost += nextCitation;
		}
		currentNumber++;
	}

	// Add final post if it has content
	if (currentPost !== "Sources:\n") {
		posts.push(currentPost.trim());
	}

	return posts;
}
async function handleMoreInfoRequest(
	text: string,
	replyTo?: { uri: string; cid: string }
) {
	try {
		if (!replyTo) throw new Error("No reply context provided");

		const threadResponse = await agent.getPostThread({ uri: replyTo.uri });
		const threadView = threadResponse.data.thread;

		if ("parent" in threadView && threadView.parent?.post?.record.text) {
			const contentToCheck = threadView.parent.post.record.text;
			const infoResponse = (await queryPerplexity(
				contentToCheck,
				"moreinfo"
			)) as InfoResponse;

			// Main info post
			const mainPostData = await createPost(infoResponse.mainInfo, replyTo);

			// Citations if they exist
			if (infoResponse.sources?.length) {
				const citationsText = splitCitationsForPosts(infoResponse.sources);
				for (const citation of citationsText) {
					await createPost(citation, mainPostData);
					await sleep(1000);
				}
			}
		}
	} catch (error) {
		console.error("[Handler] Error:", error);
		await createPost(
			"I apologize, but I encountered an error. Please try again later.",
			replyTo
		);
	}
}
export async function handleFactCheckRequest(
	text: string,
	replyTo?: { uri: string; cid: string }
) {
	try {
		if (!replyTo) {
			throw new Error("No reply context provided");
		}

		const threadResponse = await agent.getPostThread({ uri: replyTo.uri });
		const threadView = threadResponse.data.thread;

		if ("parent" in threadView && threadView.parent?.post?.record.text) {
			const contentToCheck = threadView.parent.post.record.text;
			const factCheck = await queryPerplexity(contentToCheck);

			// Main fact-check response
			const mainResponse = await formatFactCheckResponse(
				factCheck.verdict,
				factCheck.explanation
			);
			const mainPostData = await createPost(mainResponse, replyTo);

			// Post citations if they exist
			if (factCheck.citations?.length) {
				let lastPostRef = mainPostData;
				const citationPosts = splitCitationsForPosts(factCheck.citations);

				for (const citationPost of citationPosts) {
					lastPostRef = await createPost(citationPost, lastPostRef);
					// Add small delay between posts to avoid rate limiting
					await sleep(1000);
				}
			}
		} else {
			throw new Error("Failed to fetch parent post");
		}
	} catch (error) {
		console.error("[Handler] Error:", error);
		const errorResponse =
			"I apologize, but I encountered an error while fact-checking. Please try again later.";
		await createPost(errorResponse, replyTo);
	}
}
const processedNotifications = new Set<string>();

export async function processNotifications() {
	try {
		const { data } = await agent.listNotifications({ limit: 1 });

		const unprocessedNotifications = data.notifications.filter(
			(notif) => !processedNotifications.has(notif.uri)
		);
		
		// for (const notif of unprocessedNotifications) {
		// 	// Process notification
		// 	processedNotifications.add(notif.uri);
		// }
		// Get unread notifications count
		const unseenCount = unprocessedNotifications.filter((n) => !n.isRead).length;
		console.log(
			"[Notifications] Found",
			unprocessedNotifications.length,
			"total notifications"
		);
		console.log("[Notifications] Found", unseenCount, "unseen notifications");

		// Handle factcheck requests
		const factCheckRequests = unprocessedNotifications.filter(
			(notif) =>
				notif.reason === "mention" &&
				!notif.isRead &&
				(notif.record as NotificationRecord).text
					.toLowerCase()
					.includes("#factcheck") &&
				(notif.record as NotificationRecord).reply?.parent
		);

		// Handle moreinfo requests
		const moreInfoRequests = unprocessedNotifications.filter(
			(notif) =>
				notif.reason === "mention" &&
				!notif.isRead &&
				(notif.record as NotificationRecord).text
					.toLowerCase()
					.includes("#moreinfo") &&
				(notif.record as NotificationRecord).reply?.parent
		);

		console.log(
			"[Notifications] Filtered",
			factCheckRequests.length,
			"fact check requests"
		);
		console.log(
			"[Notifications] Filtered",
			moreInfoRequests.length,
			"more info requests"
		);

		// Process fact checks
		for (const request of factCheckRequests) {
			try {
				if (!(await canPerformAction("CREATE"))) {
					console.log(
						"[Notifications] Rate limit reached. Waiting for next cycle."
					);
					break;
				}
				processedNotifications.add(request.uri);

				await handleFactCheckRequest(
					(request.record as NotificationRecord).text,
					{ uri: request.uri, cid: request.cid }
				);

				await agent.app.bsky.notification.updateSeen({
					seenAt: new Date().toISOString(),
				});

                await sleep(2000);

				// await new Promise((resolve) => setTimeout(resolve, 2000));
			} catch (error) {
				console.error(
					"[Notifications] Error processing notification:",
					request.uri,
					error
				);
				continue;
			}
		}

		// Process more info requests
		for (const request of moreInfoRequests) {
			try {
				if (!(await canPerformAction("CREATE"))) {
					console.log(
						"[Notifications] Rate limit reached. Waiting for next cycle."
					);
					break;
				}
				await agent.app.bsky.notification.updateSeen({
					seenAt: new Date().toISOString(),
				});

				processedNotifications.add(request.uri);

				await handleMoreInfoRequest(
					(request.record as NotificationRecord).text,
					{ uri: request.uri, cid: request.cid }
				);

				await sleep(2000);
			} catch (error) {
				console.error(
					"[Notifications] Error processing notification:",
					request.uri,
					error
				);
				continue;
			}
		}

		if (unprocessedNotifications.length > 0) {
			await agent.app.bsky.notification.updateSeen({
				seenAt: new Date().toISOString(),
			});
		}
	} catch (error) {
		console.error("[Notifications] Failed to process notifications:", error);
	}
}
