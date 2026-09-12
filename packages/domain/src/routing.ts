import type { RunDecision } from "./authz.ts";

export type SessionStatus = "running" | "idle" | "archived" | "failed";

export type RouteDecision =
  | { type: "start_task"; chatId: string; messageId: string; openId: string; text: string }
  | { type: "steer"; sessionId: string; text: string; openId: string }
  | { type: "restart"; sessionId: string }
  | { type: "ignore" };

export interface RouteInput {
  chatId: string;
  messageId: string;
  openId: string;
  text: string;
  mentionedBot: boolean;
  threadId: string | null;
  runDecision: RunDecision;
  existingSession: { id: string; status: SessionStatus } | null;
}

export function normalizeUserText(text: string): string {
  return text.replace(/@_user_\d+/g, "").replace(/\s+/g, " ").trim();
}

export function routeMessage(input: RouteInput): RouteDecision {
  if (input.runDecision !== "run") {
    return { type: "ignore" };
  }

  const text = normalizeUserText(input.text);
  const active =
    input.existingSession &&
    (input.existingSession.status === "running" || input.existingSession.status === "idle")
      ? input.existingSession
      : null;

  if (input.mentionedBot) {
    if (/^!restart$/i.test(text)) {
      if (input.existingSession) {
        return { type: "restart", sessionId: input.existingSession.id };
      }
      return {
        type: "start_task",
        chatId: input.chatId,
        messageId: input.messageId,
        openId: input.openId,
        text,
      };
    }
    if (/^!routines$/i.test(text)) {
      return { type: "ignore" };
    }
    if (active) {
      return { type: "steer", sessionId: active.id, text, openId: input.openId };
    }
    return {
      type: "start_task",
      chatId: input.chatId,
      messageId: input.messageId,
      openId: input.openId,
      text,
    };
  }

  if (active) {
    return { type: "steer", sessionId: active.id, text, openId: input.openId };
  }
  return { type: "ignore" };
}
