import type { ReceiveMessageEvent } from "./handlers/message-receive.ts";

interface FeishuHeader {
  event_id?: string;
  event_type?: string;
  tenant_key?: string;
}

export function parseReceiveMessage(payload: {
  header?: FeishuHeader;
  event?: {
    sender?: { sender_id?: { open_id?: string } };
    message?: {
      message_id?: string;
      chat_id?: string;
      thread_id?: string;
      root_id?: string;
      parent_id?: string;
      content?: string;
      mentions?: Array<{ id?: string | { open_id?: string } }>;
    };
  };
}): ReceiveMessageEvent | null {
  const header = payload.header;
  const message = payload.event?.message;
  const openId = payload.event?.sender?.sender_id?.open_id;
  if (!header?.event_id || !header.tenant_key || !message?.message_id || !message.chat_id || !openId) {
    return null;
  }
  return {
    eventId: header.event_id,
    tenantKey: header.tenant_key,
    chatId: message.chat_id,
    messageId: message.message_id,
    threadId: message.thread_id || null,
    rootId: message.root_id || message.parent_id || null,
    openId,
    text: extractText(message.content),
    mentionOpenIds: (message.mentions ?? []).map(mentionOpenId).filter((id): id is string => Boolean(id)),
  };
}

export function parseBotAdded(payload: {
  header?: FeishuHeader;
  event?: { chat_id?: string };
}): { eventId: string; tenantKey: string; chatId: string } | null {
  const eventId = payload.header?.event_id;
  const tenantKey = payload.header?.tenant_key;
  const chatId = payload.event?.chat_id;
  if (!eventId || !tenantKey || !chatId) {
    return null;
  }
  return { eventId, tenantKey, chatId };
}

function mentionOpenId(mention: { id?: string | { open_id?: string } }): string | null {
  if (typeof mention.id === "string") {
    return mention.id;
  }
  return mention.id?.open_id ?? null;
}

function extractText(content: string | undefined): string {
  if (!content) {
    return "";
  }
  try {
    const parsed = JSON.parse(content) as { text?: string };
    return parsed.text ?? content;
  } catch {
    return content;
  }
}
