import type { MemoryStore } from "@agenttag/memory";

export const MEMORY_TOOL_DEFS = [
  {
    name: "memory_list",
    description: "列出本群已保存的稳定约定与事实。不要把群流水账当成记忆。",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "memory_upsert",
    description:
      "写入或更新一条本群记忆。只存稳定约定、偏好和长期事实，例如周报格式；不要存当天待办或整段聊天记录。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        kind: { type: "string", enum: ["instruction", "fact"] },
        text: { type: "string" },
      },
      required: ["kind", "text"],
    },
  },
  {
    name: "memory_delete",
    description: "删除一条本群记忆。用于用户说忘掉某条约定的时候。",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
] as const;

export function createMemoryTools(store: MemoryStore, ctx: { tenantKey: string; chatId: string; openId: string; chatType: "public" | "private" | "p2p"; sessionId: string | null }) {
  return {
    memory_list: async () => JSON.stringify(await store.list({ tenantKey: ctx.tenantKey, chatId: ctx.chatId })),
    memory_upsert: async (input: unknown) => {
      const body = (input ?? {}) as { id?: string; kind?: "instruction" | "fact"; text?: string };
      const saved = await store.upsert({
        id: body.id,
        tenantKey: ctx.tenantKey,
        scope: "chat",
        chatId: ctx.chatId,
        kind: body.kind === "instruction" ? "instruction" : "fact",
        text: body.text ?? "",
        sourceSessionId: ctx.sessionId,
        createdByOpenId: ctx.openId,
        chatType: ctx.chatType,
      });
      return JSON.stringify(saved);
    },
    memory_delete: async (input: unknown) => {
      const body = (input ?? {}) as { id?: string };
      if (body.id) {
        await store.delete(body.id);
      }
      return JSON.stringify({ ok: true });
    },
  };
}

export function memoryPromptBlock(entries: Array<{ kind: string; text: string }>): string {
  if (entries.length === 0) {
    return "本群尚无已保存记忆。";
  }
  const lines = entries.map((entry) => `- [${entry.kind}] ${entry.text}`);
  return `本群记忆（稳定约定，不是流水账）：\n${lines.join("\n")}`;
}
