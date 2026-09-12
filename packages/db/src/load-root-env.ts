import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export function findRepoRoot(startDir: string): string {
  let dir = startDir;
  while (true) {
    if (existsSync(join(dir, "pnpm-workspace.yaml")) || existsSync(join(dir, "pnpm-lock.yaml"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return startDir;
    }
    dir = parent;
  }
}

export function loadEnvFile(filePath: string, env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): void {
  if (!existsSync(filePath)) {
    return;
  }
  const text = readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (env[key] === undefined) {
      env[key] = value;
    }
  }
}

export function loadRepoRootEnv(options?: {
  startDir?: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}): void {
  const startDir = options?.startDir ?? import.meta.dirname;
  const env = options?.env ?? process.env;
  loadEnvFile(join(findRepoRoot(startDir), ".env"), env);
}
