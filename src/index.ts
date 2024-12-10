// @ts-nocheck
import { BskyAgent, RichText } from "@atproto/api";
import * as dotenv from "dotenv";
import { CronJob } from "cron";
import * as fs from "fs/promises";
import * as path from "path";
import express from "express";
import * as readline from "readline";

dotenv.config();

const PORT = process.env.PORT || 3000;

interface PerplexityResponse {
	verdict: "True" | "False" | "Misleading" | "Unverified";
	explanation: string;
	source?: string;
}

interface NotificationRecord {
	text: string;
	reply?: {
		parent: {
			uri: string;
			cid: string;
		};
	};
}

const RATE_LIMITS = {
	HOURLY_POINTS: 5000,
	DAILY_POINTS: 35000,
	ACTION_COSTS: {
		CREATE: 3,
		UPDATE: 2,
		DELETE: 1,
	},
} as const;

const RATE_LIMIT_FILE = path.join(__dirname, "ratelimit.json");

interface SessionData {
	did: string;
	handle: string;
	email?: string;
	accessJwt: string;
	refreshJwt: string;
}

async function saveSession(session: SessionData) {
	try {
		await fs.writeFile(
			path.join(__dirname, "session.json"),
			JSON.stringify(session)
		);
	} catch (error) {
		console.error("[Session] Failed to save session:", error);
	}
}

async function loadSession(): Promise<SessionData | null> {
	try {
		const data = await fs.readFile(
			path.join(__dirname, "session.json"),
			"utf-8"
		);
		return JSON.parse(data);
	} catch {
		return null;
	}
}

async function ensureAuth(): Promise<boolean> {
	try {
		// Try to resume from saved session
		const session = await loadSession();
		if (session) {
			console.log(
				"[Auth] Attempting to resume session for:",
				session.handle
			);
			agent.session = session;

			// Verify if session is still valid
			try {
				await agent.getProfile({ actor: session.handle });
				console.log("[Auth] Successfully resumed session");
				return true;
			} catch (error) {
				console.log("[Auth] Session expired, needs refresh");
			}
		}

		// If no session or session invalid, perform fresh login
		console.log("[Auth] Performing fresh login");
		const result = await agent.login({
			identifier: process.env.BLUESKY_USERNAME!,
			password: process.env.BLUESKY_PASSWORD!,
		});

		await saveSession(result.data);
		console.log("[Auth] New login successful");
		return true;
	} catch (error) {
		console.error("[Auth] Login failed:", error);
		return false;
	}
}

async function loadRateLimit() {
	console.log("[RateLimit] Loading rate limit data");
	try {
		const data = await fs.readFile(RATE_LIMIT_FILE, "utf8");
		const parsed = JSON.parse(data);
		console.log("[RateLimit] Current limits:", parsed);
		return parsed;
	} catch {
		console.log("[RateLimit] No existing rate limit file, creating new one");
		return {
			hourlyPoints: 0,
			dailyPoints: 0,
			lastHourReset: new Date().toISOString(),
			lastDayReset: new Date().toISOString(),
		};
	}
}

async function saveRateLimit(rateLimit: any) {
	console.log("[RateLimit] Saving rate limit data:", rateLimit);
	await fs.writeFile(RATE_LIMIT_FILE, JSON.stringify(rateLimit, null, 2));
}

async function checkAndResetCounters() {
	console.log("[RateLimit] Checking counters");
	const rateLimit = await loadRateLimit();
	const now = new Date();
	const lastHourReset = new Date(rateLimit.lastHourReset);
	const lastDayReset = new Date(rateLimit.lastDayReset);
	let updated = false;

	if (now.getTime() - lastHourReset.getTime() > 3600000) {
		console.log("[RateLimit] Resetting hourly points");
		rateLimit.hourlyPoints = 0;
		rateLimit.lastHourReset = now.toISOString();
		updated = true;
	}

	if (now.getTime() - lastDayReset.getTime() > 86400000) {
		console.log("[RateLimit] Resetting daily points");
		rateLimit.dailyPoints = 0;
		rateLimit.lastDayReset = now.toISOString();
		updated = true;
	}

	if (updated) {
		await saveRateLimit(rateLimit);
	}
	return rateLimit;
}

async function canPerformAction(
	action: keyof typeof RATE_LIMITS.ACTION_COSTS
): Promise<boolean> {
	const rateLimit = await checkAndResetCounters();
	const cost = RATE_LIMITS.ACTION_COSTS[action];
	const canPerform =
		rateLimit.hourlyPoints + cost <= RATE_LIMITS.HOURLY_POINTS &&
		rateLimit.dailyPoints + cost <= RATE_LIMITS.DAILY_POINTS;

	console.log(`[RateLimit] Checking if can perform ${action}:`, {
		hourlyPoints: rateLimit.hourlyPoints,
		dailyPoints: rateLimit.dailyPoints,
		cost,
		canPerform,
	});

	return canPerform;
}

async function trackAction(action: keyof typeof RATE_LIMITS.ACTION_COSTS) {
	console.log(`[RateLimit] Tracking action: ${action}`);
	const rateLimit = await loadRateLimit();
	const cost = RATE_LIMITS.ACTION_COSTS[action];
	rateLimit.hourlyPoints += cost;
	rateLimit.dailyPoints += cost;
	console.log("[RateLimit] Updated points:", {
		hourlyPoints: rateLimit.hourlyPoints,
		dailyPoints: rateLimit.dailyPoints,
	});
	await saveRateLimit(rateLimit);
}

async function queryPerplexity(text: string): Promise<PerplexityResponse> {
	console.log(
		"[Perplexity] Querying API with text:",
		text.slice(0, 100) + "..."
	);
	try {
		const response = await fetch(
			"https://api.perplexity.ai/chat/completions",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "llama-3.1-sonar-small-128k-online",
					messages: [
						{
							role: "system",
							content:
								"You are a fact-checker. Provide a verdict (True/False/Misleading/Unverified), brief explanation (<200 chars), and one key source. Format: {verdict}|{explanation}|{source}",
						},
						{
							role: "user",
							content: text,
						},
					],
				}),
			}
		);

		const data = await response.json();
		console.log("[Perplexity] Raw API response:", data);

		const [verdict, explanation, source] =
			data.choices[0].message.content.split("|");

		const result = {
			verdict: verdict.trim() as PerplexityResponse["verdict"],
			explanation: explanation.trim(),
			source: source?.trim(),
		};
		console.log("[Perplexity] Parsed response:", result);
		return result;
	} catch (error) {
		console.error("[Perplexity] API Error:", error);
		throw error;
	}
}

const agent = new BskyAgent({
	service: "https://bsky.social",
});

async function formatFactCheckResponse(
	factCheck: PerplexityResponse,
	originalText: string
): Promise<string> {
	console.log("[Format] Formatting response for:", {
		verdict: factCheck.verdict,
		originalText: originalText.slice(0, 50) + "...",
	});

	const verdictEmoji = {
		True: "✅",
		False: "❌",
		Misleading: "⚠️",
		Unverified: "❓",
	}[factCheck.verdict];

	const response = `${verdictEmoji} ${factCheck.verdict}\n${
		factCheck.explanation
	}${factCheck.source ? `\nSource: ${factCheck.source}` : ""}`.slice(0, 290);
	console.log("[Format] Formatted response:", response);
	return response;
}

async function handleFactCheckRequest(
	text: string,
	replyTo?: { uri: string; cid: string }
) {
	console.log("[Handler] Processing fact check request:", {
		text: text.slice(0, 100),
		replyTo,
	});

	try {
		if (!replyTo) {
			throw new Error("No reply context provided");
		}

		console.log("[Handler] Fetching thread");
		const threadResponse = await agent.getPostThread({
			uri: replyTo.uri,
		});

		const threadView = threadResponse.data.thread;
		if ("parent" in threadView && threadView.parent?.post?.record.text) {
			const contentToCheck = threadView.parent.post.record.text;
			console.log(
				"[Handler] Found parent post content:",
				contentToCheck.slice(0, 100)
			);

			const factCheck = await queryPerplexity(contentToCheck);
			const response = await formatFactCheckResponse(
				factCheck,
				contentToCheck
			);
			await createPost(response, replyTo);
		} else {
			console.log("[Handler] No parent post found in thread");
			throw new Error("Failed to fetch parent post");
		}
	} catch (error) {
		console.error("[Handler] Error:", error);
		const errorResponse =
			"I apologize, but I encountered an error while fact-checking. Please try again later.";
		await createPost(errorResponse, replyTo);
	}
}

async function createPost(
	text: string,
	replyTo?: { uri: string; cid: string }
) {
	console.log("[Post] Attempting to create post:", {
		text: text.slice(0, 50) + "...",
		replyTo,
	});

	if (!(await canPerformAction("CREATE"))) {
		console.log("[Post] Rate limit reached. Skipping post.");
		return;
	}

	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	try {
		const confirm = await new Promise((resolve) => {
			rl.question("Create post? (Y/N): ", (answer) => {
				rl.close();
				resolve(answer.toLowerCase() === "y");
			});
		});

		if (!confirm) {
			console.log("[Post] Post creation cancelled by user");
			return;
		}

		console.log("[Post] Creating RichText");
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

		console.log("[Post] Sending post to Bluesky");
		await agent.post(post);
		await trackAction("CREATE");
		console.log("[Post] Successfully posted:", text.slice(0, 50) + "...");
	} catch (error: any) {
		console.error("[Post] Error:", error);
		if (error.response?.status === 429) {
			console.log("[Post] Rate limit exceeded. Waiting before retrying...");
			await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
		}
	}
}

async function processNotifications() {
	console.log("[Notifications] Starting notification processing");
	try {
		const { data } = await agent.listNotifications({ limit: 20 });
		console.log(
			"[Notifications] Found",
			data.notifications.length,
			"notifications"
		);

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
				console.log("[Notifications] Processing request:", request.uri);

				if (!(await canPerformAction("CREATE"))) {
					console.log(
						"[Notifications] Rate limit reached. Waiting for next cycle."
					);
					break;
				}

				// First mark notification as seen
				console.log(
					"[Notifications] Marking notification as seen:",
					request.uri
				);
				console.log(
					"[Notifications] Current time:",
					new Date().toISOString()
				);

				agent.app.bsky.notification.updateSeen({
					seenAt: new Date().toISOString(),
				});

				// Then process and create the post
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
	} catch (error) {
		console.error("[Notifications] Failed to process notifications:", error);
	}
}

async function main() {
	console.log("[Main] Starting bot");
	try {
		// Only proceed if auth is successful
		if (await ensureAuth()) {
			await processNotifications();
		} else {
			console.log("[Main] Auth failed, retrying in 5 minutes");
			setTimeout(main, 5 * 60 * 1000);
		}
	} catch (error) {
		console.error("[Main] Error:", error);
		console.log("[Main] Retrying in 5 minutes...");
		setTimeout(main, 5 * 60 * 1000);
	}
}

const app = express();

app.get("/health", (req, res) => {
	console.log("[Server] Health check request");
	res.json({ status: "ok" });
});

app.get("/", (req, res) => {
	console.log("[Server] Root request");
	res.json({ status: "Fact checker bot is running" });
});

const port = typeof PORT === "string" ? parseInt(PORT, 10) : PORT;

app.listen(port, "0.0.0.0", () => {
	console.log(`[Server] Running on port ${port}`);
});

console.log("[Cron] Setting up cron job");
const job = new CronJob("* * * * *", () => {
	console.log("* * * * * * \n");
	console.log("[Cron] Running scheduled task");
	main().catch((error) => {
		console.error("[Cron] Unhandled error in main:", error);
	});
	console.log("[Cron] Task completed");
});

ensureAuth().then((success) => {
	if (success) {
		main();
		job.start();
	} else {
		console.error("[Startup] Initial authentication failed");
		process.exit(1);
	}
});

process.on("SIGINT", () => {
	console.log("[Process] Shutting down gracefully....");
	job.stop();
	process.exit(0);
});
