import { progressCard } from "@agenttag/feishu";
import { describe, expect, it } from "vitest";
import type { EventProgress } from "../event-progress.ts";
import { handleMessageReceive, type MessageReceiveDeps, type ReceiveMessageEvent } from "./message-receive.ts";

const event: ReceiveMessageEvent = {
  eventId: "ev_mention_1",
  tenantKey: "tenant_demo",
  chatId: "oc_auth",
  messageId: "om_1",
  threadId: null,
  rootId: null,
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
  const progress = new Map<string, EventProgress>();

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
    sendCard: async () => ({ messageId: "om_fallback_card" }),
    appendUserMessage: async () => {},
    enqueue: async (job) => {
      enqueued.push(job);
    },
    newId: () => "sess_1",
    getBudget: async () => ({ usedUsd: 0, limitUsd: null }),
    releaseEvent: async (eventId) => {
      claimed.delete(eventId);
    },
    loadProgress: async (eventId) => progress.get(eventId) ?? null,
    saveProgress: async (eventId, patch) => {
      progress.set(eventId, { ...progress.get(eventId), ...patch });
    },
    retry: { attempts: 3, delayMs: 0 },
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

  it("steers in-thread follow-ups without another mention", async () => {
    const appended: Array<{ sessionId: string; text: string; openId: string }> = [];
    const deps = createDeps({
      findSession: async () => ({ id: "sess_live", status: "idle" }),
      appendUserMessage: async (sessionId, openId, text) => {
        appended.push({ sessionId, openId, text });
      },
    });
    await handleMessageReceive(
      {
        ...event,
        eventId: "ev_steer",
        threadId: "omt_1",
        mentionOpenIds: [],
        text: "把结论改成表格",
      },
      deps,
    );
    expect(appended).toEqual([{ sessionId: "sess_live", openId: "ou_user", text: "把结论改成表格" }]);
    expect(deps.enqueued).toEqual([{ sessionId: "sess_live" }]);
    expect(deps.replies).toEqual([]);
  });

  it("archives the current session on !restart and starts a new one", async () => {
    const archived: string[] = [];
    const deps = createDeps({
      findSession: async () => ({ id: "sess_old", status: "running" }),
      archiveSession: async (id) => {
        archived.push(id);
      },
      newId: () => "sess_new",
    });
    await handleMessageReceive(
      {
        ...event,
        eventId: "ev_restart",
        text: "!restart",
      },
      deps,
    );
    expect(archived).toEqual(["sess_old"]);
    expect(deps.enqueued).toEqual([{ sessionId: "sess_new" }]);
    expect(deps.replies).toHaveLength(1);
  });

  it("does not enqueue a new session when the tenant monthly budget is exhausted", async () => {
    const deps = createDeps({
      getBudget: async () => ({ usedUsd: 10, limitUsd: 10 }),
    });
    await handleMessageReceive({ ...event, eventId: "ev_budget" }, deps);
    expect(deps.enqueued).toEqual([]);
    const card = deps.replies[0]?.card as { header?: { title?: { content?: string } } };
    expect(card.header?.title?.content).toBe("本月额度已用完");
  });

  it("rejects in-thread steer when the tenant monthly budget is exhausted", async () => {
    const appended: string[] = [];
    const deps = createDeps({
      findSession: async () => ({ id: "sess_live", status: "idle" }),
      appendUserMessage: async () => {
        appended.push("steer");
      },
      getBudget: async () => ({ usedUsd: 10, limitUsd: 10 }),
    });
    await handleMessageReceive(
      {
        ...event,
        eventId: "ev_steer_budget",
        threadId: "omt_1",
        mentionOpenIds: [],
        text: "把结论改成表格",
      },
      deps,
    );
    expect(appended).toEqual([]);
    expect(deps.enqueued).toEqual([]);
    const card = deps.replies[0]?.card as { header?: { title?: { content?: string } } };
    expect(card.header?.title?.content).toBe("本月额度已用完");
  });

  it("sends only one progress card when createSession fails and the same event is retried", async () => {
    const claimed = new Set<string>();
    const replies: unknown[] = [];
    const progress = new Map<string, { card?: { messageId: string; threadId: string | null }; sessionId?: string }>();
    const claimEvent = async (eventId: string) => {
      if (claimed.has(eventId)) {
        return false;
      }
      claimed.add(eventId);
      return true;
    };
    const releaseEvent = async (eventId: string) => {
      claimed.delete(eventId);
    };
    const replyInThread: MessageReceiveDeps["replyInThread"] = async (_messageId, card) => {
      replies.push(card);
      return { messageId: "om_card", threadId: "omt_new" };
    };
    let creates = 0;
    const run = () =>
      handleMessageReceive(
        event,
        createDeps({
          claimEvent,
          releaseEvent,
          replyInThread,
          loadProgress: async (eventId) => progress.get(eventId) ?? null,
          saveProgress: async (eventId, patch) => {
            progress.set(eventId, { ...progress.get(eventId), ...patch });
          },
          retry: { attempts: 1, delayMs: 0 },
          createSession: async (input) => {
            creates += 1;
            if (creates < 3) {
              throw new Error("db timeout");
            }
            return { id: input.id, status: "running" };
          },
        }),
      );
    await expect(run()).rejects.toThrow(/db timeout/);
    await expect(run()).rejects.toThrow(/db timeout/);
    await run();
    expect(replies).toHaveLength(1);
    expect(creates).toBe(3);
  });

  it("releases the dedup key when handling fails so a retry can proceed", async () => {
    const claimed = new Set<string>();
    const claimEvent = async (eventId: string) => {
      if (claimed.has(eventId)) {
        return false;
      }
      claimed.add(eventId);
      return true;
    };
    const releaseEvent = async (eventId: string) => {
      claimed.delete(eventId);
    };
    const failing = createDeps({
      claimEvent,
      releaseEvent,
      getChat: async () => {
        throw new Error("feishu timeout");
      },
    });
    await expect(handleMessageReceive(event, failing)).rejects.toThrow(/timeout/);
    const retry = createDeps({ claimEvent, releaseEvent });
    await handleMessageReceive(event, retry);
    expect(retry.enqueued).toEqual([{ sessionId: "sess_1" }]);
  });

  it("sends a group card when reply_in_thread returns 230071", async () => {
    const { FeishuApiError } = await import("@agenttag/feishu");
    const created: Array<{ checklistMessageId: string | null; threadId: string | null; rootMessageId: string }> = [];
    const deps = createDeps({
      replyInThread: async () => {
        throw new FeishuApiError("topic disabled", 230071, 400);
      },
      sendCard: async () => ({ messageId: "om_bot_card" }),
      createSession: async (input) => {
        created.push({
          checklistMessageId: input.checklistMessageId,
          threadId: input.threadId,
          rootMessageId: input.rootMessageId,
        });
        return { id: input.id, status: "running" };
      },
    });
    await handleMessageReceive(event, deps);
    expect(created).toEqual([
      { checklistMessageId: "om_bot_card", threadId: null, rootMessageId: "om_1" },
    ]);
    expect(deps.enqueued).toEqual([{ sessionId: "sess_1" }]);
  });

  it("looks up an in-chat session by root_message_id when threadId is missing", async () => {
    const lookedUp: Array<{ chatId: string; threadId: string | null; rootMessageId?: string | null }> = [];
    const appended: string[] = [];
    const deps = createDeps({
      findSession: async (input) => {
        lookedUp.push(input);
        return { id: "sess_root", status: "idle" };
      },
      appendUserMessage: async (_sessionId, _openId, text) => {
        appended.push(text);
      },
    });
    await handleMessageReceive(
      {
        ...event,
        eventId: "ev_steer_root",
        threadId: null,
        rootId: "om_root",
        mentionOpenIds: [],
        text: "把结论改成表格",
      },
      deps,
    );
    expect(lookedUp[0]).toMatchObject({ chatId: "oc_auth", rootMessageId: "om_root" });
    expect(appended).toEqual(["把结论改成表格"]);
    expect(deps.enqueued).toEqual([{ sessionId: "sess_root" }]);
  });

  it("steers a reply to the sendCard fallback when root_id is the bot card id", async () => {
    const { FeishuApiError } = await import("@agenttag/feishu");
    const created: Array<{
      id: string;
      status: "running" | "idle";
      threadId: string | null;
      rootMessageId: string;
      checklistMessageId: string | null;
    }> = [];
    const appended: string[] = [];
    const findSession: MessageReceiveDeps["findSession"] = async (input) => {
      if (input.threadId) {
        const byThread = created.find(
          (session) => session.threadId === input.threadId && (session.status === "running" || session.status === "idle"),
        );
        if (byThread) {
          return { id: byThread.id, status: byThread.status };
        }
      }
      if (input.rootMessageId) {
        const byKey = created.find(
          (session) =>
            (session.status === "running" || session.status === "idle") &&
            (session.rootMessageId === input.rootMessageId || session.checklistMessageId === input.rootMessageId),
        );
        if (byKey) {
          return { id: byKey.id, status: byKey.status };
        }
      }
      return null;
    };
    const deps = createDeps({
      replyInThread: async () => {
        throw new FeishuApiError("topic disabled", 230071, 400);
      },
      sendCard: async () => ({ messageId: "om_bot_card" }),
      createSession: async (input) => {
        const record = {
          id: input.id,
          status: "running" as const,
          threadId: input.threadId,
          rootMessageId: input.rootMessageId,
          checklistMessageId: input.checklistMessageId,
        };
        created.push(record);
        return { id: input.id, status: "running" as const };
      },
      findSession,
      appendUserMessage: async (_sessionId, _openId, text) => {
        appended.push(text);
      },
    });
    await handleMessageReceive(event, deps);
    await handleMessageReceive(
      {
        ...event,
        eventId: "ev_card_reply",
        messageId: "om_follow",
        threadId: null,
        rootId: "om_bot_card",
        mentionOpenIds: [],
        text: "把结论改成表格",
      },
      deps,
    );
    expect(appended).toEqual(["把结论改成表格"]);
    expect(deps.enqueued).toEqual([{ sessionId: "sess_1" }, { sessionId: "sess_1" }]);
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
