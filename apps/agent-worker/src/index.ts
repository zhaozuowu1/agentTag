import { parseEnv } from "@agenttag/config";
import { auditEvents, createDb, tenants, usageEvents, workingSessions } from "@agenttag/db";
import { resolveRuntimeModel, tokensToUsd } from "@agenttag/domain";
import { createFeishuClient } from "@agenttag/feishu";
import { createFeishuMessageTools, createMemoryTools, createOpenAiCompatLlm, memoryPromptBlock } from "@agenttag/runtime";
import { createDbMemoryStore } from "@agenttag/memory";
import { Worker } from "bullmq";
import { and, eq, gte, sql, sum } from "drizzle-orm";
import { Redis } from "ioredis";
import { ulid } from "ulid";
import { processSessionJob, type WorkerSession } from "./process-session.ts";

const SESSION_QUEUE = "agenttag";

export async function startWorker() {
  const env = parseEnv();
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const { db } = createDb(env.DATABASE_URL);
  const feishu = createFeishuClient({
    appId: env.FEISHU_APP_ID,
    appSecret: env.FEISHU_APP_SECRET,
  });
  const llm = createOpenAiCompatLlm({
    apiKey: env.DASHSCOPE_API_KEY,
    baseURL: env.DASHSCOPE_BASE_URL,
  });

  const worker = new Worker(
    SESSION_QUEUE,
    async (job) => {
      const sessionId = String((job.data as { sessionId?: string }).sessionId ?? "");
      if (!sessionId) {
        return;
      }
      const rows = await db.select().from(workingSessions).where(eq(workingSessions.id, sessionId)).limit(1);
      const row = rows[0];
      if (!row) {
        return;
      }
      const tools = createFeishuMessageTools(feishu, { chatId: row.chatId, threadId: row.threadId });
      const memoryStore = createDbMemoryStore(db);
      const chat = await feishu.getChat(row.chatId).catch(() => ({ chatType: "private" as const, external: false, name: "" }));
      const memories = await memoryStore.list({ tenantKey: row.tenantKey, chatId: row.chatId });
      const memoryTools = createMemoryTools(memoryStore, {
        tenantKey: row.tenantKey,
        chatId: row.chatId,
        openId: row.startedByOpenId,
        chatType: chat.chatType,
        sessionId: row.id,
      });
      const tenantRows = await db.select().from(tenants).where(eq(tenants.tenantKey, row.tenantKey)).limit(1);
      const runtime = resolveRuntimeModel({
        tenantModelId: tenantRows[0]?.modelId,
        tenantEnableThinking: tenantRows[0]?.enableThinking,
        envModelId: env.DASHSCOPE_MODEL,
      });
      await processSessionJob(
        { sessionId },
        {
          llm,
          model: runtime.modelId,
          enableThinking: runtime.enableThinking,
          loadSession: async (id) => {
            const latest = await db.select().from(workingSessions).where(eq(workingSessions.id, id)).limit(1);
            return (latest[0] as unknown as WorkerSession | undefined) ?? null;
          },
          patchCard: (messageId, card) => feishu.patchCard(messageId, card),
          recordUsage: async (usage) => {
            await db.insert(usageEvents).values({
              id: ulid(),
              tenantKey: row.tenantKey,
              chatId: usage.chatId,
              sessionId: usage.sessionId,
              openId: usage.openId,
              inputTokens: usage.inputTokens,
              outputTokens: usage.outputTokens,
              modelId: runtime.modelId,
            });
          },
          recordAudit: async (audit) => {
            await db.insert(auditEvents).values({
              id: ulid(),
              tenantKey: row.tenantKey,
              openId: audit.openId,
              chatId: audit.chatId,
              sessionId: audit.sessionId,
              toolName: audit.toolName,
              success: audit.success,
            });
          },
          markSession: async (id, status) => {
            await db
              .update(workingSessions)
              .set({
                status,
                lastActivityAt: new Date(),
              })
              .where(eq(workingSessions.id, id));
          },
          appendEvents: async (id, events, atIndex) => {
            if (atIndex == null) {
              await db
                .update(workingSessions)
                .set({
                  lastActivityAt: new Date(),
                  transcript: sql`coalesce(${workingSessions.transcript}, '[]'::jsonb) || ${JSON.stringify(events)}::jsonb`,
                })
                .where(eq(workingSessions.id, id));
              return;
            }
            for (const [offset, event] of events.entries()) {
              const index = atIndex + offset;
              const insert =
                index <= 0
                  ? sql`jsonb_insert(coalesce(${workingSessions.transcript}, '[]'::jsonb), '{0}', ${JSON.stringify(event)}::jsonb)`
                  : sql`jsonb_insert(coalesce(${workingSessions.transcript}, '[]'::jsonb), ${`{${index - 1}}`}::text[], ${JSON.stringify(event)}::jsonb, true)`;
              await db
                .update(workingSessions)
                .set({
                  lastActivityAt: new Date(),
                  transcript: insert,
                })
                .where(eq(workingSessions.id, id));
            }
          },
          listMessages: tools.feishu_list_messages,
          searchMessages: tools.feishu_search_messages,
          extraTools: memoryTools,
          memoryBlock: memoryPromptBlock(memories),
          getBudget: async (tenantKey) => {
            const tenantRows = await db.select().from(tenants).where(eq(tenants.tenantKey, tenantKey)).limit(1);
            const raw = tenantRows[0]?.monthlyLimitUsd;
            const parsed = raw == null || raw === "" ? null : Number(raw);
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
            return {
              usedUsd: tokensToUsd(Number(usageRows[0]?.input ?? 0), Number(usageRows[0]?.output ?? 0)),
              limitUsd: parsed != null && Number.isFinite(parsed) ? parsed : null,
            };
          },
        },
      );
    },
    { connection: redis },
  );

  worker.on("failed", (job, error) => {
    console.error("session.run failed", job?.id, error);
  });
  console.log("agent-worker listening");
}

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  startWorker().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
