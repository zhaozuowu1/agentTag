import type { FeishuClient, FeishuMessage } from "@agenttag/feishu";
import { describe, expect, it } from "vitest";
import { createFeishuMessageTools, FEISHU_MESSAGE_TOOL_DEFS } from "./feishu-messages.ts";

function stubClient(calls: Array<{ container: string; id: string }>): FeishuClient {
  return {
    botOpenId: async () => "ou_bot",
    replyInThread: async () => ({ messageId: "om_x", threadId: "omt_x" }),
    replyInThreadMessage: async () => ({ messageId: "om_y", threadId: "omt_x" }),
    patchCard: async () => {},
    sendText: async () => ({ messageId: "om_t" }),
    sendCard: async () => ({ messageId: "om_card" }),
    getChat: async () => ({ chatType: "private", external: false, name: "群" }),
    listMessages: async (opts) => {
      calls.push({ container: opts.container, id: opts.id });
      return [] as FeishuMessage[];
    },
    downloadMessageResource: async () => new Uint8Array(),
    uploadImage: async () => ({ imageKey: "img_x" }),
    uploadFile: async () => ({ fileKey: "file_x" }),
  };
}

describe("createFeishuMessageTools", () => {
  it("ignores a model-supplied id and only lists the current chat or thread", async () => {
    const calls: Array<{ container: string; id: string }> = [];
    const tools = createFeishuMessageTools(stubClient(calls), {
      chatId: "oc_authorized",
      threadId: "omt_current",
    });

    await tools.feishu_list_messages({
      container: "chat",
      id: "oc_SOME_OTHER_UNAUTHORIZED_GROUP",
    });
    await tools.feishu_list_messages({
      container: "thread",
      id: "omt_foreign_thread",
    });
    await tools.feishu_search_messages({
      query: "事项",
      container: "chat",
      id: "oc_SOME_OTHER_UNAUTHORIZED_GROUP",
    });

    expect(calls).toEqual([
      { container: "chat", id: "oc_authorized" },
      { container: "thread", id: "omt_current" },
      { container: "chat", id: "oc_authorized" },
    ]);
  });

  it("does not expose container id in the tool schema", () => {
    for (const def of FEISHU_MESSAGE_TOOL_DEFS) {
      expect(def.input_schema.properties).not.toHaveProperty("id");
    }
  });
});
