ALTER TABLE "tenants" ALTER COLUMN "monthly_limit_usd" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "tenants" ALTER COLUMN "monthly_limit_usd" DROP NOT NULL;--> statement-breakpoint
UPDATE "tenants" SET "monthly_limit_usd" = NULL WHERE "monthly_limit_usd" = '0';
