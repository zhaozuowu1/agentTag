import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.ts";

export const workingSessions = pgTable("working_sessions", {
  id: text("id").primaryKey(),
  tenantKey: text("tenant_key")
    .notNull()
    .references(() => tenants.tenantKey),
  chatId: text("chat_id").notNull(),
  threadId: text("thread_id"),
  rootMessageId: text("root_message_id").notNull(),
  kind: text("kind").notNull(),
  status: text("status").notNull(),
  accessBundleIds: text("access_bundle_ids").array().notNull().default([]),
  checklistMessageId: text("checklist_message_id"),
  sandboxId: text("sandbox_id"),
  startedByOpenId: text("started_by_open_id").notNull(),
  transcript: jsonb("transcript").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastActivityAt: timestamp("last_activity_at", { withTimezone: true }).notNull().defaultNow(),
});
