import * as fs from "fs/promises";
import * as path from "path";
import { SessionData } from "./types";

export async function saveSession(session: SessionData) {
    try {
        await fs.writeFile(
            path.join(__dirname, "../../../src/session.json"),
            JSON.stringify(session)
        );
    } catch (error) {
        console.error("[Session] Failed to save session:", error);
    }
}

export async function loadSession(): Promise<SessionData | null> {
    try {
        const data = await fs.readFile(
            path.join(__dirname, "../../../src/session.json"),
            "utf-8"
        );
        return JSON.parse(data);
    } catch {
        return null;
    }
}