import { describe, expect, it } from "vitest";
import { dashscopeFailureReply, processSessionJob, type WorkerSession } from "./process-session.ts";
import type { LlmClient } from "@agenttag/runtime";

function session(): WorkerSession {
  return {
    id: "sess_1",
    tenantKey: "tenant_demo",
    chatId: "oc_auth",
    threadId: "omt_1",
    startedByOpenId: "ou_user",
    checklistMessageId: "om_card",
    status: "running",
    transcript: [{ type: "user", openId: "ou_user", text: "总结本群未关闭事项", at: "t" }],
  };
}

describe("processSessionJob", () => {
  it("patches the checklist card with the final reply", async () => {
    const patches: unknown[] = [];
    const llm: LlmClient = {
      async create() {
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "结论：两件未关闭事项。" }],
          usage: { input_tokens: 3, output_tokens: 4 },
        };
      },
    };
    const usages: unknown[] = [];
    await processSessionJob(
      { sessionId: "sess_1" },
      {
        llm,
        loadSession: async () => session(),
        patchCard: async (_id, card) => {
          patches.push(card);
        },
        recordUsage: async (row) => {
          usages.push(row);
        },
        recordAudit: async () => {},
        markSession: async () => {},
        appendEvents: async () => {},
        listMessages: async () => "[]",
        getBudget: async () => ({ usedUsd: 0, limitUsd: null }),
      },
    );
    const last = patches.at(-1) as { body?: { elements?: Array<{ content?: string }> }; header?: { title?: { content?: string } } };
    expect(JSON.stringify(last)).toContain("两件未关闭事项");
    expect(usages).toHaveLength(1);
  });

  it("marks the session failed and patches the card on 5xx", async () => {
    const statuses: string[] = [];
    const patches: unknown[] = [];
    const llm: LlmClient = {
      async create() {
        throw Object.assign(new Error("unavailable"), { status: 503 });
      },
    };
    await processSessionJob(
      { sessionId: "sess_1" },
      {
        llm,
        loadSession: async () => session(),
        patchCard: async (_id, card) => {
          patches.push(card);
        },
        recordUsage: async () => {},
        recordAudit: async () => {},
        markSession: async (_id, status) => {
          statuses.push(status);
        },
        appendEvents: async () => {},
        listMessages: async () => "[]",
        getBudget: async () => ({ usedUsd: 0, limitUsd: null }),
      },
    );
    expect(statuses).toContain("failed");
    expect(JSON.stringify(patches)).toContain("失败");
  });

  it("keeps a steer message appended while the model is running", async () => {
    const db = session();
    const seen: string[] = [];
    const llm: LlmClient = {
      async create(params) {
        seen.push(JSON.stringify(params.messages));
        if (seen.length === 1) {
          db.transcript.push({
            type: "user",
            openId: "ou_user",
            text: "把结论改成表格",
            at: "t2",
          });
        }
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: seen.length === 1 ? "初稿" : "表格版" }],
          usage: { input_tokens: 3, output_tokens: 4 },
        };
      },
    };
    await processSessionJob(
      { sessionId: "sess_1" },
      {
        llm,
        loadSession: async () => ({ ...db, transcript: [...db.transcript] }),
        patchCard: async () => {},
        recordUsage: async () => {},
        recordAudit: async () => {},
        markSession: async (_id, status) => {
          db.status = status;
        },
        appendEvents: async (_id, events, atIndex) => {
          if (atIndex == null) {
            db.transcript.push(...events);
          } else {
            db.transcript.splice(atIndex, 0, ...events);
          }
        },
        listMessages: async () => "[]",
        getBudget: async () => ({ usedUsd: 0, limitUsd: null }),
      },
    );
    expect(db.transcript.some((event) => event.type === "user" && event.text === "把结论改成表格")).toBe(true);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[1]).toContain("把结论改成表格");
    const roundTwo = JSON.parse(seen[1] ?? "[]") as Array<{ role: string }>;
    expect(roundTwo.at(-1)?.role).toBe("user");
  });

  it("marks the session failed and writes audit when a tool throws without crashing the job", async () => {
    const statuses: string[] = [];
    const audits: Array<{ toolName: string; success: boolean }> = [];
    const llm: LlmClient = {
      async create() {
        return {
          stop_reason: "tool_use",
          content: [{ type: "tool_use", id: "t1", name: "feishu_list_messages", input: {} }],
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    };
    await expect(
      processSessionJob(
        { sessionId: "sess_1" },
        {
          llm,
          loadSession: async () => session(),
          patchCard: async () => {},
          recordUsage: async () => {},
          recordAudit: async (row) => {
            audits.push({ toolName: row.toolName, success: row.success });
          },
          markSession: async (_id, status) => {
            statuses.push(status);
          },
          appendEvents: async () => {},
          listMessages: async () => {
            throw new Error("upstream timeout");
          },
          getBudget: async () => ({ usedUsd: 0, limitUsd: null }),
        },
      ),
    ).resolves.toBeUndefined();
    expect(statuses).toContain("failed");
    expect(audits).toContainEqual({ toolName: "feishu_list_messages", success: false });
  });

  it("does not call the model when the tenant monthly budget is exhausted", async () => {
    let called = 0;
    const llm: LlmClient = {
      async create() {
        called += 1;
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "不该出现" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    };
    const patches: unknown[] = [];
    await processSessionJob(
      { sessionId: "sess_1" },
      {
        llm,
        loadSession: async () => session(),
        patchCard: async (_id, card) => {
          patches.push(card);
        },
        recordUsage: async () => {},
        recordAudit: async () => {},
        markSession: async () => {},
        appendEvents: async () => {},
        listMessages: async () => "[]",
        getBudget: async () => ({ usedUsd: 10, limitUsd: 10 }),
      },
    );
    expect(called).toBe(0);
    expect(JSON.stringify(patches)).toContain("本月额度已用完");
  });

  it("sends the configured DashScope model instead of a hardcoded Anthropic id", async () => {
    let model = "";
    const llm: LlmClient = {
      async create(params) {
        model = params.model;
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "结论" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    };
    await processSessionJob(
      { sessionId: "sess_1" },
      {
        llm,
        model: "qwen-max",
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
    expect(model).toBe("qwen-max");
  });

  it("defaults the model id to qwen3.8-max", async () => {
    let model = "";
    const llm: LlmClient = {
      async create(params) {
        model = params.model;
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "结论" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    };
    await processSessionJob(
      { sessionId: "sess_1" },
      {
        llm,
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
    expect(model).toBe("qwen3.8-max");
  });

  it("injects the real model id and never claims to be Claude", async () => {
    let system = "";
    const llm: LlmClient = {
      async create(params) {
        system = params.system;
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "结论" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    };
    await processSessionJob(
      { sessionId: "sess_1" },
      {
        llm,
        model: "qwen3.8-max",
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
    expect(system).toContain("qwen3.8-max");
    expect(system).toContain("不要自称 Claude");
    expect(system).not.toMatch(/队友 Claude/);
  });

  it("does not turn thinking on just because the user asked to think step by step", async () => {
    let enableThinking: boolean | undefined;
    const llm: LlmClient = {
      async create(params) {
        enableThinking = params.enableThinking;
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "结论" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    };
    const row = session();
    row.transcript = [{ type: "user", openId: "ou_user", text: "请一步一步思考后再回答", at: "t" }];
    await processSessionJob(
      { sessionId: "sess_1" },
      {
        llm,
        model: "qwen3.8-max",
        enableThinking: false,
        loadSession: async () => row,
        patchCard: async () => {},
        recordUsage: async () => {},
        recordAudit: async () => {},
        markSession: async () => {},
        appendEvents: async () => {},
        listMessages: async () => "[]",
        getBudget: async () => ({ usedUsd: 0, limitUsd: null }),
      },
    );
    expect(enableThinking).toBe(false);
  });

  it("fails closed on Model not exist without retrying a weaker model", async () => {
    let called = 0;
    const patches: unknown[] = [];
    const llm: LlmClient = {
      async create() {
        called += 1;
        throw Object.assign(new Error("模型接口 400"), {
          status: 400,
          dashscopeMessage: "The model xxx does not exist",
        });
      },
    };
    const statuses: string[] = [];
    await processSessionJob(
      { sessionId: "sess_1" },
      {
        llm,
        model: "qwen3.8-max",
        loadSession: async () => session(),
        patchCard: async (_id, card) => {
          patches.push(card);
        },
        recordUsage: async () => {},
        recordAudit: async () => {},
        markSession: async (_id, status) => {
          statuses.push(status);
        },
        appendEvents: async () => {},
        listMessages: async () => "[]",
        getBudget: async () => ({ usedUsd: 0, limitUsd: null }),
      },
    );
    expect(called).toBe(1);
    expect(statuses).toContain("failed");
    const blob = JSON.stringify(patches);
    expect(blob).toContain("处理失败");
    expect(blob).toContain("qwen3.8-max");
    expect(blob).toMatch(/不可用或未开通/);
    expect(blob).not.toContain("qwen-plus");
    expect(blob).not.toContain("sk-");
  });

  it("puts the model id on every progress card patch", async () => {
    const patches: unknown[] = [];
    const llm: LlmClient = {
      async create() {
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "结论：两件未关闭事项。" }],
          usage: { input_tokens: 3, output_tokens: 4 },
        };
      },
    };
    await processSessionJob(
      { sessionId: "sess_1" },
      {
        llm,
        model: "kimi-k3",
        enableThinking: true,
        loadSession: async () => session(),
        patchCard: async (_id, card) => {
          patches.push(card);
        },
        recordUsage: async () => {},
        recordAudit: async () => {},
        markSession: async () => {},
        appendEvents: async () => {},
        listMessages: async () => "[]",
        getBudget: async () => ({ usedUsd: 0, limitUsd: null }),
      },
    );
    expect(patches.length).toBeGreaterThan(0);
    for (const card of patches) {
      const typed = card as { header?: { subtitle?: { content?: string } }; body?: { elements?: Array<{ content?: string }> } };
      expect(typed.header?.subtitle?.content).toContain("kimi-k3");
      expect(typed.body?.elements?.[0]?.content).toContain("模型：`kimi-k3`");
    }
  });

  it("echoes reasoning on the next round after a thinking turn so Kimi steer does not drop it", async () => {
    const db = session();
    const seen: unknown[] = [];
    const llm: LlmClient = {
      async create(params) {
        seen.push(params.messages);
        if (seen.length === 1) {
          db.transcript.push({
            type: "user",
            openId: "ou_user",
            text: "把结论改成表格",
            at: "t2",
          });
          return {
            stop_reason: "end_turn",
            content: [
              { type: "reasoning", text: "kimi-k3 思考块" },
              { type: "text", text: "初稿" },
            ],
            usage: { input_tokens: 3, output_tokens: 4 },
          };
        }
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "表格版" }],
          usage: { input_tokens: 3, output_tokens: 4 },
        };
      },
    };
    await processSessionJob(
      { sessionId: "sess_1" },
      {
        llm,
        model: "kimi-k3",
        enableThinking: true,
        loadSession: async () => ({ ...db, transcript: [...db.transcript] }),
        patchCard: async () => {},
        recordUsage: async () => {},
        recordAudit: async () => {},
        markSession: async (_id, status) => {
          db.status = status;
        },
        appendEvents: async (_id, events, atIndex) => {
          if (atIndex == null) {
            db.transcript.push(...events);
          } else {
            db.transcript.splice(atIndex, 0, ...events);
          }
        },
        listMessages: async () => "[]",
        getBudget: async () => ({ usedUsd: 0, limitUsd: null }),
      },
    );
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(seen[1])).toContain("kimi-k3 思考块");
    expect(JSON.stringify(seen[1])).not.toContain("sk-");
  });
});

describe("dashscopeFailureReply", () => {
  it("maps model-missing, thinking-switch, and always-on disabled errors without echoing secrets", () => {
    expect(
      dashscopeFailureReply(
        Object.assign(new Error("模型接口 400"), { status: 400, dashscopeMessage: "The model xxx does not exist" }),
        "qwen3.8-max",
      ),
    ).toContain("不可用或未开通");
    expect(
      dashscopeFailureReply(
        Object.assign(new Error("模型接口 400"), { status: 400, dashscopeMessage: "InvalidParameter.NotSupportEnableThinking" }),
        "qwen3.8-max",
      ),
    ).toContain("不支持当前思考开关");
    expect(
      dashscopeFailureReply(
        Object.assign(new Error("模型接口 400"), { status: 400, dashscopeMessage: "thinking.type=disabled is not allowed" }),
        "ZHIPU/GLM-5.3",
      ),
    ).toBe("该模型始终思考，不能关闭");
    expect(
      dashscopeFailureReply(
        Object.assign(new Error("模型接口 401"), { status: 401, dashscopeMessage: "invalid sk-dashscope-test" }),
        "qwen3.8-max",
      ),
    ).toBe("模型接口 401");
    expect(
      dashscopeFailureReply(
        Object.assign(new Error("模型接口 401"), { status: 401, dashscopeMessage: "invalid sk-dashscope-test" }),
        "qwen3.8-max",
      ),
    ).not.toContain("sk-dashscope-test");
  });
});

describe("sandbox extra tools", () => {
  it("sends extra tool defs to the model and mentions the sandbox without claiming to be Claude", async () => {
    let tools: unknown[] = [];
    let system = "";
    const llm: LlmClient = {
      async create(params) {
        tools = params.tools as unknown[];
        system = params.system;
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "结论" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
    };
    await processSessionJob(
      { sessionId: "sess_1" },
      {
        llm,
        model: "qwen3.8-max",
        sandboxEnabled: true,
        extraToolDefs: [{ name: "bash", description: "沙箱", input_schema: { type: "object", properties: {} } }],
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
    expect(JSON.stringify(tools)).toContain("bash");
    expect(system).toContain("隔离沙箱");
    expect(system).toContain("qwen3.8-max");
    expect(system).not.toMatch(/队友 Claude/);
  });
});
