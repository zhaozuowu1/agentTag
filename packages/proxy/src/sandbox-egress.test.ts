import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createDockerSandbox, type Sandbox } from "@agenttag/sandbox";
import { startAgentProxy, type AgentProxy } from "./server.ts";

const SECRET = "tok_test_not_for_sandbox";

describe("sandbox HTTP_PROXY egress", () => {
  const boxes: Sandbox[] = [];
  const proxies: AgentProxy[] = [];
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(boxes.splice(0).map((box) => box.destroy().catch(() => undefined)));
    await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  it("lets the sandbox reach an allowlisted host via the proxy and blocks the rest without leaking secrets", async () => {
    const hits: string[] = [];
    const upstream = http.createServer((req, res) => {
      hits.push(req.url ?? "");
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("from-upstream");
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
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

    const env = await sandbox.exec("printenv HTTP_PROXY");
    expect(env.stdout).toContain(`host.docker.internal:${proxy.port}`);
    expect(env.stdout).not.toContain(SECRET);

    const allowed = await sandbox.exec(`wget -qO- http://127.0.0.1:${addr.port}/health`);
    expect(allowed.code).toBe(0);
    expect(allowed.stdout).toContain("from-upstream");
    expect(hits).toEqual(["/health"]);

    const blocked = await sandbox.exec("wget -qO- http://evil.example/secret");
    expect(blocked.code).not.toBe(0);
    const blob = `${blocked.stdout}\n${blocked.stderr}`;
    expect(blob).toMatch(/evil\.example|403|outbound|拦截/i);
    expect(blob).not.toContain(SECRET);
  });
});
