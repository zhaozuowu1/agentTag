import { describe, expect, it } from "vitest";
import type { FeishuClient, FeishuMessage } from "@agenttag/feishu";
import type { Sandbox } from "@agenttag/sandbox";
import { createFeishuFileTools, FEISHU_FILE_TOOL_DEFS } from "./feishu-files.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function memorySandbox(files: Map<string, Uint8Array> = new Map()): Sandbox {
  return {
    id: "mem",
    async exec() {
      return { stdout: "", stderr: "", code: 0 };
    },
    async readFile(path) {
      return new TextDecoder().decode(files.get(path) ?? new Uint8Array());
    },
    async writeFile(path, content) {
      files.set(path, new TextEncoder().encode(content));
    },
    async readFileBytes(path) {
      const value = files.get(path);
      if (!value) {
        throw new Error(`missing ${path}`);
      }
      return value;
    },
    async writeFileBytes(path, content) {
      files.set(path, content);
    },
    async destroy() {},
  };
}

function client(overrides: Partial<FeishuClient> = {}): FeishuClient {
  return {
    botOpenId: async () => "ou_bot",
    replyInThread: async () => ({ messageId: "om_x", threadId: "omt_x" }),
    replyInThreadMessage: async () => ({ messageId: "om_img", threadId: "omt_1" }),
    patchCard: async () => {},
    sendText: async () => ({ messageId: "om_t" }),
    sendCard: async () => ({ messageId: "om_card" }),
    getChat: async () => ({ chatType: "private", external: false, name: "群" }),
    listMessages: async () => [],
    downloadMessageResource: async () => new Uint8Array(),
    uploadImage: async () => ({ imageKey: "img_x" }),
    uploadFile: async () => ({ fileKey: "file_x" }),
    ...overrides,
  };
}

describe("createFeishuFileTools", () => {
  it("exposes fetch and post file tools", () => {
    expect(FEISHU_FILE_TOOL_DEFS.map((def) => def.name)).toEqual(["feishu_fetch_file", "feishu_post_file"]);
  });

  it("imports a CSV from the current chat into the sandbox", async () => {
    const files = new Map<string, Uint8Array>();
    const csv = "month,amount\n1,10\n";
    const tools = createFeishuFileTools({
      client: client({
        listMessages: async () =>
          [
            {
              messageId: "om_csv",
              chatId: "oc_auth",
              threadId: null,
              parentId: null,
              rootId: null,
              messageType: "file",
              text: "",
              senderOpenId: "ou_user",
              createTime: "t",
              mentions: [],
              fileKey: "file_csv_1",
              fileName: "sales.csv",
              imageKey: null,
            },
          ] satisfies FeishuMessage[],
        downloadMessageResource: async (messageId, fileKey, type) => {
          expect(messageId).toBe("om_csv");
          expect(fileKey).toBe("file_csv_1");
          expect(type).toBe("file");
          return new TextEncoder().encode(csv);
        },
      }),
      sandbox: memorySandbox(files),
      replyToMessageId: "om_card",
      chatId: "oc_auth",
      threadId: "omt_1",
    });
    const result = await tools.feishu_fetch_file({ messageId: "om_csv", destPath: "sales.csv" });
    expect(result).toContain("sales.csv");
    expect(new TextDecoder().decode(files.get("sales.csv"))).toBe(csv);
  });

  it("refuses to fetch a file that is not in the current chat or thread", async () => {
    const tools = createFeishuFileTools({
      client: client({
        listMessages: async () => [],
      }),
      sandbox: memorySandbox(),
      replyToMessageId: "om_card",
      chatId: "oc_auth",
      threadId: "omt_1",
    });
    const result = await tools.feishu_fetch_file({ messageId: "om_foreign", destPath: "x.csv" });
    expect(result).toMatch(/不属于|当前群|当前话题/);
  });

  it("fetches a group CSV when the model passes file_key instead of messageId", async () => {
    const files = new Map<string, Uint8Array>();
    const csv = "month,revenue,orders\n1,10,2\n";
    const chatCsv: FeishuMessage = {
      messageId: "om_csv",
      chatId: "oc_auth",
      threadId: null,
      parentId: null,
      rootId: null,
      messageType: "file",
      text: "",
      senderOpenId: "ou_user",
      createTime: String(Date.now() - 5_000),
      mentions: [],
      fileKey: "file_csv_1",
      fileName: "sandbox-demo-sales.csv",
      imageKey: null,
    };
    const tools = createFeishuFileTools({
      client: client({
        listMessages: async (opts) => (opts.container === "chat" ? [chatCsv] : []),
        downloadMessageResource: async (messageId, fileKey, type) => {
          expect(messageId).toBe("om_csv");
          expect(fileKey).toBe("file_csv_1");
          expect(type).toBe("file");
          return new TextEncoder().encode(csv);
        },
      }),
      sandbox: memorySandbox(files),
      replyToMessageId: "om_card",
      chatId: "oc_auth",
      threadId: "omt_new",
    });
    const result = await tools.feishu_fetch_file({ messageId: "file_csv_1", destPath: "sales.csv" });
    expect(result).toContain("sandbox-demo-sales.csv");
    expect(new TextDecoder().decode(files.get("sales.csv"))).toBe(csv);
  });

  it("refuses a file_key that is not in the current chat or thread", async () => {
    const tools = createFeishuFileTools({
      client: client({
        listMessages: async () => [
          {
            messageId: "om_csv",
            chatId: "oc_auth",
            threadId: null,
            parentId: null,
            rootId: null,
            messageType: "file",
            text: "",
            senderOpenId: "ou_user",
            createTime: String(Date.now() - 5_000),
            mentions: [],
            fileKey: "file_csv_1",
            fileName: "sales.csv",
            imageKey: null,
          } satisfies FeishuMessage,
        ],
      }),
      sandbox: memorySandbox(),
      replyToMessageId: "om_card",
      chatId: "oc_auth",
      threadId: "omt_1",
    });
    const result = await tools.feishu_fetch_file({ messageId: "file_foreign", destPath: "x.csv" });
    expect(result).toMatch(/不属于|当前群|当前话题/);
  });

  it("downloads the newest group CSV when messageId is omitted", async () => {
    const files = new Map<string, Uint8Array>();
    const csv = "month,revenue\n1,10\n";
    const tools = createFeishuFileTools({
      client: client({
        listMessages: async (opts) =>
          opts.container === "chat"
            ? [
                {
                  messageId: "om_csv",
                  chatId: "oc_auth",
                  threadId: null,
                  parentId: null,
                  rootId: null,
                  messageType: "file",
                  text: "",
                  senderOpenId: "ou_user",
                  createTime: String(Date.now() - 5_000),
                  mentions: [],
                  fileKey: "file_csv_1",
                  fileName: "sales.csv",
                  imageKey: null,
                } satisfies FeishuMessage,
              ]
            : [],
        downloadMessageResource: async (messageId) => {
          expect(messageId).toBe("om_csv");
          return new TextEncoder().encode(csv);
        },
      }),
      sandbox: memorySandbox(files),
      replyToMessageId: "om_card",
      chatId: "oc_auth",
      threadId: "omt_new",
    });
    const result = await tools.feishu_fetch_file({ destPath: "sales.csv" });
    expect(result).toContain("sales.csv");
    expect(new TextDecoder().decode(files.get("sales.csv"))).toBe(csv);
  });

  it("posts a sandbox png back into the Feishu thread", async () => {
    const files = new Map<string, Uint8Array>([["chart.png", PNG]]);
    const uploads: string[] = [];
    const replies: unknown[] = [];
    const tools = createFeishuFileTools({
      client: client({
        uploadImage: async (bytes, filename) => {
          expect(filename).toBe("chart.png");
          expect(bytes[0]).toBe(0x89);
          uploads.push(filename);
          return { imageKey: "img_chart" };
        },
        replyInThreadMessage: async (messageId, input) => {
          replies.push({ messageId, input });
          return { messageId: "om_img", threadId: "omt_1" };
        },
      }),
      sandbox: memorySandbox(files),
      replyToMessageId: "om_card",
      chatId: "oc_auth",
      threadId: "omt_1",
    });
    const result = await tools.feishu_post_file({ path: "chart.png" });
    expect(uploads).toEqual(["chart.png"]);
    expect(replies).toEqual([
      {
        messageId: "om_card",
        input: { msgType: "image", content: { image_key: "img_chart" } },
      },
    ]);
    expect(result).toContain("img_chart");
  });
});
