import { describe, expect, it } from "vitest";
import { routeMessage, type RouteInput } from "./routing.ts";

const receiveFixture = {
  header: {
    event_id: "ev_mention_1",
    event_type: "im.message.receive_v1",
    tenant_key: "tenant_demo",
  },
  event: {
    sender: { sender_id: { open_id: "ou_user" }, sender_type: "user" },
    message: {
      message_id: "om_1",
      chat_id: "oc_auth",
      chat_type: "group",
      content: JSON.stringify({ text: "@_user_1 总结本群未关闭事项" }),
      mentions: [
        {
          key: "@_user_1",
          id: { open_id: "ou_bot" },
          name: "Claude",
        },
      ],
    },
  },
};

function fromFixture(overrides: Partial<RouteInput> = {}): RouteInput {
  const message = receiveFixture.event.message;
  const text = JSON.parse(message.content).text as string;
  return {
    chatId: message.chat_id,
    messageId: message.message_id,
    openId: receiveFixture.event.sender.sender_id.open_id,
    text,
    mentionedBot: message.mentions.some((m) => m.id.open_id === "ou_bot"),
    threadId: null,
    runDecision: "run",
    existingSession: null,
    ...overrides,
  };
}

describe("routeMessage", () => {
  it("starts a task when im.message.receive_v1 mentions the bot", () => {
    expect(routeMessage(fromFixture())).toEqual({
      type: "start_task",
      chatId: "oc_auth",
      messageId: "om_1",
      openId: "ou_user",
      text: "总结本群未关闭事项",
    });
  });

  it("ignores messages with no mention and no session", () => {
    expect(
      routeMessage(
        fromFixture({
          mentionedBot: false,
          text: "随便聊聊",
          existingSession: null,
        }),
      ),
    ).toEqual({ type: "ignore" });
  });

  it("steers an existing running or idle thread session without a mention", () => {
    expect(
      routeMessage(
        fromFixture({
          mentionedBot: false,
          text: "把结论改成表格",
          threadId: "omt_1",
          existingSession: { id: "sess_1", status: "idle" },
        }),
      ),
    ).toEqual({
      type: "steer",
      sessionId: "sess_1",
      text: "把结论改成表格",
      openId: "ou_user",
    });
  });

  it("restarts when mentioned with !restart", () => {
    expect(
      routeMessage(
        fromFixture({
          text: "!restart",
          existingSession: { id: "sess_1", status: "running" },
        }),
      ),
    ).toEqual({ type: "restart", sessionId: "sess_1" });
  });

  it("ignores unauthorized chats even when mentioned", () => {
    expect(routeMessage(fromFixture({ runDecision: "explain_unauthorized" }))).toEqual({
      type: "ignore",
    });
  });
});
