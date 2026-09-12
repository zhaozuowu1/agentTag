import { and, eq, inArray } from "drizzle-orm";
import { authorizedChats, createDb, tenants, workingSessions } from "@agenttag/db";

type Db = ReturnType<typeof createDb>["db"];

export function createGatewayStore(db: Db) {
  return {
    async lookupGrant(tenantKey: string, chatId: string) {
      const rows = await db
        .select()
        .from(authorizedChats)
        .where(and(eq(authorizedChats.tenantKey, tenantKey), eq(authorizedChats.chatId, chatId)))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return { authorized: false, enabled: false };
      }
      return { authorized: true, enabled: row.enabled };
    },

    async ensureTenant(tenantKey: string) {
      await db.insert(tenants).values({ tenantKey }).onConflictDoNothing();
    },

    async findSession(input: { chatId: string; threadId: string | null }) {
      if (!input.threadId) {
        return null;
      }
      const rows = await db
        .select({
          id: workingSessions.id,
          status: workingSessions.status,
        })
        .from(workingSessions)
        .where(
          and(
            eq(workingSessions.chatId, input.chatId),
            eq(workingSessions.threadId, input.threadId),
            inArray(workingSessions.status, ["running", "idle"]),
          ),
        )
        .limit(1);
      const row = rows[0];
      if (!row) {
        return null;
      }
      return { id: row.id, status: row.status as "running" | "idle" };
    },

    async createSession(input: {
      id: string;
      tenantKey: string;
      chatId: string;
      threadId: string | null;
      rootMessageId: string;
      kind: "chat" | "thread";
      startedByOpenId: string;
      checklistMessageId: string | null;
      userText: string;
    }) {
      await db.insert(workingSessions).values({
        id: input.id,
        tenantKey: input.tenantKey,
        chatId: input.chatId,
        threadId: input.threadId,
        rootMessageId: input.rootMessageId,
        kind: input.kind,
        status: "running",
        startedByOpenId: input.startedByOpenId,
        checklistMessageId: input.checklistMessageId,
        transcript: [
          {
            type: "user",
            openId: input.startedByOpenId,
            text: input.userText,
            at: new Date().toISOString(),
          },
        ],
      });
      return { id: input.id, status: "running" as const };
    },

    async archiveSession(sessionId: string) {
      await db
        .update(workingSessions)
        .set({ status: "archived" })
        .where(eq(workingSessions.id, sessionId));
    },

    async appendUserMessage(sessionId: string, openId: string, text: string) {
      const rows = await db.select().from(workingSessions).where(eq(workingSessions.id, sessionId)).limit(1);
      const row = rows[0];
      if (!row) {
        return;
      }
      const transcript = Array.isArray(row.transcript) ? row.transcript : [];
      await db
        .update(workingSessions)
        .set({
          status: "running",
          lastActivityAt: new Date(),
          transcript: [
            ...transcript,
            { type: "user", openId, text, at: new Date().toISOString() },
          ],
        })
        .where(eq(workingSessions.id, sessionId));
    },
  };
}
