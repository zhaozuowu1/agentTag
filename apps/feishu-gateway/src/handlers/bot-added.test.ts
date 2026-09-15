import { describe, expect, it } from "vitest";
import { handleBotAdded, type BotAddedDeps } from "./bot-added.ts";

describe("handleBotAdded", () => {
  it("sends only one welcome when the same event is retried after sendText succeeded", async () => {
    const texts: string[] = [];
    const progress = new Map<string, { welcomeSent?: boolean }>();
    const deps: BotAddedDeps = {
      getChat: async () => ({ chatType: "public", external: false, name: "授权群" }),
      lookupGrant: async () => ({ authorized: true, enabled: true }),
      getRuntimeModel: async () => ({ modelId: "qwen3.8-max", enableThinking: false, source: "env" }),
      sendText: async (_chatId, text) => {
        texts.push(text);
      },
      loadProgress: async (eventId) => progress.get(eventId) ?? null,
      saveProgress: async (eventId, patch) => {
        progress.set(eventId, { ...progress.get(eventId), ...patch });
      },
    };
    const event = { eventId: "ev_bot_1", tenantKey: "tenant_demo", chatId: "oc_auth" };
    await handleBotAdded(event, deps);
    await handleBotAdded(event, deps);
    await handleBotAdded(event, deps);
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain("队友");
  });

  it("includes the runtime model id in the authorized welcome", async () => {
    const texts: string[] = [];
    const progress = new Map<string, { welcomeSent?: boolean }>();
    const deps: BotAddedDeps = {
      getChat: async () => ({ chatType: "public", external: false, name: "授权群" }),
      lookupGrant: async () => ({ authorized: true, enabled: true }),
      getRuntimeModel: async () => ({ modelId: "kimi-k3", enableThinking: true, source: "tenant" }),
      sendText: async (_chatId, text) => {
        texts.push(text);
      },
      loadProgress: async (eventId) => progress.get(eventId) ?? null,
      saveProgress: async (eventId, patch) => {
        progress.set(eventId, { ...progress.get(eventId), ...patch });
      },
    };
    await handleBotAdded({ eventId: "ev_bot_model", tenantKey: "tenant_demo", chatId: "oc_auth" }, deps);
    expect(texts[0]).toBe("我是本群队友（`kimi-k3`），@ 我即可把任务交给我。");
    expect(texts[0]).not.toContain("Claude");
  });
});
