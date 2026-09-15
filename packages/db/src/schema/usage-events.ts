import { integer, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.ts";

export const usageEvents = pgTable("usage_events", {
  id: text("id").primaryKey(),
  tenantKey: text("tenant_key")
    .notNull()
    .references(() => tenants.tenantKey),
  chatId: text("chat_id").notNull(),
  sessionId: text("session_id").notNull(),
  openId: text("open_id").notNull(),
  inputTokens: integer("input_tokens").notNull(),
  outputTokens: integer("output_tokens").notNull(),
  modelId: text("model_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
