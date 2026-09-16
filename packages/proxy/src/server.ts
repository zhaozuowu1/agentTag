import http from "node:http";
import net from "node:net";
import { blockedHostMessage, decide, normalizeHost, type AccessBundle } from "./policy.ts";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "proxy-connection",
  "authorization",
]);

export interface StartAgentProxyOptions {
  bundle: AccessBundle;
  secrets?: Record<string, string>;
  host?: string;
  port?: number;
}

export interface AgentProxy {
  url: string;
  host: string;
  port: number;
  close(): Promise<void>;
}

export async function startAgentProxy(opts: StartAgentProxyOptions): Promise<AgentProxy> {
  const secrets = opts.secrets ?? {};
  const listenHost = opts.host ?? "127.0.0.1";
  const bundle = opts.bundle;

  const server = http.createServer((req, res) => {
    void handleHttp(req, res, bundle, secrets);
  });

  server.on("connect", (req, clientSocket, head) => {
    handleConnect(req, clientSocket as net.Socket, Buffer.from(head), bundle);
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(opts.port ?? 0, listenHost, () => resolve());
    server.on("error", reject);
  });

  const addr = server.address();
  if (!addr || typeof addr === "string") {
    server.close();
    throw new Error("代理未监听到端口");
  }

  return {
    url: `http://${listenHost}:${addr.port}`,
    host: listenHost,
    port: addr.port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

async function handleHttp(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  bundle: AccessBundle,
  secrets: Record<string, string>,
): Promise<void> {
  try {
    const target = parseProxyTarget(req);
    if (!target.ok) {
      writePlain(res, 403, target.message);
      return;
    }
    const decision = decide(target.url.hostname, bundle);
    if (decision.action === "block") {
      writePlain(res, 403, blockedHostMessage(target.url.hostname));
      return;
    }

    const headers = forwardedHeaders(req);
    if (decision.action === "inject") {
      const token = secrets[decision.connectionId];
      if (!token) {
        writePlain(res, 502, "出站连接未配置凭证");
        return;
      }
      headers.authorization = `Bearer ${token}`;
    }

    const upstream = await fetch(target.url, {
      method: req.method,
      headers,
      body: await readBody(req),
      redirect: "manual",
    });
    const outHeaders: http.OutgoingHttpHeaders = {};
    upstream.headers.forEach((value, key) => {
      if (!HOP_BY_HOP.has(key.toLowerCase())) {
        outHeaders[key] = value;
      }
    });
    res.writeHead(upstream.status, outHeaders);
    const buf = Buffer.from(await upstream.arrayBuffer());
    res.end(buf);
  } catch {
    writePlain(res, 502, "出站转发失败");
  }
}

function handleConnect(
  req: http.IncomingMessage,
  clientSocket: net.Socket,
  head: Buffer,
  bundle: AccessBundle,
): void {
  const authority = req.url ?? "";
  const host = normalizeHost(authority);
  if (!host) {
    failConnect(clientSocket, 403, "出站被拦截：无效目标");
    return;
  }
  const decision = decide(host, bundle);
  if (decision.action === "block") {
    failConnect(clientSocket, 403, blockedHostMessage(host));
    return;
  }

  const port = connectPort(authority);
  const remote = net.connect(port, host, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length > 0) {
      remote.write(head);
    }
    remote.pipe(clientSocket);
    clientSocket.pipe(remote);
  });
  remote.on("error", () => {
    failConnect(clientSocket, 502, "出站隧道失败");
  });
  clientSocket.on("error", () => {
    remote.destroy();
  });
}

function parseProxyTarget(
  req: http.IncomingMessage,
): { ok: true; url: URL } | { ok: false; message: string } {
  const raw = req.url ?? "";
  try {
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw)) {
      const url = new URL(raw);
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { ok: false, message: "仅支持 HTTP/S 出站" };
      }
      return { ok: true, url };
    }
    const url = new URL(`http://${req.headers.host ?? "invalid"}${raw}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, message: "仅支持 HTTP/S 出站" };
    }
    return { ok: true, url };
  } catch {
    return { ok: false, message: "仅支持 HTTP/S 出站" };
  }
}

function forwardedHeaders(req: http.IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!value || HOP_BY_HOP.has(key.toLowerCase())) {
      continue;
    }
    headers[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return headers;
}

async function readBody(req: http.IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") {
    return undefined;
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (chunks.length === 0) {
    return undefined;
  }
  return Buffer.concat(chunks);
}

function writePlain(res: http.ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}

function failConnect(socket: net.Socket, status: number, body: string): void {
  socket.write(`HTTP/1.1 ${status} Forbidden\r\nContent-Type: text/plain; charset=utf-8\r\nConnection: close\r\n\r\n${body}`);
  socket.end();
}

function connectPort(authority: string): number {
  const trimmed = authority.trim();
  const colon = trimmed.lastIndexOf(":");
  if (colon > 0) {
    const port = Number(trimmed.slice(colon + 1));
    if (Number.isFinite(port) && port > 0) {
      return port;
    }
  }
  return 443;
}
