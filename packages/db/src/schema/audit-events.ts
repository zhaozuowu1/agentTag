import { boolean, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.ts";

export const auditEvents = pgTable("audit_events", {
  id: text("id").primaryKey(),
  tenantKey: text("tenant_key")
    .notNull()
    .references(() => tenants.tenantKey),
  openId: text("open_id").notNull(),
  chatId: text("chat_id").notNull(),
  sessionId: text("session_id"),
  toolName: text("tool_name").notNull(),
  targetHost: text("target_host"),
  success: boolean("success").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
