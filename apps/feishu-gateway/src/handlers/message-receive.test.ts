import { progressCard } from "@agenttag/feishu";
import { describe, expect, it } from "vitest";
import { handleMessageReceive, type MessageReceiveDeps, type ReceiveMessageEvent } from "./message-receive.ts";

const event: ReceiveMessageEvent = {
  eventId: "ev_mention_1",
  tenantKey: "tenant_demo",
  chatId: "oc_auth",
  messageId: "om_1",
  threadId: null,
  openId: "ou_user",
  text: "@_user_1 总结本群未关闭事项",
  mentionOpenIds: ["ou_bot"],
};

function createDeps(overrides: Partial<MessageReceiveDeps> = {}) {
  const claimed = new Set<string>();
  const enqueued: Array<{ sessionId: string }> = [];
  const replies: Array<{ messageId: string; card: unknown }> = [];
  const sessions: Array<{ id: string; status: "running" | "idle" | "archived" | "failed"; threadId: string | null }> =
    [];

  const deps: MessageReceiveDeps & { enqueued: typeof enqueued; replies: typeof replies } = {
    enqueued,
    replies,
    claimEvent: async (eventId) => {
      if (claimed.has(eventId)) {
        return false;
      }
      claimed.add(eventId);
      return true;
    },
    botOpenId: async () => "ou_bot",
    getChat: async () => ({ chatType: "public", external: false, name: "授权群" }),
    lookupGrant: async () => ({ authorized: true, enabled: true }),
    findSession: async ({ threadId }) => {
      const found = sessions.find((s) => s.threadId === threadId && (s.status === "running" || s.status === "idle"));
      return found ? { id: found.id, status: found.status } : null;
    },
    createSession: async (input) => {
      const record = { id: input.id, status: "running" as const, threadId: input.threadId };
      sessions.push(record);
      return record;
    },
    archiveSession: async (id) => {
      const found = sessions.find((s) => s.id === id);
      if (found) {
        found.status = "archived";
      }
    },
    replyInThread: async (messageId, card) => {
      replies.push({ messageId, card });
      return { messageId: "om_card", threadId: "omt_new" };
    },
    sendText: async () => {},
    enqueue: async (job) => {
      enqueued.push(job);
    },
    newId: () => "sess_1",
    ...overrides,
  };
  return deps;
}

describe("handleMessageReceive", () => {
  it("replies with a received card and enqueues session.run once per event_id", async () => {
    const deps = createDeps();
    await handleMessageReceive(event, deps);
    await handleMessageReceive(event, deps);

    expect(deps.replies).toHaveLength(1);
    const card = deps.replies[0]?.card as { schema?: string; header?: { title?: { content?: string } } };
    expect(card.schema).toBe("2.0");
    expect(card.header?.title?.content).toBe("收到，正在处理");
    expect(deps.enqueued).toEqual([{ sessionId: "sess_1" }]);
  });

  it("ignores mentions in unauthorized chats without enqueueing", async () => {
    const deps = createDeps({
      lookupGrant: async () => ({ authorized: false, enabled: false }),
    });
    await handleMessageReceive(event, deps);
    expect(deps.enqueued).toEqual([]);
    expect(deps.replies).toEqual([]);
  });
});

describe("progressCard copy", () => {
  it("uses Chinese received copy for the first checklist card", () => {
    const card = progressCard({
      title: "收到，正在处理",
      statusText: "已排队，我会在话题里更新进度。",
      checklist: [{ id: "queue", label: "开始处理", status: "doing" }],
    });
    expect(card.header.title.content).toBe("收到，正在处理");
  });
});
