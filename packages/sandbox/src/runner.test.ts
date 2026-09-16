import { execFile, execFileSync } from "node:child_process";
import http from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

function dockerDaemonUp(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeDocker = dockerDaemonUp() ? describe : describe.skip;

const SECRET_ENV = {
  DASHSCOPE_API_KEY: "sk-dashscope-must-not-leak",
  FEISHU_APP_SECRET: "feishu-secret-must-not-leak",
  CREDENTIAL_MASTER_KEY: "cred-master-must-not-leak",
};

async function dockerJson(args: string[]): Promise<unknown> {
  const { stdout } = await execFileAsync("docker", args, { encoding: "utf8" });
  return JSON.parse(stdout) as unknown;
}

describeDocker("createDockerSandbox", () => {
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

  it("defaults to --network none so unset HTTP_PROXY or raw sockets cannot egress", async () => {
    const hits: string[] = [];
    const upstream = http.createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("leaked");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "0.0.0.0", resolve));
    const addr = upstream.address();
    if (!addr || typeof addr === "string") {
      upstream.close();
      throw new Error("upstream address missing");
    }
    const closeUpstream = () =>
      new Promise<void>((resolve, reject) => {
        upstream.close((err) => (err ? reject(err) : resolve()));
      });

    try {
      const sandbox = await createDockerSandbox({
        sessionId: "sess_nonet_1",
        image: "alpine:3.20",
        httpProxyUrl: "http://host.docker.internal:18080",
      });
      boxes.push(sandbox);

      const inspect = (await dockerJson(["inspect", sandbox.id])) as Array<{
        HostConfig?: { NetworkMode?: string; ExtraHosts?: string[] | null };
      }>;
      expect(inspect[0]?.HostConfig?.NetworkMode).toBe("none");

      const proxyEnv = await sandbox.exec("printenv HTTP_PROXY HTTPS_PROXY http_proxy https_proxy || true");
      expect(proxyEnv.stdout.trim()).toBe("");

      const publicHit = await sandbox.exec("wget -qO- -T 2 http://1.1.1.1/");
      expect(publicHit.code).not.toBe(0);

      const hostHit = await sandbox.exec(`wget -qO- -T 2 http://172.17.0.1:${addr.port}/secret`);
      expect(hostHit.code).not.toBe(0);

      const unsetProxy = await sandbox.exec(
        `env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy wget -qO- -T 2 http://172.17.0.1:${addr.port}/bypass`,
      );
      expect(unsetProxy.code).not.toBe(0);

      const viaProxy = await sandbox.exec(
        `wget -qO- -T 2 -Y on -P /tmp http://host.docker.internal:18080/ 2>/dev/null; wget -qO- -T 2 http://172.17.0.1:${addr.port}/via-proxy`,
      );
      expect(viaProxy.code).not.toBe(0);
      expect(hits).toEqual([]);
    } finally {
      await closeUpstream();
    }
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

  it("does not follow workDir symlinks that escape the sandbox on read or write", async () => {
    const victimDir = await mkdtemp(join(tmpdir(), "agenttag-outside-"));
    const victimFile = join(victimDir, "secret.txt");
    await writeFile(victimFile, "original-outside", "utf8");

    try {
      const sandbox = await createDockerSandbox({
        sessionId: "sess_symlink_jail_1",
        image: "alpine:3.20",
      });
      boxes.push(sandbox);

      await sandbox.writeFile("ok.txt", "inside");
      expect(await sandbox.readFile("ok.txt")).toBe("inside");

      const absLink = await sandbox.exec("ln -s /etc/passwd abs-leak");
      expect(absLink.code).toBe(0);
      const relLink = await sandbox.exec("ln -s ../../../etc/passwd rel-leak");
      expect(relLink.code).toBe(0);
      const fileLink = await sandbox.exec(`ln -s '${victimFile}' file-leak`);
      expect(fileLink.code).toBe(0);
      const dirLink = await sandbox.exec(`ln -s '${victimDir}' nested`);
      expect(dirLink.code).toBe(0);

      await expect(sandbox.readFile("abs-leak")).rejects.toThrow(/越界|workspace/i);
      await expect(sandbox.readFile("rel-leak")).rejects.toThrow(/越界|workspace/i);
      await expect(sandbox.readFile("file-leak")).rejects.toThrow(/越界|workspace/i);
      await expect(sandbox.readFileBytes("file-leak")).rejects.toThrow(/越界|workspace/i);

      await expect(sandbox.writeFile("file-leak", "pwned")).rejects.toThrow(/越界|workspace/i);
      await expect(sandbox.writeFileBytes("file-leak", new TextEncoder().encode("pwned"))).rejects.toThrow(
        /越界|workspace/i,
      );
      await expect(sandbox.writeFile("nested/pwned.txt", "pwned")).rejects.toThrow(/越界|workspace/i);

      expect(await readFile(victimFile, "utf8")).toBe("original-outside");
      await expect(readFile(join(victimDir, "pwned.txt"), "utf8")).rejects.toThrow(/ENOENT/);

      await sandbox.writeFile("dir/sub/ok.txt", "nested-ok");
      expect(await sandbox.readFile("dir/sub/ok.txt")).toBe("nested-ok");
      await sandbox.writeFile("real.txt", "inside-real");
      const alias = await sandbox.exec("ln -s real.txt alias.txt");
      expect(alias.code).toBe(0);
      expect(await sandbox.readFile("alias.txt")).toBe("inside-real");
    } finally {
      await rm(victimDir, { recursive: true, force: true });
    }
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
  it.skipIf(!dockerDaemonUp())("returns a locally available image without pulling", async () => {
    const image = await resolveSandboxImage("python:3.12-slim");
    expect(image).toBe("python:3.12-slim");
  });

  it("pulls the preferred image when it is missing locally", async () => {
    const calls: string[][] = [];
    const dockerExec = async (_command: string, args: readonly string[]) => {
      calls.push([...args]);
      if (args[0] === "image" && args[1] === "inspect") {
        throw new Error("missing locally");
      }
      if (args[0] === "pull" && args[1] === "python:3.12-slim") {
        return { stdout: "pulled\n", stderr: "" };
      }
      throw new Error(`unexpected docker ${args.join(" ")}`);
    };

    const image = await resolveSandboxImage("python:3.12-slim", dockerExec);
    expect(image).toBe("python:3.12-slim");
    expect(calls).toEqual([
      ["image", "inspect", "python:3.12-slim"],
      ["pull", "python:3.12-slim"],
    ]);
  });

  it("falls back to pulling python:3.12-slim when preferred images are absent", async () => {
    const pulled: string[] = [];
    const dockerExec = async (_command: string, args: readonly string[]) => {
      if (args[0] === "pull") {
        pulled.push(args[1] ?? "");
        if (args[1] === "python:3.12-slim") {
          return { stdout: "pulled\n", stderr: "" };
        }
        throw new Error("not on registry");
      }
      throw new Error("missing locally");
    };

    const image = await resolveSandboxImage("agenttag-sandbox:does-not-exist", dockerExec);
    expect(image).toBe("python:3.12-slim");
    expect(pulled).toContain("agenttag-sandbox:does-not-exist");
    expect(pulled.at(-1)).toBe("python:3.12-slim");
  });
});
