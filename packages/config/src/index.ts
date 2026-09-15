import { z } from "zod";
import { DEFAULT_DASHSCOPE_MODEL } from "@agenttag/domain";

export { DEFAULT_DASHSCOPE_MODEL };

const optionalUrl = z.preprocess((value) => {
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
}, z.string().url().optional());

const optionalSecret = z.preprocess((value) => {
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
}, z.string().min(1).optional());

const emptyToUndefined = (value: unknown) => {
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
};

export const DEFAULT_DASHSCOPE_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";

export const envSchema = z.object({
  FEISHU_APP_ID: z.string().min(1),
  FEISHU_APP_SECRET: z.string().min(1),
  FEISHU_ENCRYPT_KEY: optionalSecret,
  FEISHU_VERIFICATION_TOKEN: z.string().min(1),
  DASHSCOPE_API_KEY: z.preprocess(emptyToUndefined, z.string().min(1)),
  DASHSCOPE_BASE_URL: z.preprocess(
    emptyToUndefined,
    z.string().url().default(DEFAULT_DASHSCOPE_BASE_URL),
  ),
  DASHSCOPE_MODEL: z.preprocess(
    emptyToUndefined,
    z.string().min(1).default(DEFAULT_DASHSCOPE_MODEL),
  ),
  ANTHROPIC_API_KEY: optionalSecret,
  ANTHROPIC_BASE_URL: optionalUrl,
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ADMIN_TOKEN: z.string().min(1),
  CREDENTIAL_MASTER_KEY: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export type FeishuEventMode = "http" | "websocket";

export function parseEnv(env: Record<string, string | undefined> = process.env): Env {
  return envSchema.parse(env);
}

export function resolveFeishuEventMode(
  input: { nodeEnv?: string; eventMode?: string } = {},
): FeishuEventMode {
  const explicit = input.eventMode?.trim().toLowerCase();
  if (explicit === "websocket" || explicit === "ws") {
    return "websocket";
  }
  if (explicit === "http" || explicit === "webhook") {
    return "http";
  }
  if (explicit) {
    throw new Error(`未知的 FEISHU_EVENT_MODE: ${explicit}`);
  }
  if (input.nodeEnv === "development" || input.nodeEnv === "test") {
    return "websocket";
  }
  return "http";
}

export function requireEncryptKeyIfHttp(mode: FeishuEventMode, encryptKey: string | undefined): void {
  if (mode === "http" && !encryptKey) {
    throw new Error("HTTP 事件订阅需要配置 FEISHU_ENCRYPT_KEY");
  }
}
