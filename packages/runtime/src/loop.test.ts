import { describe, expect, it } from "vitest";
import { reduceToolResult, runAgentLoop, type LlmClient } from "./loop.ts";
import type { AgentTurnResult, TranscriptEvent } from "@agenttag/domain";

const empty: AgentTurnResult = {
  checklist: [{ id: "history", label: "读取群历史", status: "doing" }],
  replyMarkdown: "",
  stop: false,
};

describe("reduceToolResult", () => {
  it("marks the matching checklist item done after a tool result", () => {
    const event: TranscriptEvent = {
      type: "tool_result",
      name: "feishu_list_messages",
      toolUseId: "tool_1",
      content: "found 2 messages",
      at: "2026-01-01T00:00:00.000Z",
    };
    const next = reduceToolResult(empty, event);
    expect(next.checklist[0]?.status).toBe("done");
    expect(next.stop).toBe(false);
  });
});

describe("runAgentLoop", () => {
  it("runs tool_use then exits on stop_reason end_turn", async () => {
    const calls: string[] = [];
    const llm: LlmClient = {
      async create(params) {
        const last = params.messages.at(-1);
        const lastHasToolResult =
          Array.isArray(last?.content) &&
          last.content.some((part) => part.type === "tool_result");
        if (!lastHasToolResult) {
          return {
            stop_reason: "tool_use",
            content: [
              {
                type: "tool_use",
                id: "tool_1",
                name: "feishu_list_messages",
                input: { container: "chat", id: "oc_auth" },
              },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          };
        }
        return {
          stop_reason: "end_turn",
          content: [{ type: "text", text: "本群有两件未关闭事项。" }],
          usage: { input_tokens: 12, output_tokens: 8 },
        };
      },
    };

    const patches: AgentTurnResult[] = [];
    const result = await runAgentLoop({
      llm,
      model: "claude-sonnet-4-6",
      system: "你是飞书群里的队友 Claude。",
      messages: [{ role: "user", content: "总结本群未关闭事项" }],
      tools: {
        feishu_list_messages: async () => {
          calls.push("feishu_list_messages");
          return JSON.stringify([{ text: "待办：发周报" }]);
        },
      },
      initial: empty,
      onTurn: async (turn) => {
        patches.push(turn);
      },
    });

    expect(calls).toEqual(["feishu_list_messages"]);
    expect(result.stop).toBe(true);
    expect(result.replyMarkdown).toContain("未关闭事项");
    expect(patches.length).toBeGreaterThanOrEqual(2);
    expect(result.checklist.some((item) => item.status === "done")).toBe(true);
  });

  it("marks the session failed when the model returns 5xx", async () => {
    const llm: LlmClient = {
      async create() {
        const error = Object.assign(new Error("upstream 503"), { status: 503 });
        throw error;
      },
    };
    await expect(
      runAgentLoop({
        llm,
        model: "claude-sonnet-4-6",
        system: "you",
        messages: [{ role: "user", content: "hi" }],
        tools: {},
        initial: empty,
        onTurn: async () => {},
      }),
    ).rejects.toMatchObject({ status: 503 });
  });
});
