import { describe, expect, it } from "vitest";
import type { FeishuMessage } from "./types.ts";
import {
  attachmentFromEvent,
  composeUserTextWithAttachments,
  pickRecentChatAttachments,
} from "./attachments.ts";

function msg(overrides: Partial<FeishuMessage> = {}): FeishuMessage {
  return {
    messageId: "om_x",
    chatId: "oc_auth",
    threadId: null,
    parentId: null,
    rootId: null,
    messageType: "text",
    text: "",
    senderOpenId: "ou_user",
    createTime: String(Date.now() - 5_000),
    mentions: [],
    fileKey: null,
    fileName: null,
    imageKey: null,
    ...overrides,
  };
}

describe("pickRecentChatAttachments", () => {
  it("picks the newest CSV in the chat when the @ message itself has no file", () => {
    const picked = pickRecentChatAttachments(
      [
        msg({ messageId: "om_at", messageType: "text", text: "@飞书 CLI 画图", createTime: String(Date.now()) }),
        msg({
          messageId: "om_csv",
          messageType: "file",
          fileKey: "file_csv_1",
          fileName: "sandbox-demo-sales.csv",
          createTime: String(Date.now() - 8_000),
        }),
        msg({
          messageId: "om_old_csv",
          messageType: "file",
          fileKey: "file_csv_old",
          fileName: "older.csv",
          createTime: String(Date.now() - 20_000),
        }),
      ],
      { excludeMessageId: "om_at", preferSenderOpenId: "ou_user" },
    );
    expect(picked).toEqual([
      { messageId: "om_csv", fileKey: "file_csv_1", fileName: "sandbox-demo-sales.csv" },
    ]);
  });

  it("does not bind an image or a file from outside the recent window", () => {
    const picked = pickRecentChatAttachments(
      [
        msg({
          messageId: "om_img",
          messageType: "image",
          imageKey: "img_1",
          fileName: "photo.png",
          createTime: String(Date.now() - 1_000),
        }),
        msg({
          messageId: "om_stale",
          messageType: "file",
          fileKey: "file_stale",
          fileName: "stale.csv",
          createTime: String(Date.now() - 3 * 60 * 60 * 1000),
        }),
      ],
      { excludeMessageId: "om_at" },
    );
    expect(picked).toEqual([]);
  });
});

describe("attachmentFromEvent", () => {
  it("keeps messageId when the follow-up is a file payload", () => {
    expect(
      attachmentFromEvent({
        messageId: "om_thread_file",
        messageType: "file",
        fileKey: "file_csv_2",
        fileName: "sales.csv",
        text: JSON.stringify({ file_key: "file_csv_2", file_name: "sales.csv" }),
      }),
    ).toEqual({
      messageId: "om_thread_file",
      fileKey: "file_csv_2",
      fileName: "sales.csv",
    });
  });

  it("recovers file_key from JSON text when the event omitted typed fields", () => {
    expect(
      attachmentFromEvent({
        messageId: "om_json_file",
        text: JSON.stringify({ file_key: "file_csv_3", file_name: "sales.csv" }),
      }),
    ).toEqual({
      messageId: "om_json_file",
      fileKey: "file_csv_3",
      fileName: "sales.csv",
    });
  });
});

describe("composeUserTextWithAttachments", () => {
  it("puts messageId and file_key into the user text so fetch can run", () => {
    const text = composeUserTextWithAttachments("用我刚上传的 CSV 画图", [
      { messageId: "om_csv", fileKey: "file_csv_1", fileName: "sales.csv" },
    ]);
    expect(text).toContain("用我刚上传的 CSV 画图");
    expect(text).toContain("om_csv");
    expect(text).toContain("file_csv_1");
    expect(text).toContain("sales.csv");
    expect(text).toMatch(/feishu_fetch_file/);
  });
});
