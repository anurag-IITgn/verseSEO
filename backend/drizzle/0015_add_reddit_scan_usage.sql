CREATE TABLE "reddit_scan_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
	"crawl_run_id" uuid NOT NULL REFERENCES "crawl_runs"("id") ON DELETE cascade,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "reddit_scan_usage_user_idx" ON "reddit_scan_usage" ("user_id", "scanned_at");
