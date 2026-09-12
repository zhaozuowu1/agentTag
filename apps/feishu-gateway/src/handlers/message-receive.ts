import { progressCard, FeishuApiError } from "@agenttag/feishu";
import {
  botAddedText,
  canStartSession,
  normalizeUserText,
  routeMessage,
  shouldRunInChat,
  type SessionStatus,
} from "@agenttag/domain";

export interface ReceiveMessageEvent {
  eventId: string;
  tenantKey: string;
  chatId: string;
  messageId: string;
  threadId: string | null;
  openId: string;
  text: string;
  mentionOpenIds: string[];
}

export interface MessageReceiveDeps {
  claimEvent(eventId: string): Promise<boolean>;
  botOpenId(): Promise<string>;
  getChat(chatId: string): Promise<{
    chatType: "public" | "private" | "p2p";
    external: boolean;
    name: string;
  }>;
  lookupGrant(tenantKey: string, chatId: string): Promise<{ authorized: boolean; enabled: boolean }>;
  findSession(input: {
    chatId: string;
    threadId: string | null;
  }): Promise<{ id: string; status: SessionStatus } | null>;
  createSession(input: {
    id: string;
    tenantKey: string;
    chatId: string;
    threadId: string | null;
    rootMessageId: string;
    kind: "chat" | "thread";
    startedByOpenId: string;
    checklistMessageId: string | null;
    userText: string;
  }): Promise<{ id: string; status: SessionStatus }>;
  archiveSession(sessionId: string): Promise<void>;
  replyInThread(messageId: string, card: unknown): Promise<{ messageId: string; threadId: string | null }>;
  sendText(chatId: string, text: string): Promise<void>;
  appendUserMessage(sessionId: string, openId: string, text: string): Promise<void>;
  enqueue(job: { sessionId: string }): Promise<void>;
  newId: () => string;
  getBudget(tenantKey: string): Promise<{ usedUsd: number; limitUsd: number | null }>;
  releaseEvent(eventId: string): Promise<void>;
}

export async function handleMessageReceive(
  event: ReceiveMessageEvent,
  deps: MessageReceiveDeps,
): Promise<void> {
  const claimed = await deps.claimEvent(event.eventId);
  if (!claimed) {
    return;
  }

  try {
    await handleClaimedMessage(event, deps);
  } catch (error) {
    await deps.releaseEvent(event.eventId);
    throw error;
  }
}

async function handleClaimedMessage(
  event: ReceiveMessageEvent,
  deps: MessageReceiveDeps,
): Promise<void> {

  const chat = await deps.getChat(event.chatId);
  const grant = await deps.lookupGrant(event.tenantKey, event.chatId);
  const runDecision = shouldRunInChat({
    authorized: grant.authorized,
    enabled: grant.enabled,
    external: chat.external,
    chatType: chat.chatType,
    allowP2p: false,
  });

  if (runDecision === "explain_p2p") {
    const text = botAddedText("explain_p2p");
    if (text) {
      await deps.sendText(event.chatId, text);
    }
    return;
  }

  const botOpenId = await deps.botOpenId();
  const mentionedBot = event.mentionOpenIds.includes(botOpenId);
  const existingSession = await deps.findSession({
    chatId: event.chatId,
    threadId: event.threadId,
  });
  const decision = routeMessage({
    chatId: event.chatId,
    messageId: event.messageId,
    openId: event.openId,
    text: event.text,
    mentionedBot,
    threadId: event.threadId,
    runDecision,
    existingSession,
  });

  if (decision.type === "ignore") {
    if (mentionedBot && runDecision === "run" && /^!routines$/i.test(normalizeUserText(event.text))) {
      await deps.sendText(event.chatId, "例行任务尚未开放。");
    }
    return;
  }

  if (decision.type === "steer") {
    const budget = await deps.getBudget(event.tenantKey);
    if (!canStartSession(budget.usedUsd, budget.limitUsd)) {
      const card = progressCard({
        title: "本月额度已用完",
        statusText: "本月额度已用完",
        checklist: [],
      });
      await deps.replyInThread(event.messageId, card);
      return;
    }
    await deps.appendUserMessage(decision.sessionId, decision.openId, decision.text);
    await deps.enqueue({ sessionId: decision.sessionId });
    return;
  }

  if (decision.type === "restart") {
    await deps.archiveSession(decision.sessionId);
  }

  const budget = await deps.getBudget(event.tenantKey);
  if (!canStartSession(budget.usedUsd, budget.limitUsd)) {
    const card = progressCard({
      title: "本月额度已用完",
      statusText: "本月额度已用完",
      checklist: [],
    });
    await deps.replyInThread(event.messageId, card);
    return;
  }

  const userText =
    decision.type === "start_task" ? decision.text : normalizeUserText(event.text);
  const card = progressCard({
    title: "收到，正在处理",
    statusText: "已排队，我会在话题里更新进度。",
    checklist: [{ id: "queue", label: "开始处理", status: "doing" }],
  });
  let reply: { messageId: string; threadId: string | null };
  try {
    reply = await deps.replyInThread(event.messageId, card);
  } catch (error) {
    if (error instanceof FeishuApiError && error.code === 230071) {
      await deps.sendText(event.chatId, "收到，正在处理。本群暂不支持话题，我会在群里继续回复。");
      reply = { messageId: event.messageId, threadId: null };
    } else {
      throw error;
    }
  }
  const sessionId = deps.newId();
  await deps.createSession({
    id: sessionId,
    tenantKey: event.tenantKey,
    chatId: event.chatId,
    threadId: reply.threadId ?? event.threadId,
    rootMessageId: event.messageId,
    kind: reply.threadId ? "thread" : "chat",
    startedByOpenId: event.openId,
    checklistMessageId: reply.messageId,
    userText,
  });
  await deps.enqueue({ sessionId });
}
