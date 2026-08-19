CREATE TABLE "search_opportunities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_run_id" uuid NOT NULL,
	"query" text NOT NULL,
	"opportunity_type" text NOT NULL,
	"score" integer NOT NULL,
	"priority" text NOT NULL,
	"relevance" integer NOT NULL,
	"impact" integer NOT NULL,
	"confidence" integer NOT NULL,
	"reason" text NOT NULL,
	"suggested_action" text NOT NULL,
	"related_page_id" uuid,
	"related_page_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "search_opportunities" ADD CONSTRAINT "search_opportunities_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_opportunities" ADD CONSTRAINT "search_opportunities_related_page_id_crawled_pages_id_fk" FOREIGN KEY ("related_page_id") REFERENCES "public"."crawled_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "search_opportunities_crawl_run_id_idx" ON "search_opportunities" USING btree ("crawl_run_id");