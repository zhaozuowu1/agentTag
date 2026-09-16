import type { FeishuMessage } from "./types.ts";

export const RECENT_ATTACHMENT_MAX_AGE_MS = 30 * 60 * 1000;

export interface BoundAttachment {
  messageId: string;
  fileKey: string | null;
  fileName: string | null;
}

export function isTabularFileName(fileName: string | null | undefined): boolean {
  const name = (fileName ?? "").toLowerCase();
  return name.endsWith(".csv") || name.endsWith(".tsv");
}

export function isGroupFileMessage(
  message: Pick<FeishuMessage, "fileKey" | "fileName" | "messageType">,
): boolean {
  if (message.messageType === "image") {
    return false;
  }
  if (!message.fileKey) {
    return false;
  }
  return message.messageType === "file" || isTabularFileName(message.fileName);
}

export function parseFileContent(content: string | undefined): { fileKey: string | null; fileName: string | null } {
  if (!content) {
    return { fileKey: null, fileName: null };
  }
  try {
    const parsed = JSON.parse(content) as { file_key?: unknown; file_name?: unknown };
    return {
      fileKey: typeof parsed.file_key === "string" ? parsed.file_key : null,
      fileName: typeof parsed.file_name === "string" ? parsed.file_name : null,
    };
  } catch {
    return { fileKey: null, fileName: null };
  }
}

function parseTimeMs(createTime: string): number | null {
  if (!createTime) {
    return null;
  }
  if (/^\d+$/.test(createTime)) {
    const n = Number(createTime);
    return Number.isFinite(n) ? n : null;
  }
  const parsed = Date.parse(createTime);
  return Number.isFinite(parsed) ? parsed : null;
}

export function pickRecentChatAttachments(
  messages: FeishuMessage[],
  opts: {
    excludeMessageId?: string;
    preferSenderOpenId?: string;
    nowMs?: number;
    maxAgeMs?: number;
  } = {},
): BoundAttachment[] {
  const nowMs = opts.nowMs ?? Date.now();
  const maxAgeMs = opts.maxAgeMs ?? RECENT_ATTACHMENT_MAX_AGE_MS;
  const eligible = messages.filter((message) => {
    if (opts.excludeMessageId && message.messageId === opts.excludeMessageId) {
      return false;
    }
    if (!isGroupFileMessage(message)) {
      return false;
    }
    const t = parseTimeMs(message.createTime);
    if (t != null && nowMs - t > maxAgeMs) {
      return false;
    }
    return true;
  });
  if (eligible.length === 0) {
    return [];
  }
  const score = (message: FeishuMessage): number =>
    (isTabularFileName(message.fileName) ? 20 : 0) +
    (opts.preferSenderOpenId && message.senderOpenId === opts.preferSenderOpenId ? 10 : 0);
  const ranked = [...eligible].sort((a, b) => {
    const byScore = score(b) - score(a);
    if (byScore !== 0) {
      return byScore;
    }
    return (parseTimeMs(b.createTime) ?? 0) - (parseTimeMs(a.createTime) ?? 0);
  });
  const top = ranked[0]!;
  return [{ messageId: top.messageId, fileKey: top.fileKey, fileName: top.fileName }];
}

export function attachmentFromEvent(input: {
  messageId: string;
  messageType?: string | null;
  fileKey?: string | null;
  fileName?: string | null;
  text?: string;
}): BoundAttachment | null {
  let fileKey = input.fileKey ?? null;
  let fileName = input.fileName ?? null;
  const parsed = parseFileContent(input.text);
  fileKey = fileKey ?? parsed.fileKey;
  fileName = fileName ?? parsed.fileName;
  if (input.messageType === "file" || fileKey || isTabularFileName(fileName)) {
    return {
      messageId: input.messageId,
      fileKey,
      fileName,
    };
  }
  return null;
}

export function formatBoundAttachments(files: BoundAttachment[]): string {
  if (files.length === 0) {
    return "";
  }
  const lines = files.map((file) => {
    const name = file.fileName ?? "unknown";
    const key = file.fileKey ? ` file_key=${file.fileKey}` : "";
    return `- fileName=${name} messageId=${file.messageId}${key}`;
  });
  return [
    "本轮可用附件（请用 feishu_fetch_file，参数 messageId 用下面的消息 id；不要把 file_key 当成 messageId）：",
    ...lines,
  ].join("\n");
}

export function composeUserTextWithAttachments(userText: string, files: BoundAttachment[]): string {
  const block = formatBoundAttachments(files);
  if (!block) {
    return userText;
  }
  const base = userText.trim();
  return base ? `${base}\n\n${block}` : block;
}

export function findMessageForFetch(
  messages: FeishuMessage[],
  query: { messageId?: string; fileKey?: string },
): FeishuMessage | null {
  const messageId = query.messageId?.trim() ?? "";
  const fileKey = query.fileKey?.trim() ?? "";
  if (messageId || fileKey) {
    return (
      messages.find(
        (message) =>
          (messageId && (message.messageId === messageId || message.fileKey === messageId)) ||
          (fileKey && message.fileKey === fileKey),
      ) ?? null
    );
  }
  const recent = pickRecentChatAttachments(messages);
  const wanted = recent[0];
  if (!wanted) {
    return null;
  }
  return messages.find((message) => message.messageId === wanted.messageId) ?? null;
}
