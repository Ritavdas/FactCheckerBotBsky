import { BskyAgent, RichText } from "@atproto/api";
import * as dotenv from "dotenv";
import { CronJob } from "cron";

dotenv.config();

// Perplexity API setup
interface PerplexityResponse {
	text: string;
	confidence: number;
	sources?: string[];
}

// Rate limiting configuration (reusing from TimelyBsky but with adjusted values)
const RATE_LIMITS = {
	HOURLY_POINTS: 5000,
	DAILY_POINTS: 35000,
	ACTION_COSTS: {
		CREATE: 3,
		UPDATE: 2,
		DELETE: 1,
	},
} as const;

// Rate limit state
const rateLimit = {
	hourlyPoints: 0,
	dailyPoints: 0,
	lastHourReset: new Date(),
	lastDayReset: new Date(),
};

// Add this interface near the top of the file with other interfaces

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

		if (!response.ok) {
			throw new Error(`HTTP error! status: ${response.status}`);
		}

		const data = await response.json();

		if (!data.choices || data.choices.length === 0) {
			throw new Error("No response from API.");
		}

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

// Helper function to extract confidence from AI response
function extractConfidence(text: string): number {
	// Basic confidence extraction - can be enhanced based on actual API response format
	if (text.toLowerCase().includes("highly confident")) return 0.9;
	if (text.toLowerCase().includes("confident")) return 0.7;
	if (text.toLowerCase().includes("likely")) return 0.5;
	if (text.toLowerCase().includes("uncertain")) return 0.3;
	return 0.5; // default confidence
}

// Helper function to extract sources from AI response
function extractSources(text: string): string[] {
	// This can be enhanced based on actual API response format
	const sourceMatches = text.match(/\[(.*?)\]/g);
	return sourceMatches
		? sourceMatches.map((s) => s.replace(/[\[\]]/g, ""))
		: [];
}

// Create a Bluesky Agent
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

	return response.slice(0, 300); // Bluesky character limit
}

async function handleFactCheckRequest(
	text: string,
	replyTo?: { uri: string; cid: string }
) {
	try {
		// Remove the hashtag and bot mention from the text
		const cleanText = text.replace(/#factcheck/gi, "").trim();

		// Get fact check from Perplexity
		const factCheck = await queryPerplexity(cleanText);

		// Format and post response
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
	if (!canPerformAction("CREATE")) {
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
		trackAction("CREATE");
		console.log(`Posted successfully: ${text.slice(0, 50)}...`);
	} catch (error: any) {
		console.error("Post creation error:", error);
		if (error.response?.status === 429) {
			console.log("Rate limit exceeded. Waiting before retrying...");
			await new Promise((resolve) => setTimeout(resolve, 5 * 60 * 1000));
		}
	}
}

// Rate limiting functions (reused from TimelyBsky)
function checkAndResetCounters() {
	const now = new Date();
	if (now.getTime() - rateLimit.lastHourReset.getTime() > 3600000) {
		rateLimit.hourlyPoints = 0;
		rateLimit.lastHourReset = now;
	}
	if (now.getTime() - rateLimit.lastDayReset.getTime() > 86400000) {
		rateLimit.dailyPoints = 0;
		rateLimit.lastDayReset = now;
	}
}

function canPerformAction(
	action: keyof typeof RATE_LIMITS.ACTION_COSTS
): boolean {
	checkAndResetCounters();
	const cost = RATE_LIMITS.ACTION_COSTS[action];
	return (
		rateLimit.hourlyPoints + cost <= RATE_LIMITS.HOURLY_POINTS &&
		rateLimit.dailyPoints + cost <= RATE_LIMITS.DAILY_POINTS
	);
}

function trackAction(action: keyof typeof RATE_LIMITS.ACTION_COSTS) {
	const cost = RATE_LIMITS.ACTION_COSTS[action];
	rateLimit.hourlyPoints += cost;
	rateLimit.dailyPoints += cost;
}

async function processNotifications() {
	try {
		const { data } = await agent.listNotifications({ limit: 20 });
		const factCheckRequests = data.notifications.filter(
			(notif) =>
				notif.reason === "mention" &&
				!notif.isRead &&
				"text" in notif.record && // Type guard to check if 'text' exists
				(notif.record.text as string).toLowerCase().includes("#factcheck")
		);

		for (const request of factCheckRequests) {
			if (!canPerformAction("CREATE")) {
				console.log(
					"Rate limit reached for fact checks. Waiting for next cycle."
				);
				break;
			}
			await handleFactCheckRequest(
				(request.record as { text: string }).text,
				{
					uri: request.uri,
					cid: request.cid,
				}
			);

			// Add delay between requests
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
		setTimeout(main, 5 * 60 * 1000); // Retry after 5 minutes
	}
}

// Set up cron job to run every minute
const job = new CronJob("* * * * *", () => {
	main().catch((error) => {
		console.error("Unhandled error in main:", error);
	});
});

// Start the bot
main();
job.start();

// Handle shutdown
process.on("SIGINT", () => {
	console.log("Shutting down gracefully....");
	job.stop();
	process.exit(0);
});
