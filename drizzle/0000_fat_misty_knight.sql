CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"bluesky_id" text NOT NULL,
	"parent_post_uri" text NOT NULL,
	"parent_post_cid" text NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"response_uri" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"processed_at" timestamp,
	"last_retry_at" timestamp
);
