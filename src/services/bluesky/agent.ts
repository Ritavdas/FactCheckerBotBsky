import { BskyAgent } from "@atproto/api";
import { ENV } from "../../config/environment";
import { loadSession, saveSession } from "../auth/session";

export const agent = new BskyAgent({
    service: "https://bsky.social",
});

export async function ensureAuth(): Promise<boolean> {
    try {
        const session = await loadSession();
        if (session) {
            agent.session = session;
            try {
                await agent.getProfile({ actor: session.handle });
                console.log("[Auth] Successfully resumed session");
                return true;
            } catch (error) {
                console.log("[Auth] Session expired, needs refresh");
            }
        }

        console.log("[Auth] Performing fresh login");
        const result = await agent.login({
            identifier: ENV.BLUESKY_USERNAME,
            password: ENV.BLUESKY_PASSWORD,
        });

        await saveSession(result.data);
        console.log("[Auth] New login successful");
        return true;
    } catch (error) {
        console.error("[Auth] Login failed:", error);
        return false;
    }
}