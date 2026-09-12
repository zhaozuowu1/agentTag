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
  delete(id: string): Promise<void>;
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
    async delete(id) {
      entries.delete(id);
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
        });
      return entry;
    },
    async delete(id) {
      await db.delete(memoryEntries).where(eq(memoryEntries.id, id));
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
