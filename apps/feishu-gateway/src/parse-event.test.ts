import { describe, expect, it } from "vitest";
import { parseReceiveMessage } from "./parse-event.ts";

describe("parseReceiveMessage", () => {
  it("extracts mention fixture into a start_task-ready event", () => {
    const parsed = parseReceiveMessage({
      header: {
        event_id: "ev_mention_1",
        event_type: "im.message.receive_v1",
        tenant_key: "tenant_demo",
      },
      event: {
        sender: { sender_id: { open_id: "ou_user" } },
        message: {
          message_id: "om_1",
          chat_id: "oc_auth",
          content: JSON.stringify({ text: "@_user_1 总结本群未关闭事项" }),
          mentions: [{ id: { open_id: "ou_bot" } }],
        },
      },
    });
    expect(parsed).toMatchObject({
      eventId: "ev_mention_1",
      chatId: "oc_auth",
      mentionOpenIds: ["ou_bot"],
      text: "@_user_1 总结本群未关闭事项",
      messageType: "text",
      fileKey: null,
      fileName: null,
    });
  });

  it("extracts file_key and file_name from a file message", () => {
    const parsed = parseReceiveMessage({
      header: {
        event_id: "ev_file_1",
        event_type: "im.message.receive_v1",
        tenant_key: "tenant_demo",
      },
      event: {
        sender: { sender_id: { open_id: "ou_user" } },
        message: {
          message_id: "om_csv",
          chat_id: "oc_auth",
          message_type: "file",
          content: JSON.stringify({ file_key: "file_csv_1", file_name: "sandbox-demo-sales.csv" }),
        },
      },
    });
    expect(parsed).toMatchObject({
      eventId: "ev_file_1",
      messageId: "om_csv",
      messageType: "file",
      fileKey: "file_csv_1",
      fileName: "sandbox-demo-sales.csv",
    });
  });
});
