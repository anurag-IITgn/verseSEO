CREATE TABLE "reddit_discussions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_run_id" uuid NOT NULL,
	"subreddit" text NOT NULL,
	"post_title" text NOT NULL,
	"post_url" text NOT NULL,
	"permalink" text NOT NULL,
	"author" text,
	"score" integer DEFAULT 0 NOT NULL,
	"num_comments" integer DEFAULT 0 NOT NULL,
	"posted_at" timestamp with time zone,
	"body_snippet" text,
	"topic" text NOT NULL,
	"relevance" integer NOT NULL,
	"impact" integer NOT NULL,
	"confidence" integer NOT NULL,
	"opportunity_score" integer NOT NULL,
	"priority" text NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reddit_discussions" ADD CONSTRAINT "reddit_discussions_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reddit_discussions_crawl_run_id_idx" ON "reddit_discussions" USING btree ("crawl_run_id");