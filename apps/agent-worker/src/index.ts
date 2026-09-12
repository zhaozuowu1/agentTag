import { parseEnv } from "@agenttag/config";
import { auditEvents, createDb, usageEvents, workingSessions } from "@agenttag/db";
import { createFeishuClient } from "@agenttag/feishu";
import { createFeishuMessageTools, createMemoryTools, memoryPromptBlock, type LlmClient } from "@agenttag/runtime";
import { createDbMemoryStore } from "@agenttag/memory";
import Anthropic from "@anthropic-ai/sdk";
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import Redis from "ioredis";
import { ulid } from "ulid";
import { processSessionJob, type WorkerSession } from "./process-session.ts";

const SESSION_QUEUE = "agenttag";

function createAnthropicLlm(env: { ANTHROPIC_API_KEY: string; ANTHROPIC_BASE_URL?: string }): LlmClient {
  const client = new Anthropic({
    apiKey: env.ANTHROPIC_API_KEY,
    baseURL: env.ANTHROPIC_BASE_URL,
  });
  return {
    async create(params) {
      const response = await client.messages.create({
        model: params.model,
        max_tokens: 4096,
        system: params.system,
        messages: params.messages as Anthropic.MessageParam[],
        tools: params.tools as Anthropic.Tool[],
      });
      return {
        stop_reason: response.stop_reason ?? "end_turn",
        content: response.content.flatMap((part) => {
          if (part.type === "text") {
            return [{ type: "text" as const, text: part.text }];
          }
          if (part.type === "tool_use") {
            return [{ type: "tool_use" as const, id: part.id, name: part.name, input: part.input }];
          }
          return [];
        }),
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
      };
    },
  };
}

export async function startWorker() {
  const env = parseEnv();
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const { db } = createDb(env.DATABASE_URL);
  const feishu = createFeishuClient({
    appId: env.FEISHU_APP_ID,
    appSecret: env.FEISHU_APP_SECRET,
  });
  const llm = createAnthropicLlm(env);

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
      await processSessionJob(
        { sessionId },
        {
          llm,
          loadSession: async () => row as unknown as WorkerSession,
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
          markSession: async (id, status, transcript) => {
            await db
              .update(workingSessions)
              .set({
                status,
                lastActivityAt: new Date(),
                ...(transcript ? { transcript } : {}),
              })
              .where(eq(workingSessions.id, id));
          },
          listMessages: tools.feishu_list_messages,
          searchMessages: tools.feishu_search_messages,
          extraTools: memoryTools,
          memoryBlock: memoryPromptBlock(memories),
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
