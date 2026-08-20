CREATE TABLE "gsc_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tokens" jsonb NOT NULL,
	"scope" text,
	"access_token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gsc_connections_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "gsc_query_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"site_url" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"queries" jsonb NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gsc_sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"site_url" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "gsc_site_id" uuid;--> statement-breakpoint
ALTER TABLE "search_opportunities" ADD COLUMN "gsc" jsonb;--> statement-breakpoint
ALTER TABLE "gsc_connections" ADD CONSTRAINT "gsc_connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_query_snapshots" ADD CONSTRAINT "gsc_query_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gsc_sites" ADD CONSTRAINT "gsc_sites_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "gsc_connections_user_id_idx" ON "gsc_connections" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_snapshots_user_site_url_idx" ON "gsc_query_snapshots" USING btree ("user_id","site_url");--> statement-breakpoint
CREATE UNIQUE INDEX "gsc_sites_user_site_url_idx" ON "gsc_sites" USING btree ("user_id","site_url");--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_gsc_site_id_gsc_sites_id_fk" FOREIGN KEY ("gsc_site_id") REFERENCES "public"."gsc_sites"("id") ON DELETE set null ON UPDATE no action;