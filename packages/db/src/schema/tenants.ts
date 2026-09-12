import { numeric, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const tenants = pgTable("tenants", {
  tenantKey: text("tenant_key").primaryKey(),
  displayName: text("display_name").notNull().default(""),
  monthlyLimitUsd: numeric("monthly_limit_usd"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
