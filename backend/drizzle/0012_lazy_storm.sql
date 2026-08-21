ALTER TABLE "crawled_pages" ADD COLUMN "h1_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "h2_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "h3_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "h4_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "h5_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "h6_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "image_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "images_missing_alt" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "json_ld_types" text[];--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "og_title" text;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "og_description" text;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "og_image" text;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "twitter_card" text;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "twitter_title" text;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "twitter_description" text;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "twitter_image" text;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "server_header" text;--> statement-breakpoint
ALTER TABLE "crawled_pages" ADD COLUMN "cdn_header" text;
