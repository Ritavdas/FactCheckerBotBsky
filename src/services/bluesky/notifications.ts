// @ts-nocheck
import { agent } from "./agent";
import { NotificationRecord } from "./types";
import { createPost } from "./post";
import { queryPerplexity } from "../perplexity/api";
import { canPerformAction } from "../ratelimit/limiter";
import { formatFactCheckResponse } from "./post";

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
				const citationsText = "Sources:\n" + factCheck.citations.join("\n");
				await createPost(citationsText, mainPostData);
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

export async function processNotifications() {
	try {
		const { data } = await agent.listNotifications({ limit: 20 });

		// Get unread notifications count
		const unseenCount = data.notifications.filter((n) => !n.isRead).length;
		console.log(
			"[Notifications] Found",
			data.notifications.length,
			"total notifications"
		);
		console.log("[Notifications] Found", unseenCount, "unseen notifications");

		const factCheckRequests = data.notifications.filter(
			(notif) =>
				notif.reason === "mention" &&
				!notif.isRead &&
				(notif.record as NotificationRecord).text
					.toLowerCase()
					.includes("#factcheck") &&
				(notif.record as NotificationRecord).reply?.parent
		);

		console.log(
			"[Notifications] Filtered",
			factCheckRequests.length,
			"fact check requests"
		);

		for (const request of factCheckRequests) {
			try {
				if (!(await canPerformAction("CREATE"))) {
					console.log(
						"[Notifications] Rate limit reached. Waiting for next cycle."
					);
					break;
				}

				await handleFactCheckRequest(
					(request.record as NotificationRecord).text,
					{ uri: request.uri, cid: request.cid }
				);

				await new Promise((resolve) => setTimeout(resolve, 2000));
			} catch (error) {
				console.error(
					"[Notifications] Error processing notification:",
					request.uri,
					error
				);
				continue;
			}
		}

		await agent.app.bsky.notification.updateSeen({
			seenAt: new Date().toISOString(),
		});
	} catch (error) {
		console.error("[Notifications] Failed to process notifications:", error);
	}
}