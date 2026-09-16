import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  SANDBOX_CPU,
  SANDBOX_MEMORY_BYTES,
  SANDBOX_WALL_MS,
  createDockerSandbox,
  resolveSandboxImage,
  type Sandbox,
} from "./runner.ts";

const execFileAsync = promisify(execFile);

const SECRET_ENV = {
  DASHSCOPE_API_KEY: "sk-dashscope-must-not-leak",
  FEISHU_APP_SECRET: "feishu-secret-must-not-leak",
  CREDENTIAL_MASTER_KEY: "cred-master-must-not-leak",
};

async function dockerJson(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync("docker", args, { encoding: "utf8" });
  return JSON.parse(stdout) as unknown;
}

describe("createDockerSandbox", () => {
  const boxes: Sandbox[] = [];

  afterEach(async () => {
    await Promise.all(
      boxes.splice(0).map(async (box) => {
        await box.destroy().catch(() => undefined);
      }),
    );
  });

  it("creates one ephemeral container per session, then exec/read/write work inside the workspace", async () => {
    const sandbox = await createDockerSandbox({
      sessionId: "sess_chart_1",
      image: "alpine:3.20",
    });
    boxes.push(sandbox);

    expect(sandbox.id.length).toBeGreaterThan(0);

    await sandbox.writeFile("hello.txt", "from-host");
    const readBack = await sandbox.readFile("hello.txt");
    expect(readBack).toBe("from-host");

    const listed = await sandbox.exec("ls -1 /workspace");
    expect(listed.code).toBe(0);
    expect(listed.stdout).toContain("hello.txt");

    const echoed = await sandbox.exec("cat hello.txt", "/workspace");
    expect(echoed.code).toBe(0);
    expect(echoed.stdout.trim()).toBe("from-host");
  });

  it("caps CPU, memory and wall clock, and never mounts the docker socket or runs privileged", async () => {
    const sandbox = await createDockerSandbox({
      sessionId: "sess_limits_1",
      image: "alpine:3.20",
    });
    boxes.push(sandbox);

    const inspect = (await dockerJson(["inspect", sandbox.id])) as Array<{
      HostConfig?: {
        NanoCpus?: number;
        Memory?: number;
        Privileged?: boolean;
        Binds?: string[] | null;
        CapAdd?: string[] | null;
        Runtime?: string;
      };
      Config?: { StopTimeout?: number | null };
    }>;
    const host = inspect[0]?.HostConfig;
    expect(host?.Privileged).toBe(false);
    expect(host?.NanoCpus).toBe(SANDBOX_CPU * 1_000_000_000);
    expect(host?.Memory).toBe(SANDBOX_MEMORY_BYTES);
    expect(JSON.stringify(host?.Binds ?? [])).not.toMatch(/docker\.sock/);
    expect(SANDBOX_WALL_MS).toBe(10 * 60 * 1000);
  });

  it("does not copy host credentials into the container environment", async () => {
    const sandbox = await createDockerSandbox({
      sessionId: "sess_nosecret_1",
      image: "alpine:3.20",
      env: {
        HTTP_PROXY: "http://host.docker.internal:18080",
        ...SECRET_ENV,
      },
    });
    boxes.push(sandbox);

    const inspect = (await dockerJson(["inspect", sandbox.id])) as Array<{
      Config?: { Env?: string[] };
    }>;
    const env = inspect[0]?.Config?.Env ?? [];
    const blob = env.join("\n");
    expect(blob).toContain("HTTP_PROXY=http://host.docker.internal:18080");
    expect(blob).not.toContain("sk-dashscope-must-not-leak");
    expect(blob).not.toContain("feishu-secret-must-not-leak");
    expect(blob).not.toContain("cred-master-must-not-leak");
    expect(blob).not.toContain("DASHSCOPE_API_KEY");
    expect(blob).not.toContain("FEISHU_APP_SECRET");
    expect(blob).not.toContain("CREDENTIAL_MASTER_KEY");

    const fromInside = await sandbox.exec("printenv");
    expect(fromInside.stdout).not.toContain("sk-dashscope-must-not-leak");
    expect(fromInside.stdout).toContain("HTTP_PROXY");
  });

  it("rejects path traversal outside the workspace", async () => {
    const sandbox = await createDockerSandbox({
      sessionId: "sess_jail_1",
      image: "alpine:3.20",
    });
    boxes.push(sandbox);

    await expect(sandbox.readFile("../etc/passwd")).rejects.toThrow(/越界|workspace/i);
    await expect(sandbox.writeFile("../../etc/evil", "nope")).rejects.toThrow(/越界|workspace/i);
  });

  it("destroy removes the container and the host workspace so a later exec fails", async () => {
    const sandbox = await createDockerSandbox({
      sessionId: "sess_destroy_1",
      image: "alpine:3.20",
    });
    await sandbox.writeFile("gone.txt", "temp");
    const id = sandbox.id;
    await sandbox.destroy();

    await expect(execFileAsync("docker", ["inspect", id])).rejects.toThrow();
    await expect(sandbox.exec("echo still-here")).rejects.toThrow();
  });
});

describe("resolveSandboxImage", () => {
  it("falls back to python:3.12-slim when the matplotlib image is not built", async () => {
    const image = await resolveSandboxImage("agenttag-sandbox:does-not-exist");
    expect(image).toBe("python:3.12-slim");
  });
});
