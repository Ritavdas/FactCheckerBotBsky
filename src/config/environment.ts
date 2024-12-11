import * as dotenv from "dotenv";

dotenv.config();

export const ENV = {
	PORT: process.env.PORT || 3000,
	BLUESKY_USERNAME: process.env.BLUESKY_USERNAME!,
	BLUESKY_PASSWORD: process.env.BLUESKY_PASSWORD!,
	PERPLEXITY_API_KEY: process.env.PERPLEXITY_API_KEY!,
};
