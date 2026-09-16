import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { startAgentProxy, type AgentProxy } from "./server.ts";
import type { AccessBundle } from "./policy.ts";

const SECRET = "tok_test_not_for_sandbox";

const bundle: AccessBundle = {
  allowedHosts: ["127.0.0.1"],
  connections: [{ id: "conn_upstream", allowedHosts: ["inject.example"] }],
};

interface UpstreamHit {
  url: string;
  authorization: string | undefined;
  host: string | undefined;
}

async function listenUpstream(): Promise<{
  port: number;
  hits: UpstreamHit[];
  close: () => Promise<void>;
}> {
  const hits: UpstreamHit[] = [];
  const server = http.createServer((req, res) => {
    hits.push({
      url: req.url ?? "",
      authorization: headerValue(req.headers.authorization),
      host: headerValue(req.headers.host),
    });
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("upstream-ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") {
    throw new Error("upstream address missing");
  }
  return {
    port: addr.port,
    hits,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function proxyRequest(
  proxyPort: number,
  targetUrl: string,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string }> {
  const target = new URL(targetUrl);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: proxyPort,
        method: "GET",
        path: targetUrl,
        headers: { Host: target.host, ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk as Buffer));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function proxyConnect(proxyPort: number, authority: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port: proxyPort,
      method: "CONNECT",
      path: authority,
    });
    req.on("connect", (res, socket, head) => {
      const status = res.statusCode ?? 0;
      const prefix = head.length > 0 ? Buffer.from(head).toString("utf8") : "";
      if (status === 200) {
        socket.destroy();
        resolve({ status, body: prefix });
        return;
      }
      if (socket.readableEnded || prefix.includes("evil.") || prefix.includes("出站被拦截")) {
        socket.destroy();
        resolve({ status, body: prefix });
        return;
      }
      const chunks: Buffer[] = [Buffer.from(prefix)];
      socket.on("data", (chunk) => chunks.push(chunk as Buffer));
      socket.on("end", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
      socket.on("error", () => resolve({ status, body: Buffer.concat(chunks).toString("utf8") }));
      socket.resume();
    });
    req.on("response", (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk) => chunks.push(chunk as Buffer));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
      );
    });
    req.on("error", reject);
    req.end();
  });
}

describe("startAgentProxy", () => {
  const proxies: AgentProxy[] = [];
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    await Promise.all(proxies.splice(0).map((proxy) => proxy.close()));
    await Promise.all(closers.splice(0).map((close) => close()));
  });

  it("forwards allowlisted HTTP without injecting credentials", async () => {
    const upstream = await listenUpstream();
    closers.push(upstream.close);
    const proxy = await startAgentProxy({ bundle, secrets: { conn_upstream: SECRET }, port: 0 });
    proxies.push(proxy);

    const result = await proxyRequest(proxy.port, `http://127.0.0.1:${upstream.port}/health`);
    expect(result.status).toBe(200);
    expect(result.body).toBe("upstream-ok");
    expect(upstream.hits[0]?.authorization).toBeUndefined();
    expect(result.body).not.toContain(SECRET);
  });

  it("injects a bearer token for connection hosts and never echoes the secret", async () => {
    const upstream = await listenUpstream();
    closers.push(upstream.close);
    const injectBundle: AccessBundle = {
      allowedHosts: [],
      connections: [{ id: "conn_upstream", allowedHosts: ["127.0.0.1"] }],
    };
    const proxy = await startAgentProxy({
      bundle: injectBundle,
      secrets: { conn_upstream: SECRET },
      port: 0,
    });
    proxies.push(proxy);

    const result = await proxyRequest(
      proxy.port,
      `http://127.0.0.1:${upstream.port}/secure`,
      { Authorization: "Bearer sandbox-should-be-stripped" },
    );
    expect(result.status).toBe(200);
    expect(upstream.hits[0]?.authorization).toBe(`Bearer ${SECRET}`);
    expect(result.body).not.toContain(SECRET);
    expect(result.body).not.toContain("sandbox-should-be-stripped");
  });

  it("blocks unknown hosts with a tool-facing message that omits secrets", async () => {
    const proxy = await startAgentProxy({ bundle, secrets: { conn_upstream: SECRET }, port: 0 });
    proxies.push(proxy);

    const result = await proxyRequest(proxy.port, "http://evil.example/secret");
    expect(result.status).toBe(403);
    expect(result.body).toContain("evil.example");
    expect(result.body).toContain("出站被拦截");
    expect(result.body).not.toContain(SECRET);
    expect(result.body).not.toContain("tok_");
  });

  it("rejects CONNECT to a blocked host and allows CONNECT to an allowlisted host", async () => {
    const tcp = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) => tcp.listen(0, "127.0.0.1", resolve));
    closers.push(
      () =>
        new Promise((resolve, reject) => {
          tcp.close((err) => (err ? reject(err) : resolve()));
        }),
    );
    const tcpAddr = tcp.address();
    if (!tcpAddr || typeof tcpAddr === "string") {
      throw new Error("tcp address missing");
    }

    const proxy = await startAgentProxy({ bundle, secrets: { conn_upstream: SECRET }, port: 0 });
    proxies.push(proxy);

    const blocked = await proxyConnect(proxy.port, "evil.example:443");
    expect(blocked.status).toBe(403);
    expect(blocked.body).toContain("evil.example");
    expect(blocked.body).not.toContain(SECRET);

    const allowed = await proxyConnect(proxy.port, `127.0.0.1:${tcpAddr.port}`);
    expect(allowed.status).toBe(200);
  });

  it("rejects non-HTTP(S) absolute URLs", async () => {
    const proxy = await startAgentProxy({ bundle, port: 0 });
    proxies.push(proxy);
    const result = await proxyRequest(proxy.port, "ftp://127.0.0.1/file");
    expect(result.status).toBe(403);
    expect(result.body).toMatch(/HTTP\/S|HTTP\/S出站|仅支持/);
  });
});
