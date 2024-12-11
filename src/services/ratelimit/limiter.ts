import * as fs from "fs/promises";
import * as path from "path";
import { RATE_LIMITS } from "../../config/constants";
import { RateLimitData } from "./types";

const RATE_LIMIT_FILE = path.join(__dirname, "../../../src/ratelimit.json");

export async function loadRateLimit(): Promise<RateLimitData> {
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

export async function saveRateLimit(rateLimit: RateLimitData) {
	await fs.writeFile(RATE_LIMIT_FILE, JSON.stringify(rateLimit, null, 2));
}

export async function checkAndResetCounters(): Promise<RateLimitData> {
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

export async function canPerformAction(
	action: keyof typeof RATE_LIMITS.ACTION_COSTS
): Promise<boolean> {
	const rateLimit = await checkAndResetCounters();
	const cost = RATE_LIMITS.ACTION_COSTS[action];
	return (
		rateLimit.hourlyPoints + cost <= RATE_LIMITS.HOURLY_POINTS &&
		rateLimit.dailyPoints + cost <= RATE_LIMITS.DAILY_POINTS
	);
}

export async function trackAction(
	action: keyof typeof RATE_LIMITS.ACTION_COSTS
) {
	const rateLimit = await loadRateLimit();
	const cost = RATE_LIMITS.ACTION_COSTS[action];
	rateLimit.hourlyPoints += cost;
	rateLimit.dailyPoints += cost;
	await saveRateLimit(rateLimit);
}
