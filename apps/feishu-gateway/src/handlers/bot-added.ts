import { botAddedText, shouldRunInChat, type ChatType } from "@agenttag/domain";

export interface BotAddedEvent {
  tenantKey: string;
  chatId: string;
}

export interface BotAddedDeps {
  getChat(chatId: string): Promise<{ chatType: ChatType; external: boolean; name: string }>;
  lookupGrant(tenantKey: string, chatId: string): Promise<{ authorized: boolean; enabled: boolean }>;
  sendText(chatId: string, text: string): Promise<void>;
}

export async function handleBotAdded(event: BotAddedEvent, deps: BotAddedDeps): Promise<void> {
  const chat = await deps.getChat(event.chatId);
  const grant = await deps.lookupGrant(event.tenantKey, event.chatId);
  const decision = shouldRunInChat({
    authorized: grant.authorized,
    enabled: grant.enabled,
    external: chat.external,
    chatType: chat.chatType,
    allowP2p: false,
  });
  const text = botAddedText(decision);
  if (text) {
    await deps.sendText(event.chatId, text);
  }
}
