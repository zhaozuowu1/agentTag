import type { LlmClient, LlmContent, LlmMessage, LlmResponse } from "./loop.ts";
import { catalogEntry, dashscopeMaxTokens } from "@agenttag/domain";

export interface OpenAiCompatConfig {
  apiKey: string;
  baseURL: string;
  fetch?: typeof fetch;
}

export interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments?: string | Record<string, unknown> };
}

export interface OpenAiChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

export interface OpenAiFunctionTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
}

export interface OpenAiChatResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      role?: string;
      content?: unknown;
      reasoning_content?: string | null;
      tool_calls?: OpenAiToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
  };
}

export function toOpenAiTools(tools: unknown[]): OpenAiFunctionTool[] {
  return tools.map((tool) => {
    if (isOpenAiFunctionTool(tool)) {
      return tool;
    }
    const raw = (tool ?? {}) as {
      name?: string;
      description?: string;
      input_schema?: unknown;
      parameters?: unknown;
    };
    return {
      type: "function",
      function: {
        name: raw.name ?? "unknown",
        description: raw.description ?? raw.name,
        parameters: raw.parameters ?? raw.input_schema ?? { type: "object", properties: {} },
      },
    };
  });
}

export function toOpenAiMessages(system: string, messages: LlmMessage[]): OpenAiChatMessage[] {
  const out: OpenAiChatMessage[] = [];
  if (system) {
    out.push({ role: "system", content: system });
  }
  for (const message of messages) {
    if (typeof message.content === "string") {
      out.push({ role: message.role, content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      const text = message.content
        .filter((part): part is { type: "text"; text: string } => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      const reasoning = message.content
        .filter((part): part is { type: "reasoning"; text: string } => part.type === "reasoning")
        .map((part) => part.text)
        .join("\n");
      const toolUses = message.content.filter(
        (part): part is { type: "tool_use"; id: string; name: string; input: unknown } =>
          part.type === "tool_use",
      );
      const next: OpenAiChatMessage = {
        role: "assistant",
        content: text,
      };
      if (reasoning) {
        next.reasoning_content = reasoning;
      }
      if (toolUses.length > 0) {
        next.tool_calls = toolUses.map((part) => ({
          id: part.id,
          type: "function",
          function: {
            name: part.name,
            arguments: JSON.stringify(part.input ?? {}),
          },
        }));
      }
      out.push(next);
      continue;
    }
    const results = message.content.filter(
      (part): part is { type: "tool_result"; tool_use_id: string; content: string } =>
        part.type === "tool_result",
    );
    const texts = message.content.filter(
      (part): part is { type: "text"; text: string } => part.type === "text",
    );
    for (const result of results) {
      out.push({
        role: "tool",
        tool_call_id: result.tool_use_id,
        content: result.content,
      });
    }
    if (texts.length > 0) {
      out.push({ role: "user", content: texts.map((part) => part.text).join("\n") });
    }
  }
  return out;
}

export function fromOpenAiChatResponse(payload: OpenAiChatResponse): LlmResponse {
  const choice = payload.choices?.[0];
  const message = choice?.message ?? {};
  const content: LlmContent[] = [];
  const reasoning = typeof message.reasoning_content === "string" ? message.reasoning_content : "";
  if (reasoning) {
    content.push({ type: "reasoning", text: reasoning });
  }
  const text = assistantText(message.content);
  if (text) {
    content.push({ type: "text", text });
  }
  const toolCalls = message.tool_calls ?? [];
  for (const call of toolCalls) {
    content.push({
      type: "tool_use",
      id: call.id,
      name: call.function.name,
      input: parseArguments(call.function.arguments),
    });
  }
  const stopReason = toolCalls.length > 0 || choice?.finish_reason === "tool_calls" ? "tool_use" : "end_turn";
  return {
    stop_reason: stopReason,
    content,
    usage: {
      input_tokens: payload.usage?.prompt_tokens ?? 0,
      output_tokens: payload.usage?.completion_tokens ?? 0,
    },
  };
}

export function createOpenAiCompatLlm(config: OpenAiCompatConfig): LlmClient {
  const fetchImpl = config.fetch ?? fetch;
  const endpoint = chatCompletionsUrl(config.baseURL);
  return {
    async create(params) {
      const tools = toOpenAiTools(Array.isArray(params.tools) ? params.tools : []);
      const enableThinking = catalogEntry(params.model)?.thinking === "always" || params.enableThinking === true;
      const body: Record<string, unknown> = {
        model: params.model,
        messages: toOpenAiMessages(params.system, params.messages),
        max_tokens: dashscopeMaxTokens(enableThinking),
        stream: false,
        enable_thinking: enableThinking,
      };
      if (enableThinking) {
        body.thinking = { type: "enabled" };
      }
      if (tools.length > 0) {
        body.tools = tools;
      }
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const raw = redactSecrets(await response.text().catch(() => ""));
        const parsed = parseDashscopeErrorBody(raw);
        throw Object.assign(new Error(`模型接口 ${response.status}`), {
          status: response.status,
          dashscopeCode: parsed.code,
          dashscopeMessage: parsed.message,
        });
      }
      const payload = (await response.json()) as OpenAiChatResponse;
      return fromOpenAiChatResponse(payload);
    },
  };
}

function chatCompletionsUrl(baseURL: string): string {
  return `${baseURL.replace(/\/+$/, "")}/chat/completions`;
}

function isOpenAiFunctionTool(tool: unknown): tool is OpenAiFunctionTool {
  if (!tool || typeof tool !== "object") {
    return false;
  }
  const candidate = tool as { type?: unknown; function?: { name?: unknown } };
  return candidate.type === "function" && typeof candidate.function?.name === "string";
}

function parseArguments(raw: unknown): unknown {
  if (raw == null || raw === "") {
    return {};
  }
  if (typeof raw === "object") {
    return raw;
  }
  if (typeof raw !== "string") {
    return {};
  }
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new Error("工具参数不是合法 JSON");
  }
}

function parseDashscopeErrorBody(raw: string): { code?: string; message?: string } {
  try {
    const payload = JSON.parse(raw) as {
      error?: { message?: unknown; code?: unknown };
      message?: unknown;
      code?: unknown;
    };
    const message =
      typeof payload.error?.message === "string"
        ? payload.error.message
        : typeof payload.message === "string"
          ? payload.message
          : undefined;
    const code =
      typeof payload.error?.code === "string"
        ? payload.error.code
        : typeof payload.code === "string"
          ? payload.code
          : undefined;
    return { code, message };
  } catch {
    return { message: raw || undefined };
  }
}

function redactSecrets(text: string): string {
  return text.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]");
}

function assistantText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part) => {
      if (typeof part === "string") {
        return part;
      }
      if (part && typeof part === "object" && "text" in part && typeof (part as { text?: unknown }).text === "string") {
        return (part as { text: string }).text;
      }
      return "";
    })
    .join("");
}
