import type { AgentTurnResult, TranscriptEvent } from "@agenttag/domain";
import { canStartSession, DEFAULT_DASHSCOPE_MODEL } from "@agenttag/domain";
import { progressCard } from "@agenttag/feishu";
import { messagesFromTranscript, runAgentLoop, type LlmClient } from "@agenttag/runtime";
import { FEISHU_MESSAGE_TOOL_DEFS, MEMORY_TOOL_DEFS } from "@agenttag/runtime";

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
  model?: string;
  enableThinking?: boolean;
  loadSession(sessionId: string): Promise<WorkerSession | null>;
  patchCard(messageId: string, card: unknown): Promise<void>;
  recordUsage(row: {
    sessionId: string;
    chatId: string;
    openId: string;
    inputTokens: number;
    outputTokens: number;
    modelId?: string;
  }): Promise<void>;
  recordAudit(row: {
    sessionId: string;
    chatId: string;
    openId: string;
    toolName: string;
    success: boolean;
  }): Promise<void>;
  markSession(sessionId: string, status: "idle" | "failed"): Promise<void>;
  appendEvents(sessionId: string, events: TranscriptEvent[], atIndex?: number): Promise<void>;
  listMessages: (input: unknown) => Promise<string>;
  searchMessages?: (input: unknown) => Promise<string>;
  extraTools?: Record<string, (input: unknown) => Promise<string>>;
  extraToolDefs?: unknown[];
  sandboxEnabled?: boolean;
  memoryBlock?: string;
  getBudget(tenantKey: string): Promise<{ usedUsd: number; limitUsd: number | null }>;
}

function cardFrom(result: AgentTurnResult, title: string, modelId: string, enableThinking: boolean) {
  return progressCard({
    title,
    statusText: result.stop ? "已完成" : "进行中",
    checklist: result.checklist,
    markdown: result.replyMarkdown,
    modelId,
    enableThinking,
  });
}

function userTurnCount(transcript: TranscriptEvent[]): number {
  return transcript.filter((event) => event.type === "user").length;
}

export function workerSystemPrompt(modelId: string, memoryBlock?: string, extras?: { sandbox?: boolean }): string {
  const sandboxLine = extras?.sandbox
    ? "你可以使用隔离沙箱工具（bash、read_file、write_file、http_request）处理文件与作图；出站 HTTP 必须走允许名单。凭证不会出现在沙箱里。把图表 png 用 feishu_post_file 发回当前话题。\n"
    : "";
  return `你是飞书群里的 AI 队友。你的底层模型是 ${modelId}。用中文回答。不要自称 Claude、GPT 或其他厂商模型。先用工具了解本群现场，再给出简洁结论。只把稳定约定写入记忆工具（若可用），不要把流水账当记忆。\n${sandboxLine}${memoryBlock ?? "本群尚无已保存记忆。"}`;
}

export function dashscopeFailureReply(error: unknown, modelId: string): string {
  const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) : undefined;
  const dashscopeMessage =
    error && typeof error === "object" && "dashscopeMessage" in error
      ? String((error as { dashscopeMessage?: unknown }).dashscopeMessage ?? "")
      : "";
  const message = error instanceof Error ? error.message : String(error);
  const combined = `${message}\n${dashscopeMessage}`;
  if (/Model not exist|does not exist|Unsupported model|compatibility mode/i.test(combined)) {
    return `模型 \`${modelId}\` 不可用或未开通，请在百炼控制台开通或在管理台改回目录内模型`;
  }
  if (/NotSupportEnableThinking/i.test(combined)) {
    return "该模型不支持当前思考开关，请关闭思考或改用可关思考的模型";
  }
  if (/thinking\.type\s*=\s*disabled|enable_thinking["']?\s*[:=]\s*false/i.test(combined)) {
    return "该模型始终思考，不能关闭";
  }
  if (/reasoning_content|思考块/i.test(combined)) {
    return "模型多轮思考块丢失";
  }
  if (status === 401) {
    return "模型接口 401";
  }
  return "处理失败，请稍后再试。";
}

export async function processSessionJob(
  job: { sessionId: string },
  deps: ProcessSessionDeps,
): Promise<void> {
  const first = await deps.loadSession(job.sessionId);
  if (!first || !first.checklistMessageId) {
    return;
  }

  const modelId = deps.model ?? DEFAULT_DASHSCOPE_MODEL;
  const enableThinking = deps.enableThinking === true;

  const initial: AgentTurnResult = {
    checklist: [{ id: "history", label: "读取群历史", status: "doing" }],
    replyMarkdown: "",
    stop: false,
  };

  try {
    for (let round = 0; round < 8; round += 1) {
      const session = await deps.loadSession(job.sessionId);
      if (!session || !session.checklistMessageId) {
        return;
      }
      const budget = await deps.getBudget(session.tenantKey);
      if (!canStartSession(budget.usedUsd, budget.limitUsd)) {
        const exhausted: AgentTurnResult = {
          checklist: [{ id: "history", label: "读取群历史", status: "blocked" }],
          replyMarkdown: "本月额度已用完",
          stop: true,
        };
        await deps.patchCard(session.checklistMessageId, cardFrom(exhausted, "本月额度已用完", modelId, enableThinking));
        await deps.markSession(session.id, "idle");
        return;
      }
      if (round === 0) {
        await deps.patchCard(session.checklistMessageId, cardFrom(initial, "正在处理", modelId, enableThinking));
      }
      const originLength = session.transcript.length;
      const usersBefore = userTurnCount(session.transcript);
      const userTurns = session.transcript.filter((event) => event.type === "user");
      const lastUser = userTurns.at(-1);
      const fallback = lastUser && lastUser.type === "user" ? lastUser.text : "请根据当前会话继续。";
      const messages = messagesFromTranscript(session.transcript);
      if (messages.length === 0) {
        messages.push({ role: "user", content: fallback });
      }

      const result = await runAgentLoop({
        llm: deps.llm,
        model: modelId,
        enableThinking,
        system: workerSystemPrompt(modelId, deps.memoryBlock, { sandbox: deps.sandboxEnabled === true }),
        messages,
        tools: {
          feishu_list_messages: deps.listMessages,
          feishu_search_messages: deps.searchMessages ?? deps.listMessages,
          ...deps.extraTools,
        },
        toolDefs: [...FEISHU_MESSAGE_TOOL_DEFS, ...MEMORY_TOOL_DEFS, ...(deps.extraToolDefs ?? [])],
        initial,
        onTurn: async (turn) => {
          await deps.patchCard(session.checklistMessageId!, cardFrom(turn, turn.stop ? "处理完成" : "正在处理", modelId, enableThinking));
        },
        onUsage: async (usage) => {
          await deps.recordUsage({
            sessionId: session.id,
            chatId: session.chatId,
            openId: session.startedByOpenId,
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            modelId,
          });
        },
        onToolError: async ({ name }) => {
          await deps.recordAudit({
            sessionId: session.id,
            chatId: session.chatId,
            openId: session.startedByOpenId,
            toolName: name,
            success: false,
          });
        },
      });
      await deps.patchCard(session.checklistMessageId, cardFrom(result, "处理完成", modelId, enableThinking));
      await deps.appendEvents(
        session.id,
        [
          {
            type: "assistant",
            text: result.replyMarkdown,
            ...(result.reasoning ? { reasoning: result.reasoning } : {}),
            at: new Date().toISOString(),
          },
        ],
        originLength,
      );
      const latest = await deps.loadSession(job.sessionId);
      if (latest && userTurnCount(latest.transcript) > usersBefore) {
        continue;
      }
      await deps.markSession(session.id, "idle");
      const afterIdle = await deps.loadSession(job.sessionId);
      if (afterIdle && userTurnCount(afterIdle.transcript) > usersBefore) {
        continue;
      }
      break;
    }
    await deps.recordAudit({
      sessionId: first.id,
      chatId: first.chatId,
      openId: first.startedByOpenId,
      toolName: "session.run",
      success: true,
    });
  } catch (error) {
    const failed: AgentTurnResult = {
      checklist: [{ id: "history", label: "读取群历史", status: "blocked" }],
      replyMarkdown: dashscopeFailureReply(error, modelId),
      stop: true,
    };
    await deps.patchCard(first.checklistMessageId, cardFrom(failed, "处理失败", modelId, enableThinking));
    await deps.recordAudit({
      sessionId: first.id,
      chatId: first.chatId,
      openId: first.startedByOpenId,
      toolName: "session.run",
      success: false,
    });
    await deps.appendEvents(first.id, [
      {
        type: "error",
        message: error instanceof Error ? error.message : "unknown",
        at: new Date().toISOString(),
      },
    ]);
    await deps.markSession(first.id, "failed");
  }
}
