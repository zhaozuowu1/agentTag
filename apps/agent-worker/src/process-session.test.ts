import { describe, expect, it } from "vitest";
import { processSessionJob } from "./process-session.ts";
import type { LlmClient } from "@agenttag/runtime";

function session() {
  return {
    id: "sess_1",
    tenantKey: "tenant_demo",
    chatId: "oc_auth",
    threadId: "omt_1",
    startedByOpenId: "ou_user",
    checklistMessageId: "om_card",
    status: "running" as const,
    transcript: [{ type: "user" as const, openId: "ou_user", text: "总结本群未关闭事项", at: "t" }],
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
        appendEvents: async (_id, events) => {
          db.transcript.push(...events);
        },
        listMessages: async () => "[]",
      },
    );
    expect(db.transcript.some((event) => event.type === "user" && event.text === "把结论改成表格")).toBe(true);
    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[1]).toContain("把结论改成表格");
  });
});
