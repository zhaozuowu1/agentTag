export type FeishuChatType = "public" | "private" | "p2p";

export interface FeishuMessage {
  messageId: string;
  chatId: string;
  threadId: string | null;
  parentId: string | null;
  rootId: string | null;
  messageType: string;
  text: string;
  senderOpenId: string;
  createTime: string;
  mentions: Array<{ openId: string; name: string; key: string }>;
  fileKey: string | null;
  fileName: string | null;
  imageKey: string | null;
}

export interface FeishuClient {
  botOpenId(): Promise<string>;
  replyInThread(
    messageId: string,
    card: unknown,
  ): Promise<{ messageId: string; threadId: string | null }>;
  replyInThreadMessage(
    messageId: string,
    input: { msgType: "image" | "file" | "text"; content: unknown },
  ): Promise<{ messageId: string; threadId: string | null }>;
  patchCard(messageId: string, card: unknown): Promise<void>;
  sendText(chatId: string, text: string): Promise<{ messageId: string }>;
  sendCard(chatId: string, card: unknown): Promise<{ messageId: string }>;
  getChat(chatId: string): Promise<{ chatType: FeishuChatType; external: boolean; name: string }>;
  listMessages(opts: {
    container: "chat" | "thread";
    id: string;
    pageSize?: number;
  }): Promise<FeishuMessage[]>;
  downloadMessageResource(
    messageId: string,
    fileKey: string,
    type: "file" | "image",
  ): Promise<Uint8Array>;
  uploadImage(bytes: Uint8Array, filename: string): Promise<{ imageKey: string }>;
  uploadFile(bytes: Uint8Array, filename: string): Promise<{ fileKey: string }>;
}

export interface CreateFeishuClientOptions {
  appId: string;
  appSecret: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  getTenantAccessToken?: () => Promise<string>;
}

export class FeishuApiError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly httpStatus: number,
  ) {
    super(message);
    this.name = "FeishuApiError";
  }
}
