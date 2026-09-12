import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadRepoRootEnv } from "./load-root-env.ts";

describe("loadRepoRootEnv", () => {
  it("reads DATABASE_URL from the repo-root .env without overriding existing vars", async () => {
    const root = await mkdtemp(join(tmpdir(), "agenttag-env-"));
    try {
      await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []\n");
      await writeFile(join(root, ".env"), "DATABASE_URL=postgres://from-root-env\nALREADY_SET=from-file\n");
      const env: Record<string, string | undefined> = { ALREADY_SET: "keep-me" };
      loadRepoRootEnv({ startDir: join(root, "packages", "db", "src"), env });
      expect(env.DATABASE_URL).toBe("postgres://from-root-env");
      expect(env.ALREADY_SET).toBe("keep-me");

      const fromConfig: Record<string, string | undefined> = {};
      loadRepoRootEnv({ startDir: join(root, "packages", "db"), env: fromConfig });
      expect(fromConfig.DATABASE_URL).toBe("postgres://from-root-env");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
