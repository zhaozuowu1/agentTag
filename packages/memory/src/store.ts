import { allowMemoryWrite, type MemoryKind, type MemoryScope } from "@agenttag/domain";
import { createDb, memoryEntries } from "@agenttag/db";
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

export interface MemoryEntry {
  id: string;
  tenantKey: string;
  scope: MemoryScope;
  chatId: string | null;
  kind: MemoryKind;
  text: string;
  sourceSessionId: string | null;
  createdByOpenId: string;
  updatedAt: Date;
}

export interface UpsertMemoryInput {
  id?: string;
  tenantKey: string;
  scope: MemoryScope;
  chatId: string | null;
  kind: MemoryKind;
  text: string;
  sourceSessionId: string | null;
  createdByOpenId: string;
  chatType: "public" | "private" | "p2p";
}

export interface MemoryStore {
  list(input: { tenantKey: string; chatId: string }): Promise<MemoryEntry[]>;
  upsert(input: UpsertMemoryInput): Promise<MemoryEntry>;
  delete(input: { tenantKey: string; chatId: string; id: string }): Promise<void>;
}

const MEMORY_SCOPE_ERROR = "memory does not belong to this chat";

function assertMemoryBelongsToChat(
  entry: Pick<MemoryEntry, "tenantKey" | "chatId"> | undefined,
  tenantKey: string,
  chatId: string | null,
): void {
  if (!entry) {
    return;
  }
  if (entry.tenantKey !== tenantKey || entry.chatId !== chatId) {
    throw new Error(MEMORY_SCOPE_ERROR);
  }
}

export function createMemoryStore(seed: MemoryEntry[] = []): MemoryStore {
  const entries = new Map<string, MemoryEntry>(seed.map((entry) => [entry.id, entry]));

  return {
    async list(input) {
      return [...entries.values()].filter(
        (entry) =>
          entry.tenantKey === input.tenantKey &&
          entry.scope === "chat" &&
          entry.chatId === input.chatId,
      );
    },
    async upsert(input) {
      if (!allowMemoryWrite({ scope: input.scope, chatType: input.chatType })) {
        throw new Error("workspace memory writes are not allowed for this chat");
      }
      const id = input.id ?? randomUUID();
      assertMemoryBelongsToChat(entries.get(id), input.tenantKey, input.chatId);
      const entry: MemoryEntry = {
        id,
        tenantKey: input.tenantKey,
        scope: "chat",
        chatId: input.chatId,
        kind: input.kind,
        text: input.text,
        sourceSessionId: input.sourceSessionId,
        createdByOpenId: input.createdByOpenId,
        updatedAt: new Date(),
      };
      entries.set(id, entry);
      return entry;
    },
    async delete(input) {
      const existing = entries.get(input.id);
      if (!existing) {
        return;
      }
      assertMemoryBelongsToChat(existing, input.tenantKey, input.chatId);
      entries.delete(input.id);
    },
  };
}

type AppDb = ReturnType<typeof createDb>["db"];

export function createDbMemoryStore(db: AppDb): MemoryStore {
  return {
    async list(input) {
      const rows = await db
        .select()
        .from(memoryEntries)
        .where(
          and(
            eq(memoryEntries.tenantKey, input.tenantKey),
            eq(memoryEntries.chatId, input.chatId),
            eq(memoryEntries.scope, "chat"),
          ),
        );
      return rows.map(fromRow);
    },
    async upsert(input) {
      if (!allowMemoryWrite({ scope: input.scope, chatType: input.chatType })) {
        throw new Error("workspace memory writes are not allowed for this chat");
      }
      const id = input.id ?? randomUUID();
      if (input.id) {
        const existing = await db
          .select({ tenantKey: memoryEntries.tenantKey, chatId: memoryEntries.chatId })
          .from(memoryEntries)
          .where(eq(memoryEntries.id, input.id))
          .limit(1);
        assertMemoryBelongsToChat(existing[0], input.tenantKey, input.chatId);
      }
      const entry: MemoryEntry = {
        id,
        tenantKey: input.tenantKey,
        scope: "chat",
        chatId: input.chatId,
        kind: input.kind,
        text: input.text,
        sourceSessionId: input.sourceSessionId,
        createdByOpenId: input.createdByOpenId,
        updatedAt: new Date(),
      };
      await db
        .insert(memoryEntries)
        .values({
          id: entry.id,
          tenantKey: entry.tenantKey,
          scope: entry.scope,
          chatId: entry.chatId,
          kind: entry.kind,
          text: entry.text,
          sourceSessionId: entry.sourceSessionId,
          createdByOpenId: entry.createdByOpenId,
          updatedAt: entry.updatedAt,
        })
        .onConflictDoUpdate({
          target: memoryEntries.id,
          set: {
            text: entry.text,
            kind: entry.kind,
            updatedAt: entry.updatedAt,
          },
          setWhere: and(
            eq(memoryEntries.tenantKey, entry.tenantKey),
            eq(memoryEntries.chatId, entry.chatId ?? ""),
          ),
        });
      return entry;
    },
    async delete(input) {
      const existing = await db
        .select({ tenantKey: memoryEntries.tenantKey, chatId: memoryEntries.chatId })
        .from(memoryEntries)
        .where(eq(memoryEntries.id, input.id))
        .limit(1);
      if (existing.length === 0) {
        return;
      }
      assertMemoryBelongsToChat(existing[0], input.tenantKey, input.chatId);
      await db
        .delete(memoryEntries)
        .where(
          and(
            eq(memoryEntries.id, input.id),
            eq(memoryEntries.tenantKey, input.tenantKey),
            eq(memoryEntries.chatId, input.chatId),
          ),
        );
    },
  };
}

function fromRow(row: typeof memoryEntries.$inferSelect): MemoryEntry {
  return {
    id: row.id,
    tenantKey: row.tenantKey,
    scope: row.scope as MemoryScope,
    chatId: row.chatId,
    kind: row.kind as MemoryKind,
    text: row.text,
    sourceSessionId: row.sourceSessionId,
    createdByOpenId: row.createdByOpenId,
    updatedAt: row.updatedAt,
  };
}
