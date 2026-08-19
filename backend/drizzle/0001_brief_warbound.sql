ALTER TABLE "crawl_runs" ADD COLUMN "robots_found" boolean;--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD COLUMN "sitemap_found" boolean;--> statement-breakpoint
ALTER TABLE "crawl_runs" ADD COLUMN "health_score" integer;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "internal_links" text[];