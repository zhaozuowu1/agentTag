import { boolean, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.ts";

export const authorizedChats = pgTable(
  "authorized_chats",
  {
    tenantKey: text("tenant_key")
      .notNull()
      .references(() => tenants.tenantKey),
    chatId: text("chat_id").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    chatType: text("chat_type").notNull(),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.tenantKey, table.chatId] })],
);
