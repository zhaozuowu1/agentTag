import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "node:crypto";

export function decryptFeishuEncrypt(encryptKey: string, encrypt: string): string {
  const key = createHash("sha256").update(encryptKey).digest();
  const buf = Buffer.from(encrypt, "base64");
  const iv = buf.subarray(0, 16);
  const decipher = createDecipheriv("aes-256-cbc", key, iv);
  const decrypted = Buffer.concat([decipher.update(buf.subarray(16)), decipher.final()]);
  return decrypted.toString("utf8");
}

export function encryptFeishuPayload(encryptKey: string, plaintext: string): string {
  const key = createHash("sha256").update(encryptKey).digest();
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([iv, encrypted]).toString("base64");
}

export function unwrapFeishuBody(raw: Record<string, unknown>, encryptKey: string): Record<string, unknown> {
  if (typeof raw.encrypt === "string") {
    return JSON.parse(decryptFeishuEncrypt(encryptKey, raw.encrypt)) as Record<string, unknown>;
  }
  return raw;
}

export function feishuRequestSignature(
  timestamp: string,
  nonce: string,
  encryptKey: string,
  body: string,
): string {
  return createHash("sha256").update(timestamp + nonce + encryptKey + body).digest("hex");
}

export function signaturesMatch(expected: string, actual: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(actual);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
}

export function eventVerificationToken(payload: Record<string, unknown>): string | undefined {
  if (typeof payload.token === "string") {
    return payload.token;
  }
  const header = payload.header;
  if (header && typeof header === "object") {
    const token = (header as { token?: unknown }).token;
    if (typeof token === "string") {
      return token;
    }
  }
  return undefined;
}
