import { PERPLEXITY_CONFIG } from "../../config/constants";
import { ENV } from "../../config/environment";
import { PerplexityResponse, PerplexityError } from "./types";
import { sleep } from "../../utils/helpers";

async function queryPerplexityWithRetry(
	text: string,
	attempt: number = 1
): Promise<PerplexityResponse> {
	const { MAX_RETRIES, BASE_DELAY, MAX_DELAY } = PERPLEXITY_CONFIG;

	try {
		console.log(`[Perplexity] Attempt ${attempt} of ${MAX_RETRIES}`);
		const response = await fetch(
			"https://api.perplexity.ai/chat/completions",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${ENV.PERPLEXITY_API_KEY}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model: "llama-3.1-sonar-small-128k-online",
					messages: [
						{
							role: "system",
							content: `You are a fact-checker. 
                            Provide a verdict (True/False/Misleading/Unverified) and a brief explanation (exactly 200 characters).
                            Don't include citations in brackets.
                            Format: {verdict}|{explanation}`,
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
			const error = new Error("API request failed") as PerplexityError;
			error.status = response.status;

			if (response.status === 429) {
				error.type = "RATE_LIMIT";
				const retryAfter = parseInt(
					response.headers.get("retry-after") || "60"
				);
				error.retryAfter = retryAfter;
				throw error;
			}

			error.type = "API_ERROR";
			throw error;
		}

		const data = await response.json();
		const [verdict, explanation] = data.choices[0].message.content.split("|");

		return {
			verdict: verdict.trim() as PerplexityResponse["verdict"],
			explanation: explanation.trim(),
			// citations: data.citations || [],
			citations: [],
		};
	} catch (error: any) {
		if (attempt >= MAX_RETRIES) {
			throw error;
		}

		const exponentialDelay = Math.min(
			MAX_DELAY,
			BASE_DELAY * Math.pow(2, attempt - 1)
		);
		const jitter = Math.random() * 1000;
		const delay = exponentialDelay + jitter;

		if (
			(error as PerplexityError).type === "RATE_LIMIT" &&
			(error as PerplexityError).retryAfter
		) {
			await sleep((error as PerplexityError).retryAfter! * 1000);
		} else {
			await sleep(delay);
		}

		return queryPerplexityWithRetry(text, attempt + 1);
	}
}

export async function queryPerplexity(
	text: string
): Promise<PerplexityResponse> {
	try {
		return await queryPerplexityWithRetry(text);
	} catch (error: any) {
		return {
			verdict: "Unverified",
			explanation:
				"Unable to verify due to technical difficulties. Please try again later.",
			citations: [],
		};
	}
}
