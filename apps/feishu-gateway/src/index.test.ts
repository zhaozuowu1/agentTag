import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { encryptFeishuPayload } from "./encrypt.ts";
import { createGatewayApp } from "./index.ts";

const ENCRYPT_KEY = "test-encrypt-key";
const VERIFICATION_TOKEN = "vtoken";

function sign(timestamp: string, nonce: string, body: string): string {
  return createHash("sha256").update(timestamp + nonce + ENCRYPT_KEY + body).digest("hex");
}

function eventPayload(token = VERIFICATION_TOKEN) {
  return {
    schema: "2.0",
    header: {
      event_id: "ev_1",
      event_type: "im.message.receive_v1",
      token,
      tenant_key: "tenant_demo",
    },
    event: {},
  };
}

function signedEncryptRequest(payload: Record<string, unknown>, nonce: string) {
  const inner = JSON.stringify(payload);
  const encrypt = encryptFeishuPayload(ENCRYPT_KEY, inner);
  const body = JSON.stringify({ encrypt });
  const timestamp = "1710000000";
  return {
    body,
    headers: {
      "Content-Type": "application/json",
      "X-Lark-Request-Timestamp": timestamp,
      "X-Lark-Request-Nonce": nonce,
      "X-Lark-Signature": sign(timestamp, nonce, body),
    },
  };
}

describe("createGatewayApp webhook auth", () => {
  it("rejects HTTP events when Encrypt Key is not configured", async () => {
    const seen: unknown[] = [];
    const app = createGatewayApp({
      eventMode: "websocket",
      onEvent: async (payload) => {
        seen.push(payload);
      },
    });
    const body = JSON.stringify(eventPayload());
    const res = await app.request("/feishu/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(seen).toHaveLength(0);
    const health = await app.request("/health");
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ ok: true, events: "websocket" });
  });

  it("rejects plaintext events when an encrypt key is configured", async () => {
    const seen: unknown[] = [];
    const app = createGatewayApp({
      encryptKey: ENCRYPT_KEY,
      verificationToken: VERIFICATION_TOKEN,
      onEvent: async (payload) => {
        seen.push(payload);
      },
    });
    const body = JSON.stringify(eventPayload());
    const timestamp = "1710000000";
    const nonce = "nonce-1";
    const res = await app.request("/feishu/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Lark-Request-Timestamp": timestamp,
        "X-Lark-Request-Nonce": nonce,
        "X-Lark-Signature": sign(timestamp, nonce, body),
      },
      body,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(seen).toHaveLength(0);
  });

  it("rejects events with a missing or invalid X-Lark-Signature", async () => {
    const seen: unknown[] = [];
    const app = createGatewayApp({
      encryptKey: ENCRYPT_KEY,
      verificationToken: VERIFICATION_TOKEN,
      onEvent: async (payload) => {
        seen.push(payload);
      },
    });
    const inner = JSON.stringify(eventPayload());
    const encrypt = encryptFeishuPayload(ENCRYPT_KEY, inner);
    const body = JSON.stringify({ encrypt });
    const timestamp = "1710000000";
    const nonce = "nonce-2";
    const res = await app.request("/feishu/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Lark-Request-Timestamp": timestamp,
        "X-Lark-Request-Nonce": nonce,
        "X-Lark-Signature": "deadbeef",
      },
      body,
    });
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(seen).toHaveLength(0);
  });

  it("rejects events whose header.token does not match the verification token", async () => {
    const seen: unknown[] = [];
    const app = createGatewayApp({
      encryptKey: ENCRYPT_KEY,
      verificationToken: VERIFICATION_TOKEN,
      onEvent: async (payload) => {
        seen.push(payload);
      },
    });
    const inner = JSON.stringify(eventPayload("WRONG_TOKEN"));
    const encrypt = encryptFeishuPayload(ENCRYPT_KEY, inner);
    const body = JSON.stringify({ encrypt });
    const timestamp = "1710000000";
    const nonce = "nonce-3";
    const res = await app.request("/feishu/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Lark-Request-Timestamp": timestamp,
        "X-Lark-Request-Nonce": nonce,
        "X-Lark-Signature": sign(timestamp, nonce, body),
      },
      body,
    });
    expect(res.status).toBe(403);
    expect(seen).toHaveLength(0);
  });

  it("accepts an encrypted url_verification challenge without signature headers", async () => {
    const seen: unknown[] = [];
    const app = createGatewayApp({
      encryptKey: ENCRYPT_KEY,
      verificationToken: VERIFICATION_TOKEN,
      onEvent: async (payload) => {
        seen.push(payload);
      },
    });
    const encrypt = encryptFeishuPayload(
      ENCRYPT_KEY,
      JSON.stringify({
        challenge: "ajls384kdjx98xx",
        token: VERIFICATION_TOKEN,
        type: "url_verification",
      }),
    );
    const res = await app.request("/feishu/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encrypt }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ challenge: "ajls384kdjx98xx" });
    expect(seen).toHaveLength(0);
  });

  it("returns 400 when encrypt cannot be decrypted", async () => {
    const seen: unknown[] = [];
    const app = createGatewayApp({
      encryptKey: ENCRYPT_KEY,
      verificationToken: VERIFICATION_TOKEN,
      onEvent: async (payload) => {
        seen.push(payload);
      },
    });
    const res = await app.request("/feishu/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ encrypt: "!!!!not-valid-ciphertext!!!!" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid encrypt" });
    expect(seen).toHaveLength(0);
  });
});

describe("createGatewayApp event ack", () => {
  it("returns 200 before onEvent finishes", async () => {
    const order: string[] = [];
    const app = createGatewayApp({
      encryptKey: ENCRYPT_KEY,
      verificationToken: VERIFICATION_TOKEN,
      onEvent: async () => {
        order.push("handler");
      },
    });
    const req = signedEncryptRequest(eventPayload(), "nonce-ack");
    const res = await app.request("/feishu/events", { method: "POST", ...req });
    order.push("http-returned");
    expect(res.status).toBe(200);
    expect(order[0]).toBe("http-returned");
  });

  it("does not retry the whole onEvent after returning 200", async () => {
    let attempts = 0;
    const app = createGatewayApp({
      encryptKey: ENCRYPT_KEY,
      verificationToken: VERIFICATION_TOKEN,
      onEvent: async () => {
        attempts += 1;
        throw new Error("transient feishu error");
      },
    });
    const req = signedEncryptRequest(eventPayload(), "nonce-retry");
    const res = await app.request("/feishu/events", { method: "POST", ...req });
    expect(res.status).toBe(200);
    await vi.waitFor(() => {
      expect(attempts).toBeGreaterThanOrEqual(1);
    });
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(attempts).toBe(1);
  });
});
