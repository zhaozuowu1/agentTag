import { describe, expect, it } from "vitest";
import { decryptFeishuEncrypt, encryptFeishuPayload, unwrapFeishuBody } from "./encrypt.ts";

describe("feishu encrypt", () => {
  it("round-trips AES payload used by event subscriptions", () => {
    const key = "test-encrypt-key";
    const payload = JSON.stringify({ challenge: "abc", type: "url_verification" });
    const encrypt = encryptFeishuPayload(key, payload);
    expect(decryptFeishuEncrypt(key, encrypt)).toBe(payload);
    expect(unwrapFeishuBody({ encrypt }, key)).toEqual({ challenge: "abc", type: "url_verification" });
  });
});
