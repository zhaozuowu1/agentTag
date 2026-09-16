import type { FeishuClient } from "@agenttag/feishu";

export const FEISHU_MESSAGE_TOOL_DEFS = [
  {
    name: "feishu_list_messages",
    description: "拉取本群或本话题的历史消息。只用于了解现场，不要把流水账写成记忆。",
    input_schema: {
      type: "object",
      properties: {
        container: { type: "string", enum: ["chat", "thread"] },
        pageSize: { type: "number" },
      },
    },
  },
  {
    name: "feishu_search_messages",
    description: "按关键字过滤本群或本话题历史消息。",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        container: { type: "string", enum: ["chat", "thread"] },
      },
      required: ["query"],
    },
  },
] as const;

function resolveContainer(
  fallback: { chatId: string; threadId: string | null },
  container: "chat" | "thread" | undefined,
): { container: "chat" | "thread"; id: string } {
  if (container === "thread" && fallback.threadId) {
    return { container: "thread", id: fallback.threadId };
  }
  return { container: "chat", id: fallback.chatId };
}

export function createFeishuMessageTools(client: FeishuClient, fallback: { chatId: string; threadId: string | null }) {
  return {
    feishu_list_messages: async (input: unknown) => {
      const opts = (input ?? {}) as { container?: "chat" | "thread"; pageSize?: number };
      const target = resolveContainer(fallback, opts.container);
      const messages = await client.listMessages({
        container: target.container,
        id: target.id,
        pageSize: opts.pageSize ?? 50,
      });
      return JSON.stringify(
        messages.map((message) => ({
          messageId: message.messageId,
          senderOpenId: message.senderOpenId,
          text: message.text,
          createTime: message.createTime,
          messageType: message.messageType,
          fileKey: message.fileKey,
          fileName: message.fileName,
          imageKey: message.imageKey,
        })),
      );
    },
    feishu_search_messages: async (input: unknown) => {
      const opts = (input ?? {}) as { query?: string; container?: "chat" | "thread" };
      const query = (opts.query ?? "").toLowerCase();
      const raw = await createFeishuMessageTools(client, fallback).feishu_list_messages({
        container: opts.container,
      });
      const messages = JSON.parse(raw) as Array<{ text: string }>;
      return JSON.stringify(messages.filter((message) => message.text.toLowerCase().includes(query)));
    },
  };
}
