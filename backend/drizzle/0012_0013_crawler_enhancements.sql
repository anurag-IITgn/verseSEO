ALTER TABLE "crawled_pages" ADD COLUMN "has_viewport" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "has_charset" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "has_favicon" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "html_lang" text;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "external_link_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "css_file_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "js_file_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "iframe_count" integer DEFAULT 0 NOT NULL;
