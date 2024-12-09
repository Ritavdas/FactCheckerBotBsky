import { BskyAgent, RichText } from "@atproto/api";
import * as dotenv from "dotenv";
import { CronJob } from "cron";
import * as fs from "fs/promises";
import * as path from "path";
import express from "express";

dotenv.config();

const PORT = process.env.PORT || 3000;

interface PerplexityResponse {
	text: string;
	confidence: number;
	sources?: string[];
}

interface NotificationRecord {
	text: string;
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

async function loadRateLimit() {
	try {
		const data = await fs.readFile(RATE_LIMIT_FILE, "utf8");
		return JSON.parse(data);
	} catch {
		return {
			hourlyPoints: 0,
			dailyPoints: 0,
			lastHourReset: new Date().toISOString(),
			lastDayReset: new Date().toISOString(),
		};
	}
}

async function saveRateLimit(rateLimit: any) {
	await fs.writeFile(RATE_LIMIT_FILE, JSON.stringify(rateLimit, null, 2));
}

async function checkAndResetCounters() {
	const rateLimit = await loadRateLimit();
	const now = new Date();
	const lastHourReset = new Date(rateLimit.lastHourReset);
	const lastDayReset = new Date(rateLimit.lastDayReset);
	let updated = false;

	if (now.getTime() - lastHourReset.getTime() > 3600000) {
		rateLimit.hourlyPoints = 0;
		rateLimit.lastHourReset = now.toISOString();
		updated = true;
	}

	if (now.getTime() - lastDayReset.getTime() > 86400000) {
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
	return (
		rateLimit.hourlyPoints + cost <= RATE_LIMITS.HOURLY_POINTS &&
		rateLimit.dailyPoints + cost <= RATE_LIMITS.DAILY_POINTS
	);
}

async function trackAction(action: keyof typeof RATE_LIMITS.ACTION_COSTS) {
	const rateLimit = await loadRateLimit();
	const cost = RATE_LIMITS.ACTION_COSTS[action];
	rateLimit.hourlyPoints += cost;
	rateLimit.dailyPoints += cost;
	await saveRateLimit(rateLimit);
}

async function queryPerplexity(text: string): Promise<PerplexityResponse> {
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
								"You are a fact-checking assistant. Analyze the following statement and provide a clear, concise response about its accuracy. Include confidence level and sources when possible.",
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
		const analysis = data.choices[0].message.content;
		return {
			text: analysis,
			confidence: extractConfidence(analysis),
			sources: extractSources(analysis),
		};
	} catch (error) {
		console.error("Perplexity API Error:", error);
		throw error;
	}
}

function extractConfidence(text: string): number {
	if (text.toLowerCase().includes("highly confident")) return 0.9;
	if (text.toLowerCase().includes("confident")) return 0.7;
	if (text.toLowerCase().includes("likely")) return 0.5;
	if (text.toLowerCase().includes("uncertain")) return 0.3;
	return 0.5;
}

function extractSources(text: string): string[] {
	const sourceMatches = text.match(/\[(.*?)\]/g);
	return sourceMatches
		? sourceMatches.map((s) => s.replace(/[\[\]]/g, ""))
		: [];
}

const agent = new BskyAgent({
	service: "https://bsky.social",
});

async function formatFactCheckResponse(
	factCheck: PerplexityResponse
): Promise<string> {
	const confidenceEmoji =
		factCheck.confidence >= 0.7
			? "✅"
			: factCheck.confidence >= 0.4
			? "⚠️"
			: "❌";

	let response = `${confidenceEmoji} Fact Check Result:\n\n${factCheck.text}\n\n`;

	if (factCheck.sources && factCheck.sources.length > 0) {
		response +=
			"\nSources:\n" + factCheck.sources.map((s) => `• ${s}`).join("\n");
	}

	return response.slice(0, 300);
}

async function handleFactCheckRequest(
	text: string,
	replyTo?: { uri: string; cid: string }
) {
	try {
		const cleanText = text.replace(/#factcheck/gi, "").trim();
		const factCheck = await queryPerplexity(cleanText);
		const response = await formatFactCheckResponse(factCheck);
		await createPost(response, replyTo);
	} catch (error) {
		console.error("Error in fact check handling:", error);
		const errorResponse =
			"I apologize, but I encountered an error while fact-checking. Please try again later.";
		await createPost(errorResponse, replyTo);
	}
}

async function createPost(
	text: string,
	replyTo?: { uri: string; cid: string }
) {
	if (!(await canPerformAction("CREATE"))) {
		console.log("Rate limit reached. Skipping post.");
		return;
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

		await agent.post(post);
		await trackAction("CREATE");
		console.log(`Posted successfully: ${text.slice(0, 50)}...`);
	} catch (error: any) {
		console.error("Post creation error:", error);
		if (error.response?.status === 429) {
			console.log("Rate limit exceeded. Waiting before retrying...");
			await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
		}
	}
}

async function processNotifications() {
	try {
		const { data } = await agent.listNotifications({ limit: 20 });
		const factCheckRequests = data.notifications.filter(
			(notif) =>
				notif.reason === "mention" &&
				!notif.isRead &&
				(notif.record as NotificationRecord).text
					.toLowerCase()
					.includes("#factcheck")
		);

		for (const request of factCheckRequests) {
			if (!(await canPerformAction("CREATE"))) {
				console.log(
					"Rate limit reached for fact checks. Waiting for next cycle."
				);
				break;
			}

			await handleFactCheckRequest(
				(request.record as NotificationRecord).text,
				{ uri: request.uri, cid: request.cid }
			);

			await new Promise((resolve) => setTimeout(resolve, 2000));
		}

		if (factCheckRequests.length > 0) {
			await agent.updateSeenNotifications();
		}
	} catch (error) {
		console.error("Failed to process notifications:", error);
	}
}

async function main() {
	try {
		await agent.login({
			identifier: process.env.BLUESKY_USERNAME!,
			password: process.env.BLUESKY_PASSWORD!,
		});

		await processNotifications();
	} catch (error) {
		console.error("Error in main:", error);
		setTimeout(main, 5 * 60 * 1000);
	}
}

const app = express();

app.get("/health", (req, res) => {
	res.json({ status: "ok" });
});

app.get("/", (req, res) => {
	res.json({ status: "Fact checker bot is running" });
});

const port = typeof PORT === "string" ? parseInt(PORT, 10) : PORT;

app.listen(port, "0.0.0.0", () => {
	console.log(`Server is running on port ${port}`);
});

const job = new CronJob("* * * * *", () => {
	main().catch((error) => {
		console.error("Unhandled error in main:", error);
	});
});

main();
job.start();

process.on("SIGINT", () => {
	console.log("Shutting down gracefully....");
	job.stop();
	process.exit(0);
});
