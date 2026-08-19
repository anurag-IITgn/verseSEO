CREATE TABLE "ai_visibility_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_run_id" uuid NOT NULL,
	"prompt" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"raw_response" text NOT NULL,
	"mentioned" boolean NOT NULL,
	"cited" boolean NOT NULL,
	"stance" text NOT NULL,
	"visibility_score" integer NOT NULL,
	"reason" text NOT NULL,
	"competitors" text[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_visibility_results" ADD CONSTRAINT "ai_visibility_results_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_visibility_results_crawl_run_id_idx" ON "ai_visibility_results" USING btree ("crawl_run_id");