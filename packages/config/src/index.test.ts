import { describe, expect, it } from "vitest";
import { parseEnv } from "./index.ts";

const required = {
  FEISHU_APP_ID: "cli_app",
  FEISHU_APP_SECRET: "secret",
  FEISHU_ENCRYPT_KEY: "encrypt",
  FEISHU_VERIFICATION_TOKEN: "verify",
  ANTHROPIC_API_KEY: "sk-ant",
  DATABASE_URL: "postgres://agenttag:agenttag@localhost:5432/agenttag",
  REDIS_URL: "redis://localhost:6379",
  ADMIN_TOKEN: "admin-token",
  CREDENTIAL_MASTER_KEY: "0123456789abcdef0123456789abcdef",
};

describe("parseEnv", () => {
  it("parses required Feishu, Anthropic, and runtime secrets", () => {
    const env = parseEnv(required);
    expect(env.FEISHU_APP_ID).toBe("cli_app");
    expect(env.FEISHU_ENCRYPT_KEY).toBe("encrypt");
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant");
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.ADMIN_TOKEN).toBe("admin-token");
  });

  it("accepts ANTHROPIC_BASE_URL for domestic gateways", () => {
    const env = parseEnv({
      ...required,
      ANTHROPIC_BASE_URL: "https://api.example.com",
    });
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.example.com");
  });

  it("rejects missing FEISHU_ENCRYPT_KEY", () => {
    const { FEISHU_ENCRYPT_KEY: _, ...rest } = required;
    expect(() => parseEnv(rest)).toThrow();
  });
});
