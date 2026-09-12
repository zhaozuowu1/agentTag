import { z } from "zod";

const optionalUrl = z.preprocess((value) => {
  if (value === undefined || value === "") {
    return undefined;
  }
  return value;
}, z.string().url().optional());

export const envSchema = z.object({
  FEISHU_APP_ID: z.string().min(1),
  FEISHU_APP_SECRET: z.string().min(1),
  FEISHU_ENCRYPT_KEY: z.string().min(1),
  FEISHU_VERIFICATION_TOKEN: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  ANTHROPIC_BASE_URL: optionalUrl,
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ADMIN_TOKEN: z.string().min(1),
  CREDENTIAL_MASTER_KEY: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(env: Record<string, string | undefined> = process.env): Env {
  return envSchema.parse(env);
}
