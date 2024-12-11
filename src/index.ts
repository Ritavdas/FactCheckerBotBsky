import express from "express";
import { ENV } from "./config/environment";
import { CHECK_INTERVAL } from "./config/constants";
import { ensureAuth } from "./services/bluesky/agent";
import { processNotifications } from "./services/bluesky/notifications";

async function main() {
	try {
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

// Setup Express server
const app = express();

app.get("/health", (_, res) => {
	res.json({ status: "ok" });
});

app.get("/", (_, res) => {
	res.json({ status: "Fact checker bot is running" });
});

const port = typeof ENV.PORT === "string" ? parseInt(ENV.PORT, 10) : ENV.PORT;

app.listen(port, "0.0.0.0", () => {
	console.log(`[Server] Running on port ${port}`);
});

// Set up main task interval
const runTask = () => {
	console.log("[Task] Running scheduled task");
	main().catch((error) => {
		console.error("[Task] Unhandled error in main:", error);
	});
};

// Start the service
const startService = async () => {
	if (await ensureAuth()) {
		runTask();
		setInterval(runTask, CHECK_INTERVAL);
	} else {
		console.error("[Startup] Initial authentication failed");
		process.exit(1);
	}
};

startService();

// Graceful shutdown
process.on("SIGINT", () => {
	console.log("[Process] Shutting down gracefully....");
	process.exit(0);
});
