import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const SANDBOX_CPU = 1;
export const SANDBOX_MEMORY_BYTES = 2 * 1024 * 1024 * 1024;
export const SANDBOX_WALL_MS = 10 * 60 * 1000;
export const DEFAULT_SANDBOX_IMAGE = "agenttag-sandbox:local";

const WORKSPACE = "/workspace";
const DENIED_ENV =
  /^(DASHSCOPE_API_KEY|FEISHU_APP_SECRET|FEISHU_APP_ID|FEISHU_ENCRYPT_KEY|FEISHU_VERIFICATION_TOKEN|ADMIN_TOKEN|CREDENTIAL_MASTER_KEY|ANTHROPIC_API_KEY|DATABASE_URL|REDIS_URL)$|[A-Z0-9_]*(SECRET|PASSWORD|API_KEY|MASTER_KEY)[A-Z0-9_]*$/i;

export interface Sandbox {
  id: string;
  exec(cmd: string, cwd?: string): Promise<{ stdout: string; stderr: string; code: number }>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readFileBytes(path: string): Promise<Uint8Array>;
  writeFileBytes(path: string, content: Uint8Array): Promise<void>;
  destroy(): Promise<void>;
}

export interface CreateDockerSandboxOptions {
  sessionId: string;
  image?: string;
  env?: Record<string, string>;
  httpProxyUrl?: string;
  network?: string;
  extraHosts?: string[];
}

export async function createDockerSandbox(opts: CreateDockerSandboxOptions): Promise<Sandbox> {
  const workDir = await mkdtemp(join(tmpdir(), "agenttag-sandbox-"));
  await chmod(workDir, 0o777);
  const name = sandboxName(opts.sessionId);
  const image = opts.image?.trim() || DEFAULT_SANDBOX_IMAGE;
  const env = filteredEnv({
    ...(opts.httpProxyUrl
      ? {
          HTTP_PROXY: opts.httpProxyUrl,
          HTTPS_PROXY: opts.httpProxyUrl,
          http_proxy: opts.httpProxyUrl,
          https_proxy: opts.httpProxyUrl,
          NO_PROXY: "localhost,127.0.0.1",
        }
      : {}),
    ...(opts.env ?? {}),
  });

  const args = [
    "run",
    "-d",
    "--name",
    name,
    "--cpus",
    String(SANDBOX_CPU),
    "--memory",
    String(SANDBOX_MEMORY_BYTES),
    "--pids-limit",
    "256",
    "--security-opt",
    "no-new-privileges",
    "--cap-drop",
    "ALL",
    "--read-only",
    "--tmpfs",
    "/tmp:rw,exec,nosuid,size=256m",
    "-v",
    `${workDir}:${WORKSPACE}:rw`,
    "-w",
    WORKSPACE,
    "-u",
    "1000:1000",
    "--label",
    `agenttag.session=${opts.sessionId}`,
    "--add-host",
    "host.docker.internal:host-gateway",
  ];
  if (opts.network) {
    args.push("--network", opts.network);
  }
  for (const host of opts.extraHosts ?? []) {
    args.push("--add-host", host);
  }
  for (const [key, value] of Object.entries(env)) {
    args.push("-e", `${key}=${value}`);
  }
  args.push(image, "sleep", String(Math.ceil(SANDBOX_WALL_MS / 1000)));

  let containerId = "";
  try {
    const started = await execFileAsync("docker", args, { encoding: "utf8" });
    containerId = started.stdout.trim();
    if (!containerId) {
      throw new Error("docker run 未返回容器 ID");
    }
  } catch (error) {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    throw wrapDockerError(error);
  }

  let destroyed = false;
  const wallTimer = setTimeout(() => {
    void destroy();
  }, SANDBOX_WALL_MS);
  wallTimer.unref?.();

  async function destroy(): Promise<void> {
    if (destroyed) {
      return;
    }
    destroyed = true;
    clearTimeout(wallTimer);
    await execFileAsync("docker", ["rm", "-f", containerId]).catch(() => undefined);
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }

  function assertAlive(): void {
    if (destroyed) {
      throw new Error("沙箱已销毁");
    }
  }

  return {
    id: containerId,
    async exec(cmd, cwd) {
      assertAlive();
      const workdir = resolveContainerCwd(cwd);
      try {
        const result = await execFileAsync("docker", ["exec", "-w", workdir, containerId, "sh", "-c", cmd], {
          encoding: "utf8",
          timeout: 60_000,
          maxBuffer: 8 * 1024 * 1024,
        });
        return { stdout: result.stdout, stderr: result.stderr, code: 0 };
      } catch (error) {
        if (destroyed) {
          throw new Error("沙箱已销毁");
        }
        return execResultFromError(error);
      }
    },
    async readFile(path) {
      assertAlive();
      return readFile(hostPath(workDir, path), "utf8");
    },
    async writeFile(path, content) {
      assertAlive();
      const dest = hostPath(workDir, path);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, content, "utf8");
    },
    async readFileBytes(path) {
      assertAlive();
      const buf = await readFile(hostPath(workDir, path));
      return new Uint8Array(buf);
    },
    async writeFileBytes(path, content) {
      assertAlive();
      const dest = hostPath(workDir, path);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, content);
    },
    destroy,
  };
}

export async function ensureSandboxImage(opts: { image?: string; contextDir?: string } = {}): Promise<string> {
  const image = opts.image?.trim() || DEFAULT_SANDBOX_IMAGE;
  try {
    await execFileAsync("docker", ["image", "inspect", image], { encoding: "utf8" });
    return image;
  } catch {
    const contextDir =
      opts.contextDir ??
      resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
    await execFileAsync("docker", ["build", "-f", "Dockerfile.sandbox", "-t", image, contextDir], {
      encoding: "utf8",
      timeout: 10 * 60 * 1000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return image;
  }
}

function sandboxName(sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 40) || "session";
  return `agt-${safe}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function filteredEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key || DENIED_ENV.test(key)) {
      continue;
    }
    out[key] = value;
  }
  return out;
}

function resolveWorkspacePath(rel: string): string {
  const trimmed = rel.trim();
  if (!trimmed) {
    throw new Error("路径越界：只能访问沙箱 workspace");
  }
  const abs = posix.resolve(WORKSPACE, trimmed);
  if (abs !== WORKSPACE && !abs.startsWith(`${WORKSPACE}/`)) {
    throw new Error("路径越界：只能访问沙箱 workspace");
  }
  return abs;
}

function hostPath(workDir: string, rel: string): string {
  const containerPath = resolveWorkspacePath(rel);
  const relative = containerPath === WORKSPACE ? "" : containerPath.slice(WORKSPACE.length + 1);
  const dest = relative ? resolve(workDir, relative) : workDir;
  const root = resolve(workDir);
  if (dest !== root && !dest.startsWith(`${root}/`)) {
    throw new Error("路径越界：只能访问沙箱 workspace");
  }
  return dest;
}

function resolveContainerCwd(cwd?: string): string {
  if (!cwd) {
    return WORKSPACE;
  }
  return resolveWorkspacePath(cwd);
}

function execResultFromError(error: unknown): { stdout: string; stderr: string; code: number } {
  if (error && typeof error === "object") {
    const err = error as {
      status?: number | null;
      code?: number | string | null;
      stdout?: string;
      stderr?: string;
      killed?: boolean;
    };
    if (err.killed) {
      throw new Error("沙箱命令超时");
    }
    const status = typeof err.status === "number" ? err.status : typeof err.code === "number" ? err.code : null;
    if (status != null) {
      return { stdout: err.stdout ?? "", stderr: err.stderr ?? "", code: status };
    }
  }
  throw wrapDockerError(error);
}

function wrapDockerError(error: unknown): Error {
  const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  if (code === "ENOENT" || /Cannot connect to the Docker daemon/i.test(message)) {
    return new Error("无法连接 Docker，沙箱不可用");
  }
  return error instanceof Error ? error : new Error(message);
}
