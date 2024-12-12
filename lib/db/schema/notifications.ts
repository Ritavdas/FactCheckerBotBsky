import { pgTable, text, timestamp, integer } from 'drizzle-orm/pg-core';
import { createId } from '@paralleldrive/cuid2';

export const notifications = pgTable('notifications', {
  // Using CUID2 for IDs as it's more suitable for distributed systems than nanoid
  id: text('id').primaryKey().$defaultFn(() => createId()),
  
  // Bluesky specific fields
  blueskyId: text('bluesky_id').notNull(),
  parentPostUri: text('parent_post_uri').notNull(),
  parentPostCid: text('parent_post_cid').notNull(),
  
  // Content and type
  type: text('type').notNull().$type<'factcheck' | 'moreinfo'>(),
  content: text('content').notNull(),
  
  // Processing status and metadata
  status: text('status').notNull().$type<'pending' | 'in_progress' | 'completed' | 'failed' | 'skipped'>().default('pending'),
  retryCount: integer('retry_count').notNull().default(0),
  
  // Response tracking
  responseUri: text('response_uri'),
  errorMessage: text('error_message'),
  
  // Timestamps
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
  processedAt: timestamp('processed_at'),
  lastRetryAt: timestamp('last_retry_at'),
});

// Type inference
export type NotificationInsert = typeof notifications.$inferInsert;
export type NotificationSelect = typeof notifications.$inferSelect;