import { describe, expect, it } from "vitest";
import type { FeishuClient, FeishuMessage } from "@agenttag/feishu";
import type { Sandbox } from "@agenttag/sandbox";
import type { LlmClient } from "@agenttag/runtime";
import { createFeishuFileTools, createSandboxTools, FEISHU_FILE_TOOL_DEFS, SANDBOX_TOOL_DEFS } from "@agenttag/runtime";
import { processSessionJob, type WorkerSession } from "./process-session.ts";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const CSV = "month,amount\n1,10\n2,20\n";

function session(): WorkerSession {
  return {
    id: "sess_chart",
    tenantKey: "tenant_demo",
    chatId: "oc_auth",
    threadId: "omt_1",
    startedByOpenId: "ou_user",
    checklistMessageId: "om_card",
    status: "running",
    transcript: [{ type: "user", openId: "ou_user", text: "用这份 CSV 画图并把 png 发回话题", at: "t" }],
  };
}

function memorySandbox(files: Map<string, Uint8Array>): Sandbox {
  return {
    id: "mem",
    async exec(cmd) {
      if (/python|matplotlib|chart\.png|pyplot/i.test(cmd)) {
        files.set("chart.png", PNG);
        return { stdout: "wrote chart.png", stderr: "", code: 0 };
      }
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

describe("csv chart acceptance path", () => {
  it("imports a group CSV, plots in the sandbox, and posts png back to the thread", async () => {
    const files = new Map<string, Uint8Array>();
    const sandbox = memorySandbox(files);
    const replies: unknown[] = [];
    const client: FeishuClient = {
      botOpenId: async () => "ou_bot",
      replyInThread: async () => ({ messageId: "om_x", threadId: "omt_1" }),
      replyInThreadMessage: async (messageId, input) => {
        replies.push({ messageId, input });
        return { messageId: "om_img", threadId: "omt_1" };
      },
      patchCard: async () => {},
      sendText: async () => ({ messageId: "om_t" }),
      sendCard: async () => ({ messageId: "om_card" }),
      getChat: async () => ({ chatType: "private", external: false, name: "群" }),
      listMessages: async () =>
        [
          {
            messageId: "om_csv",
            chatId: "oc_auth",
            threadId: "omt_1",
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
      downloadMessageResource: async () => new TextEncoder().encode(CSV),
      uploadImage: async (bytes, filename) => {
        expect(filename).toBe("chart.png");
        expect(bytes[0]).toBe(0x89);
        return { imageKey: "img_chart" };
      },
      uploadFile: async () => ({ fileKey: "file_x" }),
    };

    const extraTools = {
      ...createSandboxTools(sandbox, { bundle: { allowedHosts: [], connections: [] } }),
      ...createFeishuFileTools({
        client,
        sandbox,
        replyToMessageId: "om_card",
        chatId: "oc_auth",
        threadId: "omt_1",
      }),
    };

    const turns: string[] = [];
    const llm: LlmClient = {
      async create() {
        const step = turns.length;
        turns.push("llm");
        if (step === 0) {
          return {
            stop_reason: "tool_use",
            content: [{ type: "tool_use", id: "t1", name: "feishu_fetch_file", input: { messageId: "om_csv", destPath: "sales.csv" } }],
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        }
        if (step === 1) {
          return {
            stop_reason: "tool_use",
            content: [
              {
                type: "tool_use",
                id: "t2",
                name: "bash",
                input: { command: "python3 plot.py && ls chart.png" },
              },
            ],
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        }
        if (step === 2) {
          return {
            stop_reason: "tool_use",
            content: [{ type: "tool_use", id: "t3", name: "feishu_post_file", input: { path: "chart.png" } }],
            usage: { input_tokens: 1, output_tokens: 1 },
          };
        }
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "已把图表发回话题。" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    };

    await processSessionJob(
      { sessionId: "sess_chart" },
      {
        llm,
        model: "qwen3.8-max",
        sandboxEnabled: true,
        extraTools,
        extraToolDefs: [...SANDBOX_TOOL_DEFS, ...FEISHU_FILE_TOOL_DEFS],
        loadSession: async () => session(),
        patchCard: async () => {},
        recordUsage: async () => {},
        recordAudit: async () => {},
        markSession: async () => {},
        appendEvents: async () => {},
        listMessages: async () => "[]",
        getBudget: async () => ({ usedUsd: 0, limitUsd: null }),
      },
    );

    expect(new TextDecoder().decode(files.get("sales.csv"))).toBe(CSV);
    expect(files.get("chart.png")?.[0]).toBe(0x89);
    expect(replies).toEqual([
      {
        messageId: "om_card",
        input: { msgType: "image", content: { image_key: "img_chart" } },
      },
    ]);
  });
});
