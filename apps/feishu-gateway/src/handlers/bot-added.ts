import { botAddedText, shouldRunInChat, type ChatType } from "@agenttag/domain";
import { mergeProgress, type EventProgress } from "../event-progress.ts";
import { DEFAULT_EVENT_RETRY, runWithRetry, type RetryOptions } from "../retry.ts";

export interface BotAddedEvent {
  eventId: string;
  tenantKey: string;
  chatId: string;
}

export interface BotAddedDeps {
  getChat(chatId: string): Promise<{ chatType: ChatType; external: boolean; name: string }>;
  lookupGrant(tenantKey: string, chatId: string): Promise<{ authorized: boolean; enabled: boolean }>;
  getRuntimeModel(tenantKey: string): Promise<{ modelId: string; enableThinking: boolean; source: "chat" | "tenant" | "env" }>;
  sendText(chatId: string, text: string): Promise<void>;
  loadProgress(eventId: string): Promise<EventProgress | null>;
  saveProgress(eventId: string, patch: EventProgress): Promise<void>;
  retry?: RetryOptions;
}

export async function handleBotAdded(event: BotAddedEvent, deps: BotAddedDeps): Promise<void> {
  const progress = (await deps.loadProgress(event.eventId)) ?? {};
  if (progress.welcomeSent) {
    return;
  }
  const retry = deps.retry ?? DEFAULT_EVENT_RETRY;
  const chat = await runWithRetry(() => deps.getChat(event.chatId), retry);
  const grant = await runWithRetry(() => deps.lookupGrant(event.tenantKey, event.chatId), retry);
  const decision = shouldRunInChat({
    authorized: grant.authorized,
    enabled: grant.enabled,
    external: chat.external,
    chatType: chat.chatType,
    allowP2p: false,
  });
  const text = botAddedText(decision, decision === "run" ? (await deps.getRuntimeModel(event.tenantKey)).modelId : undefined);
  if (text) {
    await deps.sendText(event.chatId, text);
    const next = mergeProgress(progress, { welcomeSent: true });
    await deps.saveProgress(event.eventId, next);
  }
}
