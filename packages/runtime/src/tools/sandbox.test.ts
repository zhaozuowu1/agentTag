import { describe, expect, it } from "vitest";
import type { Sandbox } from "@agenttag/sandbox";
import { createSandboxTools, SANDBOX_TOOL_DEFS } from "./sandbox.ts";

const SECRET = "tok_test_not_for_sandbox";

function memorySandbox(files: Map<string, string> = new Map()): Sandbox & { commands: string[] } {
  const commands: string[] = [];
  return {
    id: "mem",
    commands,
    async exec(cmd, cwd) {
      commands.push(`${cwd ?? ""}|${cmd}`);
      return { stdout: `ran:${cmd}`, stderr: "", code: 0 };
    },
    async readFile(path) {
      const value = files.get(path);
      if (value == null) {
        throw new Error(`missing ${path}`);
      }
      return value;
    },
    async writeFile(path, content) {
      files.set(path, content);
    },
    async readFileBytes(path) {
      return new TextEncoder().encode(await this.readFile(path));
    },
    async writeFileBytes(path, content) {
      files.set(path, new TextDecoder().decode(content));
    },
    async destroy() {},
  };
}

describe("createSandboxTools", () => {
  it("exposes bash, read_file, write_file and http_request", () => {
    expect(SANDBOX_TOOL_DEFS.map((def) => def.name)).toEqual([
      "bash",
      "read_file",
      "write_file",
      "http_request",
    ]);
  });

  it("writes and reads workspace files and execs bash inside the sandbox", async () => {
    const files = new Map<string, string>();
    const sandbox = memorySandbox(files);
    const tools = createSandboxTools(sandbox, {
      bundle: { allowedHosts: [], connections: [] },
    });
    await tools.write_file({ path: "note.txt", content: "hi" });
    expect(await tools.read_file({ path: "note.txt" })).toBe("hi");
    const ran = await tools.bash({ command: "echo hi" });
    expect(ran).toContain("echo hi");
    expect(sandbox.commands[0]).toContain("echo hi");
  });

  it("returns a blocked-host tool error and never echoes secrets", async () => {
    const blocked: string[] = [];
    const tools = createSandboxTools(memorySandbox(), {
      bundle: { allowedHosts: ["pypi.org"], connections: [{ id: "conn", allowedHosts: ["api.github.com"] }] },
      secrets: { conn: SECRET },
      onBlockedHost: async (host, message) => {
        blocked.push(`${host}:${message}`);
      },
    });
    const result = await tools.http_request({ url: "https://evil.example/secret" });
    expect(result).toContain("evil.example");
    expect(result).toContain("出站被拦截");
    expect(result).not.toContain(SECRET);
    expect(blocked[0]).toContain("evil.example");
    expect(JSON.stringify(blocked)).not.toContain(SECRET);
  });

  it("injects credentials on the worker side so the sandbox never sees them", async () => {
    const seen: Array<{ url: string; authorization: string | null }> = [];
    const tools = createSandboxTools(memorySandbox(), {
      bundle: {
        allowedHosts: [],
        connections: [{ id: "conn", allowedHosts: ["api.example"] }],
      },
      secrets: { conn: SECRET },
      fetchImpl: async (input, init) => {
        const req = new Request(input, init);
        seen.push({ url: req.url, authorization: req.headers.get("authorization") });
        return new Response("ok-body", { status: 200 });
      },
    });
    const result = await tools.http_request({ url: "https://api.example/v1" });
    expect(seen[0]?.authorization).toBe(`Bearer ${SECRET}`);
    expect(result).toContain("ok-body");
    expect(result).not.toContain(SECRET);
  });

  it("rejects non-HTTP(S) URLs", async () => {
    const tools = createSandboxTools(memorySandbox(), {
      bundle: { allowedHosts: ["127.0.0.1"], connections: [] },
    });
    const result = await tools.http_request({ url: "ftp://127.0.0.1/file" });
    expect(result).toMatch(/仅支持 HTTP\/S/);
  });
});
