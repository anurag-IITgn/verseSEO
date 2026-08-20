ALTER TABLE "search_opportunities" ADD COLUMN "intent" text DEFAULT 'informational' NOT NULL;--> statement-breakpoint
ALTER TABLE "search_opportunities" ADD COLUMN "coverage" text DEFAULT 'IMPROVEMENT' NOT NULL;--> statement-breakpoint
ALTER TABLE "search_opportunities" ADD COLUMN "evidence" jsonb;