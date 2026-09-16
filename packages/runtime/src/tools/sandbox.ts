import type { AccessBundle } from "@agenttag/proxy";
import { blockedHostMessage, decide } from "@agenttag/proxy";
import type { Sandbox } from "@agenttag/sandbox";

export const SANDBOX_TOOL_DEFS = [
  {
    name: "bash",
    description: "在隔离沙箱里执行 shell 命令。工作目录是 /workspace。不要尝试读取宿主机密钥。",
    input_schema: {
      type: "object",
      properties: { command: { type: "string" }, cwd: { type: "string" } },
      required: ["command"],
    },
  },
  {
    name: "read_file",
    description: "读取沙箱工作区内的文本文件。",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
  },
  {
    name: "write_file",
    description: "写入沙箱工作区内的文本文件。",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
  },
  {
    name: "http_request",
    description:
      "经 Agent Proxy 发 HTTP/S 请求。未在允许名单的 host 会被拦截。不要把密钥写进 URL 或 header。",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string" },
        method: { type: "string" },
        body: { type: "string" },
      },
      required: ["url"],
    },
  },
] as const;

export function createSandboxTools(
  sandbox: Sandbox,
  opts: {
    bundle: AccessBundle;
    secrets?: Record<string, string>;
    fetchImpl?: typeof fetch;
    onBlockedHost?: (host: string, message: string) => Promise<void>;
  },
): {
  bash: (input: unknown) => Promise<string>;
  read_file: (input: unknown) => Promise<string>;
  write_file: (input: unknown) => Promise<string>;
  http_request: (input: unknown) => Promise<string>;
} {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const secrets = opts.secrets ?? {};

  return {
    bash: async (input) => {
      const body = (input ?? {}) as { command?: string; cwd?: string };
      const result = await sandbox.exec(body.command ?? "", body.cwd);
      return truncate(`exit=${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    },
    read_file: async (input) => {
      const body = (input ?? {}) as { path?: string };
      return truncate(await sandbox.readFile(body.path ?? ""));
    },
    write_file: async (input) => {
      const body = (input ?? {}) as { path?: string; content?: string };
      await sandbox.writeFile(body.path ?? "", body.content ?? "");
      return JSON.stringify({ ok: true, path: body.path ?? "" });
    },
    http_request: async (input) => {
      const body = (input ?? {}) as { url?: string; method?: string; body?: string };
      let url: URL;
      try {
        url = new URL(body.url ?? "");
      } catch {
        return "仅支持 HTTP/S 出站";
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return "仅支持 HTTP/S 出站";
      }
      const decision = decide(url.hostname, opts.bundle);
      if (decision.action === "block") {
        const message = blockedHostMessage(url.hostname);
        await opts.onBlockedHost?.(url.hostname, message);
        return message;
      }
      const headers: Record<string, string> = {};
      if (decision.action === "inject") {
        const token = secrets[decision.connectionId];
        if (!token) {
          return "出站连接未配置凭证";
        }
        headers.Authorization = `Bearer ${token}`;
      }
      const response = await fetchImpl(url, {
        method: (body.method ?? "GET").toUpperCase(),
        headers,
        body: body.body,
      });
      const text = await response.text();
      return redactSecrets(truncate(`status=${response.status}\n${text}`), Object.values(secrets));
    },
  };
}

function truncate(text: string, max = 24_000): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max)}\n…(truncated)`;
}

function redactSecrets(text: string, secrets: string[]): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) {
      out = out.split(secret).join("[redacted]");
    }
  }
  return out;
}
