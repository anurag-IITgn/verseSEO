CREATE TABLE "crawl_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"pages_discovered" integer DEFAULT 0 NOT NULL,
	"pages_crawled" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "crawled_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_run_id" uuid NOT NULL,
	"url" text NOT NULL,
	"status_code" integer,
	"content_type" text,
	"title" text,
	"meta_description" text,
	"canonical_url" text,
	"robots_directive" text,
	"is_indexable" boolean,
	"word_count" integer,
	"response_time_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text,
	"website_url" text NOT NULL,
	"domain" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seo_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crawl_run_id" uuid NOT NULL,
	"page_id" uuid,
	"issue_type" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD CONSTRAINT "crawl_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD CONSTRAINT "crawled_pages_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_issues" ADD CONSTRAINT "seo_issues_crawl_run_id_crawl_runs_id_fk" FOREIGN KEY ("crawl_run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seo_issues" ADD CONSTRAINT "seo_issues_page_id_crawled_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."crawled_pages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "crawl_runs_project_id_idx" ON "crawl_runs" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "crawled_pages_crawl_run_id_idx" ON "crawled_pages" USING btree ("crawl_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "crawled_pages_run_url_idx" ON "crawled_pages" USING btree ("crawl_run_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_website_url_idx" ON "projects" USING btree ("website_url");--> statement-breakpoint
CREATE INDEX "seo_issues_crawl_run_id_idx" ON "seo_issues" USING btree ("crawl_run_id");