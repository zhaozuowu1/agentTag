import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.ts";

export const memoryEntries = pgTable("memory_entries", {
  id: text("id").primaryKey(),
  tenantKey: text("tenant_key")
    .notNull()
    .references(() => tenants.tenantKey),
  scope: text("scope").notNull(),
  chatId: text("chat_id"),
  kind: text("kind").notNull(),
  text: text("text").notNull(),
  sourceSessionId: text("source_session_id"),
  createdByOpenId: text("created_by_open_id").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
