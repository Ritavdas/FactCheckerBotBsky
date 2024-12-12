import { and, eq, lt, sql } from "drizzle-orm";
import { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { notifications, NotificationInsert } from "../schema/notifications";
import type { BlueskyNotification } from "../../types/bluesky";

type NotificationStatus =
	| "pending"
	| "in_progress"
	| "completed"
	| "failed"
	| "skipped";

const determineType = (notification: BlueskyNotification) => {
	return notification.record.text.toLowerCase().includes("#factcheck")
		? "factcheck"
		: "moreinfo";
};

export const createNotificationRepository = (db: PostgresJsDatabase) => {
	const batchInsertNotifications = async (
		blueskyNotifications: BlueskyNotification[]
	) => {
		const validNotifications = blueskyNotifications.filter(
			(notification) =>
				notification.record.reply?.parent.uri &&
				notification.record.reply?.parent.cid
		);

		const notificationRecords: NotificationInsert[] = validNotifications.map(
			(notification) => {
				if (
					!notification.record.reply?.parent.uri ||
					!notification.record.reply?.parent.cid
				) {
					throw new Error(
						"Invalid notification: missing parent post information"
					);
				}

				return {
					blueskyId: notification.id,
					type: determineType(notification),
					content: notification.record.text,
					parentPostUri: notification.record.reply.parent.uri,
					parentPostCid: notification.record.reply.parent.cid,
					status: "pending" as const,
				};
			}
		);

		if (notificationRecords.length === 0) {
			return null;
		}

		return await db
			.insert(notifications)
			.values(notificationRecords)
			.onConflictDoNothing({ target: notifications.blueskyId });
	};

	const getPendingNotifications = async (limit: number = 10) => {
		return await db
			.select()
			.from(notifications)
			.where(
				and(
					eq(notifications.status, "pending"),
					lt(notifications.retryCount, 3)
				)
			)
			.orderBy(notifications.createdAt)
			.limit(limit);
	};

	const updateStatus = async (
		id: string,
		status: NotificationStatus,
		updates: Partial<NotificationInsert> = {}
	) => {
		return await db
			.update(notifications)
			.set({
				status,
				updatedAt: new Date(),
				...(status === "completed" && { processedAt: new Date() }),
				...updates,
			})
			.where(eq(notifications.id, id))
			.returning();
	};

	const markAsInProgress = async (id: string) => {
		return await db
			.update(notifications)
			.set({
				status: "in_progress",
				updatedAt: new Date(),
			})
			.where(eq(notifications.id, id))
			.returning();
	};

	const incrementRetryCount = async (id: string, error: string) => {
		return await db
			.update(notifications)
			.set({
				retryCount: sql`${notifications.retryCount} + 1`,
				lastRetryAt: new Date(),
				errorMessage: error,
				updatedAt: new Date(),
			})
			.where(eq(notifications.id, id))
			.returning();
	};

	const getStuckNotifications = async (stuckThresholdMinutes: number = 15) => {
		const stuckThreshold = new Date(
			Date.now() - stuckThresholdMinutes * 60 * 1000
		);

		return await db
			.select()
			.from(notifications)
			.where(
				and(
					eq(notifications.status, "in_progress"),
					lt(notifications.updatedAt, stuckThreshold)
				)
			);
	};

	return {
		batchInsertNotifications,
		getPendingNotifications,
		updateStatus,
		markAsInProgress,
		incrementRetryCount,
		getStuckNotifications,
	};
};
