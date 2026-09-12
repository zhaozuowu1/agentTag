import type { AgentTurnResult, TranscriptEvent } from "@agenttag/domain";
import { progressCard } from "@agenttag/feishu";
import { messagesFromTranscript, runAgentLoop, type LlmClient } from "@agenttag/runtime";

export interface WorkerSession {
  id: string;
  tenantKey: string;
  chatId: string;
  threadId: string | null;
  startedByOpenId: string;
  checklistMessageId: string | null;
  status: string;
  transcript: TranscriptEvent[];
}

export interface ProcessSessionDeps {
  llm: LlmClient;
  loadSession(sessionId: string): Promise<WorkerSession | null>;
  patchCard(messageId: string, card: unknown): Promise<void>;
  recordUsage(row: {
    sessionId: string;
    chatId: string;
    openId: string;
    inputTokens: number;
    outputTokens: number;
  }): Promise<void>;
  recordAudit(row: {
    sessionId: string;
    chatId: string;
    openId: string;
    toolName: string;
    success: boolean;
  }): Promise<void>;
  markSession(sessionId: string, status: "idle" | "failed", transcript?: TranscriptEvent[]): Promise<void>;
  listMessages: (input: unknown) => Promise<string>;
  searchMessages?: (input: unknown) => Promise<string>;
}

function cardFrom(result: AgentTurnResult, title: string) {
  return progressCard({
    title,
    statusText: result.stop ? "已完成" : "进行中",
    checklist: result.checklist,
    markdown: result.replyMarkdown,
  });
}

export async function processSessionJob(
  job: { sessionId: string },
  deps: ProcessSessionDeps,
): Promise<void> {
  const session = await deps.loadSession(job.sessionId);
  if (!session || !session.checklistMessageId) {
    return;
  }

  const userTurns = session.transcript.filter((event) => event.type === "user");
  const lastUser = userTurns.at(-1);
  const fallback = lastUser && lastUser.type === "user" ? lastUser.text : "请根据当前会话继续。";
  const messages = messagesFromTranscript(session.transcript);
  if (messages.length === 0) {
    messages.push({ role: "user", content: fallback });
  }

  const initial: AgentTurnResult = {
    checklist: [{ id: "history", label: "读取群历史", status: "doing" }],
    replyMarkdown: "",
    stop: false,
  };

  try {
    await deps.patchCard(session.checklistMessageId, cardFrom(initial, "正在处理"));
    const result = await runAgentLoop({
      llm: deps.llm,
      model: "claude-sonnet-4-6",
      system:
        "你是飞书群里的队友 Claude。用中文回答。先用工具了解本群现场，再给出简洁结论。只把稳定约定写入记忆工具（若可用），不要把流水账当记忆。",
      messages,
      tools: {
        feishu_list_messages: deps.listMessages,
        feishu_search_messages: deps.searchMessages ?? deps.listMessages,
      },
      initial,
      onTurn: async (turn) => {
        await deps.patchCard(session.checklistMessageId!, cardFrom(turn, turn.stop ? "处理完成" : "正在处理"));
      },
      onUsage: async (usage) => {
        await deps.recordUsage({
          sessionId: session.id,
          chatId: session.chatId,
          openId: session.startedByOpenId,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
        });
      },
    });
    await deps.patchCard(session.checklistMessageId, cardFrom(result, "处理完成"));
    await deps.recordAudit({
      sessionId: session.id,
      chatId: session.chatId,
      openId: session.startedByOpenId,
      toolName: "session.run",
      success: true,
    });
    await deps.markSession(session.id, "idle", [
      ...session.transcript,
      { type: "assistant", text: result.replyMarkdown, at: new Date().toISOString() },
    ]);
  } catch (error) {
    const failed: AgentTurnResult = {
      checklist: [{ id: "history", label: "读取群历史", status: "blocked" }],
      replyMarkdown: "处理失败，请稍后再试。",
      stop: true,
    };
    await deps.patchCard(session.checklistMessageId, cardFrom(failed, "处理失败"));
    await deps.recordAudit({
      sessionId: session.id,
      chatId: session.chatId,
      openId: session.startedByOpenId,
      toolName: "session.run",
      success: false,
    });
    await deps.markSession(session.id, "failed", [
      ...session.transcript,
      {
        type: "error",
        message: error instanceof Error ? error.message : "unknown",
        at: new Date().toISOString(),
      },
    ]);
  }
}
