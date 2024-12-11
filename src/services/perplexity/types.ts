export interface PerplexityResponse {
	verdict: "True" | "False" | "Misleading" | "Unverified";
	explanation: string;
	citations?: string[];
}

export interface PerplexityError extends Error {
	type: "API_ERROR" | "RATE_LIMIT" | "NETWORK_ERROR" | "PARSING_ERROR";
	status?: number;
	retryAfter?: number;
}
