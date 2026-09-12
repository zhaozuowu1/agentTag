import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "@agenttag/config";
import { createDb } from "@agenttag/db";
import { createFeishuClient } from "@agenttag/feishu";
import { serve } from "@hono/node-server";
import { Queue } from "bullmq";
import { Hono } from "hono";
import Redis from "ioredis";
import { ulid } from "ulid";
import { unwrapFeishuBody } from "./encrypt.ts";
import { handleBotAdded } from "./handlers/bot-added.ts";
import { handleMessageReceive } from "./handlers/message-receive.ts";
import { parseBotAdded, parseReceiveMessage } from "./parse-event.ts";
import { createGatewayStore } from "./store.ts";

const SESSION_QUEUE = "agenttag";

export function createGatewayApp(options: {
  encryptKey: string;
  verificationToken?: string;
  onEvent: (payload: Record<string, unknown>) => Promise<void>;
}) {
  const app = new Hono();
  app.get("/health", (c) => c.json({ ok: true }));
  app.post("/feishu/events", async (c) => {
    const raw = (await c.req.json()) as Record<string, unknown>;
    const payload = unwrapFeishuBody(raw, options.encryptKey);
    if (payload.type === "url_verification" || typeof payload.challenge === "string") {
      if (
        options.verificationToken &&
        typeof payload.token === "string" &&
        payload.token !== options.verificationToken
      ) {
        return c.json({ error: "invalid verification token" }, 403);
      }
      return c.json({ challenge: payload.challenge });
    }
    await options.onEvent(payload);
    return c.json({ code: 0 });
  });
  return app;
}

export async function claimEvent(redis: Redis, eventId: string): Promise<boolean> {
  const ok = await redis.set(`feishu:event:${eventId}`, "1", "EX", 86400, "NX");
  return ok === "OK";
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
        await store.ensureTenant(parsed.tenantKey);
        await handleBotAdded(parsed, {
          getChat: (chatId) => feishu.getChat(chatId),
          lookupGrant: (tenantKey, chatId) => store.lookupGrant(tenantKey, chatId),
          sendText: async (chatId, text) => {
            await feishu.sendText(chatId, text);
          },
        });
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
          appendUserMessage: (sessionId, openId, text) => store.appendUserMessage(sessionId, openId, text),
          enqueue: async (job) => {
            await queue.add("session.run", job);
          },
          newId: () => ulid(),
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
