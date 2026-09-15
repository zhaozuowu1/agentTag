import type { AgentTurnResult, TranscriptEvent } from "@agenttag/domain";

export type LlmContent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; tool_use_id: string; content: string };

export interface LlmMessage {
  role: "user" | "assistant";
  content: string | LlmContent[];
}

export interface LlmResponse {
  stop_reason: string;
  content: LlmContent[];
  usage: { input_tokens: number; output_tokens: number };
}

export interface LlmClient {
  create(params: {
    model: string;
    system: string;
    messages: LlmMessage[];
    tools: unknown[];
    enableThinking?: boolean;
  }): Promise<LlmResponse>;
}

export interface RunAgentLoopInput {
  llm: LlmClient;
  model: string;
  system: string;
  messages: LlmMessage[];
  tools: Record<string, (input: unknown) => Promise<string>>;
  toolDefs?: unknown[];
  initial: AgentTurnResult;
  onTurn: (result: AgentTurnResult) => Promise<void>;
  onUsage?: (usage: { input_tokens: number; output_tokens: number }) => Promise<void>;
  onToolError?: (error: { name: string; message: string }) => Promise<void>;
  maxTurns?: number;
  enableThinking?: boolean;
}

export function reduceToolResult(prev: AgentTurnResult, event: TranscriptEvent): AgentTurnResult {
  if (event.type !== "tool_result") {
    return prev;
  }
  const checklist = prev.checklist.map((item) => {
    if (item.status === "doing" || item.id === event.name || item.id === "history") {
      return { ...item, status: "done" as const };
    }
    return item;
  });
  return {
    ...prev,
    checklist,
    replyMarkdown: prev.replyMarkdown,
    stop: false,
  };
}

export async function runAgentLoop(input: RunAgentLoopInput): Promise<AgentTurnResult> {
  let result = input.initial;
  const messages = [...input.messages];
  const maxTurns = input.maxTurns ?? 8;

  for (let turn = 0; turn < maxTurns; turn += 1) {
    const response = await input.llm.create({
      model: input.model,
      system: input.system,
      messages,
      tools: input.toolDefs ?? defaultToolDefs(Object.keys(input.tools)),
      enableThinking: input.enableThinking,
    });
    await input.onUsage?.(response.usage);

    const texts = response.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();
    const reasoning = response.content
      .filter((part): part is { type: "reasoning"; text: string } => part.type === "reasoning")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (texts) {
      result = { ...result, replyMarkdown: texts };
    }
    if (reasoning) {
      result = { ...result, reasoning };
    }

    const toolUses = response.content.filter(
      (part): part is { type: "tool_use"; id: string; name: string; input: unknown } =>
        part.type === "tool_use",
    );

    if (response.stop_reason === "end_turn" || toolUses.length === 0) {
      result = {
        ...result,
        stop: true,
        checklist: result.checklist.map((item) =>
          item.status === "doing" ? { ...item, status: "done" as const } : item,
        ),
      };
      await input.onTurn(result);
      return result;
    }

    result = {
      ...result,
      checklist: result.checklist.map((item, index) =>
        index === 0 || item.status === "todo"
          ? { ...item, status: "doing" as const }
          : item,
      ),
    };
    await input.onTurn(result);

    messages.push({ role: "assistant", content: response.content });
    const toolResults: LlmContent[] = [];
    for (const use of toolUses) {
      const impl = input.tools[use.name];
      let content: string;
      try {
        content = impl ? await impl(use.input) : `未知工具：${use.name}`;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await input.onToolError?.({ name: use.name, message });
        throw error;
      }
      const event: TranscriptEvent = {
        type: "tool_result",
        name: use.name,
        toolUseId: use.id,
        content,
        at: new Date().toISOString(),
      };
      result = reduceToolResult(result, event);
      toolResults.push({ type: "tool_result", tool_use_id: use.id, content });
    }
    await input.onTurn(result);
    messages.push({ role: "user", content: toolResults });
  }

  return { ...result, stop: true };
}

export function messagesFromTranscript(
  events: Array<{ type: string; text?: string; reasoning?: string }>,
): LlmMessage[] {
  const messages: LlmMessage[] = [];
  for (const event of events) {
    if (event.type === "user" && event.text) {
      messages.push({ role: "user", content: event.text });
    }
    if (event.type === "assistant" && event.text) {
      if (event.reasoning) {
        messages.push({
          role: "assistant",
          content: [
            { type: "reasoning", text: event.reasoning },
            { type: "text", text: event.text },
          ],
        });
      } else {
        messages.push({ role: "assistant", content: event.text });
      }
    }
  }
  return messages;
}

function defaultToolDefs(names: string[]): unknown[] {
  return names.map((name) => ({
    name,
    description: name,
    input_schema: { type: "object", properties: {} },
  }));
}
