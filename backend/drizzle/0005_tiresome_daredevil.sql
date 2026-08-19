CREATE TABLE "content_recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_run_id" uuid NOT NULL,
	"topic" text NOT NULL,
	"title" text NOT NULL,
	"intent" text NOT NULL,
	"priority" text NOT NULL,
	"rationale" text NOT NULL,
	"structure" text NOT NULL,
	"source_type" text NOT NULL,
	"ai_enhanced" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "content_recommendations" ADD CONSTRAINT "content_recommendations_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_recommendations_crawl_run_id_idx" ON "content_recommendations" USING btree ("crawl_run_id");