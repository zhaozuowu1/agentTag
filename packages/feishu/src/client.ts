import { FeishuApiError, type CreateFeishuClientOptions, type FeishuChatType, type FeishuClient, type FeishuMessage } from "./types.ts";
import { stringifyCard } from "./cards.ts";

const DEFAULT_BASE_URL = "https://open.feishu.cn";

interface FeishuEnvelope<T> {
  code: number;
  msg?: string;
  data?: T;
}

export function createFeishuClient(options: CreateFeishuClientOptions): FeishuClient {
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
  const fetchImpl = options.fetch ?? fetch;
  let cachedBotOpenId: string | null = null;
  let cachedToken: { value: string; expiresAt: number } | null = null;

  async function tenantToken(): Promise<string> {
    if (options.getTenantAccessToken) {
      return options.getTenantAccessToken();
    }
    if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
      return cachedToken.value;
    }
    const res = await fetchImpl(`${baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ app_id: options.appId, app_secret: options.appSecret }),
    });
    const json = (await res.json()) as { code: number; msg?: string; tenant_access_token?: string; expire?: number };
    if (!res.ok || json.code !== 0 || !json.tenant_access_token) {
      throw new FeishuApiError(json.msg ?? "failed to get tenant token", json.code ?? res.status, res.status);
    }
    cachedToken = {
      value: json.tenant_access_token,
      expiresAt: Date.now() + (json.expire ?? 7200) * 1000,
    };
    return json.tenant_access_token;
  }

  async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await tenantToken();
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json()) as FeishuEnvelope<T>;
    if (!res.ok || json.code !== 0) {
      throw new FeishuApiError(json.msg ?? "feishu api error", json.code ?? res.status, res.status);
    }
    return json.data as T;
  }

  return {
    async botOpenId() {
      if (cachedBotOpenId) {
        return cachedBotOpenId;
      }
      const data = await api<{ bot?: { open_id?: string }; open_id?: string }>("GET", "/open-apis/bot/v3/info");
      const openId = data.bot?.open_id ?? data.open_id;
      if (!openId) {
        throw new FeishuApiError("bot open_id missing", 0, 200);
      }
      cachedBotOpenId = openId;
      return openId;
    },

    async replyInThread(messageId, card) {
      const data = await api<{ message_id: string; thread_id?: string }>(
        "POST",
        `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}/reply`,
        {
          msg_type: "interactive",
          content: stringifyCard(card),
          reply_in_thread: true,
        },
      );
      return { messageId: data.message_id, threadId: data.thread_id ?? null };
    },

    async patchCard(messageId, card) {
      await api<unknown>("PATCH", `/open-apis/im/v1/messages/${encodeURIComponent(messageId)}`, {
        content: stringifyCard(card),
      });
    },

    async sendText(chatId, text) {
      const data = await api<{ message_id: string }>(
        "POST",
        "/open-apis/im/v1/messages?receive_id_type=chat_id",
        {
          receive_id: chatId,
          msg_type: "text",
          content: JSON.stringify({ text }),
        },
      );
      return { messageId: data.message_id };
    },

    async getChat(chatId) {
      const data = await api<{
        chat_mode?: string;
        chat_type?: string;
        external?: boolean;
        name?: string;
      }>("GET", `/open-apis/im/v1/chats/${encodeURIComponent(chatId)}`);
      const chatType = mapChatType(data.chat_mode, data.chat_type);
      return {
        chatType,
        external: Boolean(data.external),
        name: data.name ?? "",
      };
    },

    async listMessages(opts) {
      const params = new URLSearchParams({
        container_id_type: opts.container,
        container_id: opts.id,
        sort_type: "ByCreateTimeDesc",
        page_size: String(opts.pageSize ?? 50),
      });
      const data = await api<{ items?: RawFeishuMessage[] }>(
        "GET",
        `/open-apis/im/v1/messages?${params.toString()}`,
      );
      return (data.items ?? []).map(toFeishuMessage);
    },
  };
}

function mapChatType(chatMode: string | undefined, chatType: string | undefined): FeishuChatType {
  if (chatMode === "p2p" || chatType === "p2p") {
    return "p2p";
  }
  if (chatType === "public") {
    return "public";
  }
  return "private";
}

interface RawFeishuMessage {
  message_id: string;
  chat_id: string;
  thread_id?: string;
  parent_id?: string;
  root_id?: string;
  msg_type: string;
  body?: { content?: string };
  sender?: { id?: string; sender_id?: { open_id?: string } };
  create_time?: string;
  mentions?: Array<{ id?: string; name?: string; key?: string }>;
}

function toFeishuMessage(raw: RawFeishuMessage): FeishuMessage {
  return {
    messageId: raw.message_id,
    chatId: raw.chat_id,
    threadId: raw.thread_id || null,
    parentId: raw.parent_id || null,
    rootId: raw.root_id || null,
    messageType: raw.msg_type,
    text: extractText(raw.body?.content, raw.msg_type),
    senderOpenId: raw.sender?.sender_id?.open_id ?? raw.sender?.id ?? "",
    createTime: raw.create_time ?? "",
    mentions: (raw.mentions ?? []).map((mention) => ({
      openId: mention.id ?? "",
      name: mention.name ?? "",
      key: mention.key ?? "",
    })),
  };
}

function extractText(content: string | undefined, msgType: string): string {
  if (!content) {
    return "";
  }
  try {
    const parsed = JSON.parse(content) as { text?: string; content?: unknown };
    if (typeof parsed.text === "string") {
      return parsed.text;
    }
    if (msgType === "post") {
      return content;
    }
    return content;
  } catch {
    return content;
  }
}
