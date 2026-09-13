import { Domain } from "@larksuiteoapi/node-sdk";
import { describe, expect, it, vi } from "vitest";
import { parseBotAdded, parseReceiveMessage } from "./parse-event.ts";
import {
  createFeishuEventDispatcher,
  larkDispatcherDataToPayload,
  larkWsClientConfig,
  startFeishuLongConnection,
} from "./lark-ws.ts";

const mentionEnvelope = {
  schema: "2.0",
  header: {
    event_id: "ev_mention_1",
    event_type: "im.message.receive_v1",
    tenant_key: "tenant_demo",
    token: "vtoken",
    app_id: "cli_app",
  },
  event: {
    sender: { sender_id: { open_id: "ou_user" } },
    message: {
      message_id: "om_1",
      chat_id: "oc_auth",
      content: JSON.stringify({ text: "@_user_1 总结本群未关闭事项" }),
      mentions: [{ id: { open_id: "ou_bot" } }],
    },
  },
};

const botAddedEnvelope = {
  schema: "2.0",
  header: {
    event_id: "ev_bot_added",
    event_type: "im.chat.member.bot.added_v1",
    tenant_key: "tenant_demo",
  },
  event: { chat_id: "oc_auth" },
};

const botDeletedEnvelope = {
  schema: "2.0",
  header: {
    event_id: "ev_bot_deleted",
    event_type: "im.chat.member.bot.deleted_v1",
    tenant_key: "tenant_demo",
  },
  event: { chat_id: "oc_auth" },
};

describe("larkDispatcherDataToPayload", () => {
  it("rebuilds the webhook envelope EventDispatcher flattens for handlers", () => {
    const flattened = {
      schema: "2.0",
      event_id: "ev_mention_1",
      event_type: "im.message.receive_v1",
      tenant_key: "tenant_demo",
      sender: mentionEnvelope.event.sender,
      message: mentionEnvelope.event.message,
    };
    const payload = larkDispatcherDataToPayload(flattened);
    expect(parseReceiveMessage(payload)).toMatchObject({
      eventId: "ev_mention_1",
      chatId: "oc_auth",
      mentionOpenIds: ["ou_bot"],
      text: "@_user_1 总结本群未关闭事项",
    });
  });
});

describe("createFeishuEventDispatcher", () => {
  it("routes receive / bot added / bot deleted into the existing payload parser", async () => {
    const seen: Array<{ type?: string; parsed: unknown }> = [];
    const dispatcher = createFeishuEventDispatcher({
      onEvent: async (payload) => {
        const header = payload.header as { event_type?: string } | undefined;
        seen.push({
          type: header?.event_type,
          parsed:
            header?.event_type === "im.message.receive_v1"
              ? parseReceiveMessage(payload)
              : parseBotAdded(payload),
        });
      },
    });

    await dispatcher.invoke(mentionEnvelope, { needCheck: false });
    await dispatcher.invoke(botAddedEnvelope, { needCheck: false });
    await dispatcher.invoke(botDeletedEnvelope, { needCheck: false });

    await vi.waitFor(() => {
      expect(seen.map((item) => item.type)).toEqual([
        "im.message.receive_v1",
        "im.chat.member.bot.added_v1",
        "im.chat.member.bot.deleted_v1",
      ]);
    });
    expect(seen[0]?.parsed).toMatchObject({ eventId: "ev_mention_1", chatId: "oc_auth" });
    expect(seen[1]?.parsed).toMatchObject({ eventId: "ev_bot_added", chatId: "oc_auth" });
    expect(seen[2]?.parsed).toMatchObject({ eventId: "ev_bot_deleted", chatId: "oc_auth" });
  });

  it("returns from EventDispatcher before business onEvent finishes", async () => {
    let finished = false;
    const dispatcher = createFeishuEventDispatcher({
      onEvent: async () => {
        await new Promise((resolve) => setTimeout(resolve, 80));
        finished = true;
      },
    });
    await dispatcher.invoke(mentionEnvelope, { needCheck: false });
    expect(finished).toBe(false);
    await vi.waitFor(() => {
      expect(finished).toBe(true);
    });
  });
});

describe("startFeishuLongConnection", () => {
  it("starts WSClient only for websocket mode", async () => {
    const started: unknown[] = [];
    await startFeishuLongConnection({
      mode: "http",
      appId: "cli_app",
      appSecret: "secret",
      eventDispatcher: createFeishuEventDispatcher({ onEvent: async () => undefined }),
      startWsClient: async (opts) => {
        started.push(opts);
      },
    });
    expect(started).toEqual([]);

    const dispatcher = createFeishuEventDispatcher({ onEvent: async () => undefined });
    await startFeishuLongConnection({
      mode: "websocket",
      appId: "cli_app",
      appSecret: "secret",
      eventDispatcher: dispatcher,
      startWsClient: async (opts) => {
        started.push(opts);
      },
    });
    expect(started).toEqual([{ appId: "cli_app", appSecret: "secret", eventDispatcher: dispatcher }]);
  });

  it("targets the China Feishu open platform, not Lark international", () => {
    const config = larkWsClientConfig({ appId: "cli_app", appSecret: "secret" });
    expect(config.domain).toBe(Domain.Feishu);
  });
});
