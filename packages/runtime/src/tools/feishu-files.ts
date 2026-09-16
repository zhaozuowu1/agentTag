import type { FeishuClient, FeishuMessage } from "@agenttag/feishu";
import type { Sandbox } from "@agenttag/sandbox";

export const FEISHU_FILE_TOOL_DEFS = [
  {
    name: "feishu_fetch_file",
    description: "把当前群或当前话题里的附件下载到沙箱工作区。只能取本会话已出现的文件。",
    input_schema: {
      type: "object",
      properties: {
        messageId: { type: "string" },
        destPath: { type: "string" },
      },
      required: ["messageId", "destPath"],
    },
  },
  {
    name: "feishu_post_file",
    description: "把沙箱里的文件发回当前飞书话题。png 会以图片消息发送。",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string" },
        as: { type: "string", enum: ["image", "file"] },
      },
      required: ["path"],
    },
  },
] as const;

export function createFeishuFileTools(opts: {
  client: FeishuClient;
  sandbox: Sandbox;
  replyToMessageId: string;
  chatId: string;
  threadId: string | null;
}): {
  feishu_fetch_file: (input: unknown) => Promise<string>;
  feishu_post_file: (input: unknown) => Promise<string>;
} {
  return {
    feishu_fetch_file: async (input) => {
      const body = (input ?? {}) as { messageId?: string; destPath?: string };
      const messageId = body.messageId ?? "";
      const destPath = body.destPath ?? "";
      const found = await findCurrentMessage(opts.client, opts.chatId, opts.threadId, messageId);
      if (!found) {
        return "该附件不属于当前群或当前话题，已拒绝下载。";
      }
      const key = found.fileKey || found.imageKey;
      if (!key) {
        return "该消息没有可下载的附件。";
      }
      const type = found.imageKey && !found.fileKey ? "image" : "file";
      const bytes = await opts.client.downloadMessageResource(found.messageId, key, type);
      await opts.sandbox.writeFileBytes(destPath, bytes);
      return JSON.stringify({ ok: true, path: destPath, bytes: bytes.byteLength, fileName: found.fileName });
    },
    feishu_post_file: async (input) => {
      const body = (input ?? {}) as { path?: string; as?: "image" | "file" };
      const path = body.path ?? "";
      const filename = path.split("/").pop() || "file";
      const asImage = body.as === "image" || filename.toLowerCase().endsWith(".png");
      const bytes = await opts.sandbox.readFileBytes(path);
      if (asImage) {
        const uploaded = await opts.client.uploadImage(bytes, filename);
        const replied = await opts.client.replyInThreadMessage(opts.replyToMessageId, {
          msgType: "image",
          content: { image_key: uploaded.imageKey },
        });
        return JSON.stringify({ ok: true, imageKey: uploaded.imageKey, messageId: replied.messageId });
      }
      const uploaded = await opts.client.uploadFile(bytes, filename);
      const replied = await opts.client.replyInThreadMessage(opts.replyToMessageId, {
        msgType: "file",
        content: { file_key: uploaded.fileKey },
      });
      return JSON.stringify({ ok: true, fileKey: uploaded.fileKey, messageId: replied.messageId });
    },
  };
}

async function findCurrentMessage(
  client: FeishuClient,
  chatId: string,
  threadId: string | null,
  messageId: string,
): Promise<FeishuMessage | null> {
  const pools = [client.listMessages({ container: "chat", id: chatId, pageSize: 50 })];
  if (threadId) {
    pools.push(client.listMessages({ container: "thread", id: threadId, pageSize: 50 }));
  }
  const lists = await Promise.all(pools);
  for (const list of lists) {
    const found = list.find((message) => message.messageId === messageId);
    if (found) {
      return found;
    }
  }
  return null;
}
