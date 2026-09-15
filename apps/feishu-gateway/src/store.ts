import { and, eq, gte, inArray, or, sql, sum } from "drizzle-orm";
import { authorizedChats, createDb, tenants, usageEvents, workingSessions } from "@agenttag/db";
import { tokensToUsd } from "@agenttag/domain";

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

    async findSession(input: { chatId: string; threadId: string | null; rootMessageId?: string | null }) {
      if (input.threadId) {
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
        if (row) {
          return { id: row.id, status: row.status as "running" | "idle" };
        }
      }
      if (input.rootMessageId) {
        const rows = await db
          .select({
            id: workingSessions.id,
            status: workingSessions.status,
          })
          .from(workingSessions)
          .where(
            and(
              eq(workingSessions.chatId, input.chatId),
              or(
                eq(workingSessions.rootMessageId, input.rootMessageId),
                eq(workingSessions.checklistMessageId, input.rootMessageId),
              ),
              inArray(workingSessions.status, ["running", "idle"]),
            ),
          )
          .limit(1);
        const row = rows[0];
        if (row) {
          return { id: row.id, status: row.status as "running" | "idle" };
        }
      }
      return null;
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
      const event = [{ type: "user", openId, text, at: new Date().toISOString() }];
      await db
        .update(workingSessions)
        .set({
          status: "running",
          lastActivityAt: new Date(),
          transcript: sql`coalesce(${workingSessions.transcript}, '[]'::jsonb) || ${JSON.stringify(event)}::jsonb`,
        })
        .where(eq(workingSessions.id, sessionId));
    },

    async getBudget(tenantKey: string) {
      const tenantRows = await db.select().from(tenants).where(eq(tenants.tenantKey, tenantKey)).limit(1);
      const raw = tenantRows[0]?.monthlyLimitUsd;
      const limitUsd = raw == null || raw === "" ? null : Number(raw);
      const monthStart = new Date();
      monthStart.setUTCDate(1);
      monthStart.setUTCHours(0, 0, 0, 0);
      const usageRows = await db
        .select({
          input: sum(usageEvents.inputTokens),
          output: sum(usageEvents.outputTokens),
        })
        .from(usageEvents)
        .where(and(eq(usageEvents.tenantKey, tenantKey), gte(usageEvents.createdAt, monthStart)));
      const usedUsd = tokensToUsd(Number(usageRows[0]?.input ?? 0), Number(usageRows[0]?.output ?? 0));
      return { usedUsd, limitUsd: limitUsd != null && Number.isFinite(limitUsd) ? limitUsd : null };
    },

    async getTenantModelConfig(tenantKey: string) {
      const tenantRows = await db.select().from(tenants).where(eq(tenants.tenantKey, tenantKey)).limit(1);
      return {
        modelId: tenantRows[0]?.modelId ?? null,
        enableThinking: tenantRows[0]?.enableThinking ?? false,
      };
    },
  };
}
