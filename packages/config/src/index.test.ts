import { describe, expect, it } from "vitest";
import { parseEnv, requireEncryptKeyIfHttp, resolveFeishuEventMode } from "./index.ts";

const required = {
  FEISHU_APP_ID: "cli_app",
  FEISHU_APP_SECRET: "secret",
  FEISHU_ENCRYPT_KEY: "encrypt",
  FEISHU_VERIFICATION_TOKEN: "verify",
  DASHSCOPE_API_KEY: "sk-dashscope-test",
  DATABASE_URL: "postgres://agenttag:agenttag@localhost:5432/agenttag",
  REDIS_URL: "redis://localhost:6379",
  ADMIN_TOKEN: "admin-token",
  CREDENTIAL_MASTER_KEY: "0123456789abcdef0123456789abcdef",
};

describe("parseEnv", () => {
  it("requires DashScope and starts without an Anthropic key", () => {
    const env = parseEnv(required);
    expect(env.FEISHU_APP_ID).toBe("cli_app");
    expect(env.FEISHU_ENCRYPT_KEY).toBe("encrypt");
    expect(env.DASHSCOPE_API_KEY).toBe("sk-dashscope-test");
    expect(env.DASHSCOPE_BASE_URL).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
    expect(env.DASHSCOPE_MODEL).toBe("qwen3.8-max");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
    expect(env.ADMIN_TOKEN).toBe("admin-token");
  });

  it("lets DASHSCOPE_MODEL and DASHSCOPE_BASE_URL be overridden", () => {
    const env = parseEnv({
      ...required,
      DASHSCOPE_MODEL: "qwen-max",
      DASHSCOPE_BASE_URL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    });
    expect(env.DASHSCOPE_MODEL).toBe("qwen-max");
    expect(env.DASHSCOPE_BASE_URL).toBe("https://dashscope-intl.aliyuncs.com/compatible-mode/v1");
  });

  it("treats empty DashScope model and base URL as the documented defaults", () => {
    const env = parseEnv({
      ...required,
      DASHSCOPE_MODEL: "",
      DASHSCOPE_BASE_URL: "",
    });
    expect(env.DASHSCOPE_MODEL).toBe("qwen3.8-max");
    expect(env.DASHSCOPE_BASE_URL).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
  });

  it("rejects a missing DASHSCOPE_API_KEY even when Anthropic is set", () => {
    const { DASHSCOPE_API_KEY: _, ...rest } = required;
    expect(() =>
      parseEnv({
        ...rest,
        ANTHROPIC_API_KEY: "sk-ant",
      }),
    ).toThrow(/DASHSCOPE_API_KEY/);
  });

  it("treats empty DASHSCOPE_API_KEY as missing", () => {
    expect(() => parseEnv({ ...required, DASHSCOPE_API_KEY: "" })).toThrow(/DASHSCOPE_API_KEY/);
  });

  it("accepts optional Anthropic fields without making them a startup dependency", () => {
    const env = parseEnv({
      ...required,
      ANTHROPIC_API_KEY: "sk-ant",
      ANTHROPIC_BASE_URL: "https://api.example.com",
    });
    expect(env.ANTHROPIC_API_KEY).toBe("sk-ant");
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.example.com");
  });

  it("allows missing FEISHU_ENCRYPT_KEY so development can use long connection", () => {
    const { FEISHU_ENCRYPT_KEY: _, ...rest } = required;
    const env = parseEnv(rest);
    expect(env.FEISHU_ENCRYPT_KEY).toBeUndefined();
  });

  it("treats empty FEISHU_ENCRYPT_KEY as unset", () => {
    const env = parseEnv({ ...required, FEISHU_ENCRYPT_KEY: "" });
    expect(env.FEISHU_ENCRYPT_KEY).toBeUndefined();
  });
});

describe("resolveFeishuEventMode", () => {
  it("uses SDK long connection in development and test", () => {
    expect(resolveFeishuEventMode({ nodeEnv: "development" })).toBe("websocket");
    expect(resolveFeishuEventMode({ nodeEnv: "test" })).toBe("websocket");
  });

  it("uses HTTP webhook in production and when NODE_ENV is unset", () => {
    expect(resolveFeishuEventMode({ nodeEnv: "production" })).toBe("http");
    expect(resolveFeishuEventMode({})).toBe("http");
  });

  it("lets FEISHU_EVENT_MODE override the default", () => {
    expect(resolveFeishuEventMode({ nodeEnv: "production", eventMode: "websocket" })).toBe("websocket");
    expect(resolveFeishuEventMode({ nodeEnv: "development", eventMode: "http" })).toBe("http");
    expect(resolveFeishuEventMode({ nodeEnv: "development", eventMode: "webhook" })).toBe("http");
  });

  it("rejects an unknown FEISHU_EVENT_MODE instead of falling back", () => {
    expect(() => resolveFeishuEventMode({ nodeEnv: "production", eventMode: "websokcet" })).toThrow(
      /FEISHU_EVENT_MODE/,
    );
    expect(() => resolveFeishuEventMode({ nodeEnv: "development", eventMode: "httpp" })).toThrow(
      /FEISHU_EVENT_MODE/,
    );
  });
});

describe("requireEncryptKeyIfHttp", () => {
  it("does not require Encrypt Key for long connection", () => {
    expect(() => requireEncryptKeyIfHttp("websocket", undefined)).not.toThrow();
  });

  it("requires Encrypt Key for production HTTP webhook", () => {
    expect(() => requireEncryptKeyIfHttp("http", undefined)).toThrow(/FEISHU_ENCRYPT_KEY/);
    expect(() => requireEncryptKeyIfHttp("http", "")).toThrow(/FEISHU_ENCRYPT_KEY/);
  });

  it("allows HTTP webhook when Encrypt Key is present", () => {
    expect(() => requireEncryptKeyIfHttp("http", "encrypt")).not.toThrow();
  });
});
