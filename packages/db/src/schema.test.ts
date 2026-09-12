import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  auditEvents,
  authorizedChats,
  memoryEntries,
  tenants,
  usageEvents,
  workingSessions,
} from "./schema/index.ts";

function columnNames(table: Parameters<typeof getTableColumns>[0]): string[] {
  return Object.keys(getTableColumns(table)).sort();
}

describe("core drizzle schema", () => {
  it("defines tenants, authorized_chats, working_sessions, memory_entries, usage_events, audit_events", () => {
    expect(getTableName(tenants)).toBe("tenants");
    expect(getTableName(authorizedChats)).toBe("authorized_chats");
    expect(getTableName(workingSessions)).toBe("working_sessions");
    expect(getTableName(memoryEntries)).toBe("memory_entries");
    expect(getTableName(usageEvents)).toBe("usage_events");
    expect(getTableName(auditEvents)).toBe("audit_events");
  });

  it("authorized_chats has tenant_key, chat_id, enabled, chat_type, added_at", () => {
    expect(columnNames(authorizedChats)).toEqual(
      ["addedAt", "chatId", "chatType", "enabled", "tenantKey"].sort(),
    );
  });
});
