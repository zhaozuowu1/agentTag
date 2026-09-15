import { describe, expect, it } from "vitest";
import type { AgentTurnResult } from "@agenttag/domain";
import type { FeishuClient, FeishuMessage } from "@agenttag/feishu";
import { createMemoryStore } from "@agenttag/memory";
import { createFeishuMessageTools, FEISHU_MESSAGE_TOOL_DEFS } from "./tools/feishu-messages.ts";
import { createMemoryTools } from "./tools/memory.ts";
import { runAgentLoop } from "./loop.ts";
import {
  createOpenAiCompatLlm,
  fromOpenAiChatResponse,
  toOpenAiMessages,
  toOpenAiTools,
} from "./openai-compat.ts";

const empty: AgentTurnResult = {
  checklist: [{ id: "history", label: "读取群历史", status: "doing" }],
  replyMarkdown: "",
  stop: false,
};

describe("toOpenAiTools", () => {
  it("maps Anthropic input_schema tool defs to OpenAI function tools", () => {
    const tools = toOpenAiTools([...FEISHU_MESSAGE_TOOL_DEFS]);
    expect(tools[0]).toEqual({
      type: "function",
      function: {
        name: "feishu_list_messages",
        description: FEISHU_MESSAGE_TOOL_DEFS[0].description,
        parameters: FEISHU_MESSAGE_TOOL_DEFS[0].input_schema,
      },
    });
    expect(JSON.stringify(tools)).not.toContain("input_schema");
  });
});

describe("toOpenAiMessages", () => {
  it("puts system first and maps tool_use / tool_result onto chat completions roles", () => {
    const messages = toOpenAiMessages("你是飞书群里的队友。", [
      { role: "user", content: "总结本群未关闭事项" },
      {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "call_1",
            name: "feishu_list_messages",
            input: { container: "chat" },
          },
        ],
      },
      {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "call_1", content: "[{}]" }],
      },
    ]);
    expect(messages[0]).toEqual({ role: "system", content: "你是飞书群里的队友。" });
    expect(messages[1]).toEqual({ role: "user", content: "总结本群未关闭事项" });
    expect(messages[2]).toMatchObject({
      role: "assistant",
      tool_calls: [
        {
          id: "call_1",
          type: "function",
          function: {
            name: "feishu_list_messages",
            arguments: JSON.stringify({ container: "chat" }),
          },
        },
      ],
    });
    expect(messages[3]).toEqual({
      role: "tool",
      tool_call_id: "call_1",
      content: "[{}]",
    });
  });
});

describe("fromOpenAiChatResponse", () => {
  it("maps finish_reason tool_calls onto the runtime tool_use loop", () => {
    const mapped = fromOpenAiChatResponse({
      choices: [
        {
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: "",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "feishu_list_messages",
                  arguments: JSON.stringify({ container: "chat" }),
                },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 11, completion_tokens: 7 },
    });
    expect(mapped.stop_reason).toBe("tool_use");
    expect(mapped.content).toEqual([
      {
        type: "tool_use",
        id: "call_1",
        name: "feishu_list_messages",
        input: { container: "chat" },
      },
    ]);
    expect(mapped.usage).toEqual({ input_tokens: 11, output_tokens: 7 });
  });

  it("maps finish_reason stop onto end_turn with assistant text", () => {
    const mapped = fromOpenAiChatResponse({
      choices: [
        {
          finish_reason: "stop",
          message: { role: "assistant", content: "本群有两件未关闭事项。" },
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 9 },
    });
    expect(mapped).toEqual({
      stop_reason: "end_turn",
      content: [{ type: "text", text: "本群有两件未关闭事项。" }],
      usage: { input_tokens: 20, output_tokens: 9 },
    });
  });

  it("keeps reasoning_content as its own content part so it can be echoed later", () => {
    const mapped = fromOpenAiChatResponse({
      choices: [
        {
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "最终回答",
            reasoning_content: "中间思考",
          },
        },
      ],
      usage: { prompt_tokens: 2, completion_tokens: 3 },
    });
    expect(mapped.content).toEqual([
      { type: "reasoning", text: "中间思考" },
      { type: "text", text: "最终回答" },
    ]);
  });
});

describe("createOpenAiCompatLlm", () => {
  it("POSTs chat completions with Bearer auth and drives the existing tool loop", async () => {
    const requests: Array<{ url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
    const llm = createOpenAiCompatLlm({
      apiKey: "sk-dashscope-test",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      fetch: async (input, init) => {
        const url = String(input);
        const headers = Object.fromEntries(new Headers(init?.headers).entries());
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        requests.push({ url, headers, body });
        const last = (body.messages as Array<{ role: string }>).at(-1);
        if (last?.role !== "tool") {
          return new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "tool_calls",
                  message: {
                    role: "assistant",
                    content: "",
                    tool_calls: [
                      {
                        id: "call_1",
                        type: "function",
                        function: {
                          name: "feishu_list_messages",
                          arguments: JSON.stringify({ container: "chat" }),
                        },
                      },
                    ],
                  },
                },
              ],
              usage: { prompt_tokens: 10, completion_tokens: 5 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: { role: "assistant", content: "本群有两件未关闭事项。" },
              },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 8 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });

    const calls: string[] = [];
    const result = await runAgentLoop({
      llm,
      model: "qwen-plus",
      system: "你是飞书群里的队友。",
      messages: [{ role: "user", content: "总结本群未关闭事项" }],
      tools: {
        feishu_list_messages: async () => {
          calls.push("feishu_list_messages");
          return JSON.stringify([{ text: "待办：发周报" }]);
        },
      },
      toolDefs: [...FEISHU_MESSAGE_TOOL_DEFS],
      initial: empty,
      onTurn: async () => {},
    });

    expect(calls).toEqual(["feishu_list_messages"]);
    expect(result.stop).toBe(true);
    expect(result.replyMarkdown).toContain("未关闭事项");
    expect(requests[0]?.url).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions");
    expect(requests[0]?.headers.authorization).toBe("Bearer sk-dashscope-test");
    expect(requests[0]?.body.model).toBe("qwen-plus");
    expect(requests[0]?.body.stream).toBe(false);
    expect(requests[0]?.body.enable_thinking).toBe(false);
    expect(requests[0]?.body.max_tokens).toBe(8192);
    expect(JSON.stringify(requests[0]?.body)).not.toContain("disabled");
    expect(JSON.stringify(requests[0]?.body)).not.toContain("tool_stream");
    expect(JSON.stringify(requests[0]?.body)).not.toContain("sk-dashscope-test");
    expect(requests[1]?.body.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: "tool", tool_call_id: "call_1" })]),
    );
  });

  it("surfaces upstream 5xx as a status error without echoing the API key", async () => {
    const llm = createOpenAiCompatLlm({
      apiKey: "sk-dashscope-test",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: "upstream overloaded", code: "503" } }), {
          status: 503,
          headers: { "Content-Type": "application/json" } },
        ),
    });
    await expect(
      llm.create({
        model: "qwen-plus",
        system: "you",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
      }),
    ).rejects.toMatchObject({ status: 503 });
    try {
      await llm.create({
        model: "qwen-plus",
        system: "you",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("sk-dashscope-test");
    }
  });

  it("does not run memory_upsert when tool arguments are truncated JSON", async () => {
    const store = createMemoryStore();
    const tools = createMemoryTools(store, {
      tenantKey: "tenant_demo",
      chatId: "oc_auth",
      openId: "ou_user",
      chatType: "private",
      sessionId: "sess_1",
    });
    const llm = createOpenAiCompatLlm({
      apiKey: "sk-dashscope-test",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "memory_upsert",
                        arguments: '{"kind":"fact","text":"周报用表格"',
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 8, completion_tokens: 4 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });
    await expect(
      runAgentLoop({
        llm,
        model: "qwen-plus",
        system: "you",
        messages: [{ role: "user", content: "记住周报用表格" }],
        tools: { memory_upsert: tools.memory_upsert },
        initial: empty,
        onTurn: async () => {},
      }),
    ).rejects.toThrow(/合法 JSON/);
    expect(await store.list({ tenantKey: "tenant_demo", chatId: "oc_auth" })).toEqual([]);
  });

  it("does not run feishu_search_messages when tool arguments are truncated JSON", async () => {
    const listCalls: Array<{ container: string; id: string }> = [];
    const tools = createFeishuMessageTools(
      {
        botOpenId: async () => "ou_bot",
        replyInThread: async () => ({ messageId: "om_x", threadId: "omt_x" }),
        patchCard: async () => {},
        sendText: async () => ({ messageId: "om_t" }),
        sendCard: async () => ({ messageId: "om_card" }),
        getChat: async () => ({ chatType: "private", external: false, name: "群" }),
        listMessages: async (opts) => {
          listCalls.push({ container: opts.container, id: opts.id });
          return [] as FeishuMessage[];
        },
      } satisfies FeishuClient,
      { chatId: "oc_auth", threadId: "omt_1" },
    );
    const llm = createOpenAiCompatLlm({
      apiKey: "sk-dashscope-test",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      fetch: async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "tool_calls",
                message: {
                  role: "assistant",
                  content: "",
                  tool_calls: [
                    {
                      id: "call_1",
                      type: "function",
                      function: {
                        name: "feishu_search_messages",
                        arguments: '{"query":"未关闭',
                      },
                    },
                  ],
                },
              },
            ],
            usage: { prompt_tokens: 8, completion_tokens: 4 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
    });
    await expect(
      runAgentLoop({
        llm,
        model: "qwen-plus",
        system: "you",
        messages: [{ role: "user", content: "搜未关闭事项" }],
        tools: { feishu_search_messages: tools.feishu_search_messages },
        initial: empty,
        onTurn: async () => {},
      }),
    ).rejects.toThrow(/合法 JSON/);
    expect(listCalls).toEqual([]);
  });
});

describe("thinking and reasoning_content", () => {
  it("sends enable_thinking true and a larger max_tokens when thinking is on", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const llm = createOpenAiCompatLlm({
      apiKey: "sk-dashscope-test",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            choices: [{ finish_reason: "stop", message: { role: "assistant", content: "你好" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });
    await llm.create({
      model: "qwen3.8-max",
      system: "you",
      messages: [{ role: "user", content: "你好" }],
      tools: [],
      enableThinking: true,
    });
    expect(bodies[0]?.enable_thinking).toBe(true);
    expect(bodies[0]?.max_tokens).toBeGreaterThanOrEqual(16384);
    expect(JSON.stringify(bodies[0])).not.toContain("disabled");
  });

  it("never sends thinking disabled for always-on GLM even when the caller asked to turn it off", async () => {
    const { resolveRuntimeModel } = await import("@agenttag/domain");
    const resolved = resolveRuntimeModel({
      tenantModelId: "ZHIPU/GLM-5.3",
      tenantEnableThinking: false,
      envModelId: "qwen3.8-max",
    });
    const bodies: Array<Record<string, unknown>> = [];
    const llm = createOpenAiCompatLlm({
      apiKey: "sk-dashscope-test",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      fetch: async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
        return new Response(
          JSON.stringify({
            choices: [{ finish_reason: "stop", message: { role: "assistant", content: "hi" } }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      },
    });
    await llm.create({
      model: resolved.modelId,
      system: "you",
      messages: [{ role: "user", content: "你好" }],
      tools: [],
      enableThinking: resolved.enableThinking,
    });
    expect(resolved.enableThinking).toBe(true);
    expect(bodies[0]?.model).toBe("ZHIPU/GLM-5.3");
    expect(bodies[0]?.enable_thinking).toBe(true);
    expect(bodies[0]?.thinking).toEqual({ type: "enabled" });
    expect(bodies[0]?.max_tokens).toBeGreaterThanOrEqual(16384);
    expect(JSON.stringify(bodies[0])).not.toMatch(/disabled/i);
    expect(bodies[0]?.tool_stream).toBeUndefined();
  });

  it.each(["ZHIPU/GLM-5.3", "kimi-k3"] as const)(
    "echoes reasoning_content on the next %s tool-loop request",
    async (modelId) => {
      const bodies: Array<Record<string, unknown>> = [];
      const llm = createOpenAiCompatLlm({
        apiKey: "sk-dashscope-test",
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        fetch: async (_input, init) => {
          const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
          bodies.push(body);
          const last = (body.messages as Array<{ role: string }>).at(-1);
          if (last?.role !== "tool") {
            return new Response(
              JSON.stringify({
                choices: [
                  {
                    finish_reason: "tool_calls",
                    message: {
                      role: "assistant",
                      content: "",
                      reasoning_content: `${modelId} 思考块`,
                      tool_calls: [
                        {
                          id: "call_1",
                          type: "function",
                          function: {
                            name: "feishu_list_messages",
                            arguments: JSON.stringify({ container: "chat" }),
                          },
                        },
                      ],
                    },
                  },
                ],
                usage: { prompt_tokens: 4, completion_tokens: 6 },
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            );
          }
          return new Response(
            JSON.stringify({
              choices: [
                {
                  finish_reason: "stop",
                  message: { role: "assistant", content: "本群有两件未关闭事项。" },
                },
              ],
              usage: { prompt_tokens: 8, completion_tokens: 4 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        },
      });

      const result = await runAgentLoop({
        llm,
        model: modelId,
        system: "you",
        messages: [{ role: "user", content: "总结本群未关闭事项" }],
        tools: {
          feishu_list_messages: async () => JSON.stringify([{ text: "待办：发周报" }]),
        },
        toolDefs: [...FEISHU_MESSAGE_TOOL_DEFS],
        initial: empty,
        onTurn: async () => {},
        enableThinking: true,
      });

      expect(result.replyMarkdown).toContain("未关闭事项");
      expect(result.replyMarkdown).not.toContain("思考块");
      const second = bodies[1]?.messages as Array<{ role?: string; reasoning_content?: string }>;
      expect(second).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            reasoning_content: `${modelId} 思考块`,
          }),
        ]),
      );
    },
  );
});

describe("createOpenAiCompatLlm fail-close", () => {
  it("surfaces Model not exist as a 400 without retrying another model or echoing the key", async () => {
    let calls = 0;
    const llm = createOpenAiCompatLlm({
      apiKey: "sk-dashscope-test",
      baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      fetch: async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: { message: "The model xxx does not exist", code: "InvalidParameter" } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      },
    });
    await expect(
      llm.create({
        model: "qwen3.8-max",
        system: "you",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
      }),
    ).rejects.toMatchObject({ status: 400, dashscopeMessage: expect.stringMatching(/does not exist/i) });
    expect(calls).toBe(1);
    try {
      await llm.create({
        model: "qwen3.8-max",
        system: "you",
        messages: [{ role: "user", content: "hi" }],
        tools: [],
      });
    } catch (error) {
      const blob = JSON.stringify(error);
      expect(blob).not.toContain("sk-dashscope-test");
    }
  });
});

describe("fromOpenAiChatResponse invalid tool arguments", () => {
  it("rejects truncated tool-call JSON instead of mapping it to {}", () => {
    expect(() =>
      fromOpenAiChatResponse({
        choices: [
          {
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "memory_upsert",
                    arguments: '{"kind":"fact","text":"周报用表格"',
                  },
                },
              ],
            },
          },
        ],
      }),
    ).toThrow(/合法 JSON/);
  });
});
