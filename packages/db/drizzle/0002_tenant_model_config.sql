ALTER TABLE "tenants" ADD COLUMN "model_id" text;--> statement-breakpoint
ALTER TABLE "tenants" ADD COLUMN "enable_thinking" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN "model_id" text;
