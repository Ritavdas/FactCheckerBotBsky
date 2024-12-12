import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as notificationSchema from "./schema/notifications";

const client = postgres(process.env.DATABASE_URL!, { prepare: false });

export const db = drizzle(client, {
	schema: {
		...notificationSchema,
	},
});
