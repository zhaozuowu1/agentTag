import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "@agenttag/config";
import { createDb } from "@agenttag/db";
import { createFeishuClient } from "@agenttag/feishu";
import { serve } from "@hono/node-server";
import { Queue } from "bullmq";
import { Hono } from "hono";
import { Redis } from "ioredis";
import { ulid } from "ulid";
import {
  eventVerificationToken,
  feishuRequestSignature,
  signaturesMatch,
  unwrapFeishuBody,
} from "./encrypt.ts";
import { handleBotAdded } from "./handlers/bot-added.ts";
import { handleMessageReceive } from "./handlers/message-receive.ts";
import { parseBotAdded, parseReceiveMessage } from "./parse-event.ts";
import { DEFAULT_EVENT_RETRY, runWithRetry, type RetryOptions } from "./retry.ts";
import { createGatewayStore } from "./store.ts";

const SESSION_QUEUE = "agenttag";

export function createGatewayApp(options: {
  encryptKey: string;
  verificationToken?: string;
  onEvent: (payload: Record<string, unknown>) => Promise<void>;
  retry?: RetryOptions;
}) {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.post("/feishu/events", async (c) => {
    const rawText = await c.req.text();
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(rawText) as Record<string, unknown>;
    } catch {
      return c.json({ error: "invalid json" }, 400);
    }
    if (options.encryptKey && typeof raw.encrypt !== "string") {
      return c.json({ error: "encrypted payload required" }, 400);
    }
    const payload = unwrapFeishuBody(raw, options.encryptKey);
    if (options.verificationToken && eventVerificationToken(payload) !== options.verificationToken) {
      return c.json({ error: "invalid verification token" }, 403);
    }
    const isUrlVerification = payload.type === "url_verification";
    if (!isUrlVerification && options.encryptKey) {
      const timestamp = c.req.header("X-Lark-Request-Timestamp") ?? "";
      const nonce = c.req.header("X-Lark-Request-Nonce") ?? "";
      const signature = c.req.header("X-Lark-Signature") ?? "";
      const expected = feishuRequestSignature(timestamp, nonce, options.encryptKey, rawText);
      if (!signature || !signaturesMatch(expected, signature)) {
        return c.json({ error: "invalid signature" }, 401);
      }
    }
    if (isUrlVerification) {
      return c.json({ challenge: payload.challenge });
    }
    setImmediate(() => {
      void runWithRetry(() => options.onEvent(payload), options.retry ?? DEFAULT_EVENT_RETRY).catch((error) => {
        console.error("feishu event handler failed", error);
      });
    });
    return c.json({ code: 0 });
  });
  return app;
}

export async function claimEvent(redis: Redis, eventId: string): Promise<boolean> {
  const ok = await redis.set(`feishu:event:${eventId}`, "1", "EX", 86400, "NX");
  return ok === "OK";
}

export async function releaseEvent(redis: Redis, eventId: string): Promise<void> {
  await redis.del(`feishu:event:${eventId}`);
}

export async function startGateway() {
  const env = parseEnv();
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue(SESSION_QUEUE, { connection: redis });
  const { db } = createDb(env.DATABASE_URL);
  const store = createGatewayStore(db);
  const feishu = createFeishuClient({
    appId: env.FEISHU_APP_ID,
    appSecret: env.FEISHU_APP_SECRET,
  });

  const app = createGatewayApp({
    encryptKey: env.FEISHU_ENCRYPT_KEY,
    verificationToken: env.FEISHU_VERIFICATION_TOKEN,
    onEvent: async (payload) => {
      const header = payload.header as { event_type?: string } | undefined;
      const eventType = header?.event_type;
      if (eventType === "im.chat.member.bot.added_v1") {
        const parsed = parseBotAdded(payload);
        if (!parsed) {
          return;
        }
        const claimed = await claimEvent(redis, parsed.eventId);
        if (!claimed) {
          return;
        }
        try {
          await store.ensureTenant(parsed.tenantKey);
          await handleBotAdded(parsed, {
            getChat: (chatId) => feishu.getChat(chatId),
            lookupGrant: (tenantKey, chatId) => store.lookupGrant(tenantKey, chatId),
            sendText: async (chatId, text) => {
              await feishu.sendText(chatId, text);
            },
          });
        } catch (error) {
          await releaseEvent(redis, parsed.eventId);
          throw error;
        }
        return;
      }
      if (eventType === "im.message.receive_v1") {
        const parsed = parseReceiveMessage(payload);
        if (!parsed) {
          return;
        }
        await store.ensureTenant(parsed.tenantKey);
        await handleMessageReceive(parsed, {
          claimEvent: (eventId) => claimEvent(redis, eventId),
          botOpenId: () => feishu.botOpenId(),
          getChat: (chatId) => feishu.getChat(chatId),
          lookupGrant: (tenantKey, chatId) => store.lookupGrant(tenantKey, chatId),
          findSession: (input) => store.findSession(input),
          createSession: (input) => store.createSession(input),
          archiveSession: (id) => store.archiveSession(id),
          replyInThread: (messageId, card) => feishu.replyInThread(messageId, card),
          sendText: async (chatId, text) => {
            await feishu.sendText(chatId, text);
          },
          sendCard: async (chatId, card) => feishu.sendCard(chatId, card),
          appendUserMessage: (sessionId, openId, text) => store.appendUserMessage(sessionId, openId, text),
          enqueue: async (job) => {
            try {
              await queue.add("session.run", job, {
                jobId: job.sessionId,
                removeOnComplete: true,
                removeOnFail: true,
              });
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              if (/already exists|Job is already/i.test(message)) {
                return;
              }
              throw error;
            }
          },
          newId: () => ulid(),
          getBudget: (tenantKey) => store.getBudget(tenantKey),
          releaseEvent: (eventId) => releaseEvent(redis, eventId),
        });
      }
    },
  });

  const port = Number(process.env.PORT ?? 3000);
  serve({ fetch: app.fetch, port });
  console.log(`feishu-gateway listening on ${port}`);
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(resolve(entry)).href) {
  startGateway().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
