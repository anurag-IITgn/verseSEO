CREATE TABLE "content_generations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_run_id" uuid NOT NULL,
	"opportunity_id" uuid NOT NULL,
	"brief" jsonb NOT NULL,
	"title" text NOT NULL,
	"intent" text NOT NULL,
	"draft" text NOT NULL,
	"status" text DEFAULT 'GENERATED' NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_generations_opportunity_id_unique" UNIQUE("opportunity_id")
);
--> statement-breakpoint
ALTER TABLE "content_generations" ADD CONSTRAINT "content_generations_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_generations" ADD CONSTRAINT "content_generations_opportunity_id_search_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."search_opportunities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "content_generations_opportunity_id_idx" ON "content_generations" USING btree ("opportunity_id");