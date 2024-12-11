export const RATE_LIMITS = {
	HOURLY_POINTS: 5000,
	DAILY_POINTS: 35000,
	ACTION_COSTS: {
		CREATE: 3,
		UPDATE: 2,
		DELETE: 1,
	},
} as const;

export const CHECK_INTERVAL = 10 * 1000; // 10 seconds in milliseconds
export const RETRY_DELAY = 5 * 60 * 1000; // 5 minutes in milliseconds

export const PERPLEXITY_CONFIG = {
	MAX_RETRIES: 5,
	BASE_DELAY: 1000,
	MAX_DELAY: 32000,
};
