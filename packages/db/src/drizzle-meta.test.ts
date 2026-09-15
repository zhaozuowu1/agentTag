import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const metaDir = join(dirname(fileURLToPath(import.meta.url)), "../drizzle/meta");

describe("drizzle migration snapshots", () => {
  it("keeps a snapshot for every journal entry so generate can diff", () => {
    const journal = JSON.parse(readFileSync(join(metaDir, "_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; tag: string }>;
    };
    expect(journal.entries.length).toBeGreaterThan(0);
    for (const entry of journal.entries) {
      const snapshot = join(metaDir, `${String(entry.idx).padStart(4, "0")}_snapshot.json`);
      expect(existsSync(snapshot), `missing ${entry.idx} snapshot for ${entry.tag}`).toBe(true);
    }
  });

  it("records monthly_limit_usd as nullable in the 0001 snapshot", () => {
    const snapshot = JSON.parse(readFileSync(join(metaDir, "0001_snapshot.json"), "utf8")) as {
      prevId: string;
      tables: { "public.tenants": { columns: { monthly_limit_usd: { notNull: boolean; default?: string } } } };
    };
    expect(snapshot.prevId).toBe("c14f6a38-47f8-4aa0-b011-a0f48412f063");
    const col = snapshot.tables["public.tenants"].columns.monthly_limit_usd;
    expect(col.notNull).toBe(false);
    expect(col.default).toBeUndefined();
  });

  it("records tenants.model_id and enable_thinking in the 0002 snapshot", () => {
    const snapshot = JSON.parse(readFileSync(join(metaDir, "0002_snapshot.json"), "utf8")) as {
      prevId: string;
      tables: {
        "public.tenants": {
          columns: {
            model_id: { notNull: boolean };
            enable_thinking: { notNull: boolean; default?: string };
          };
        };
      };
    };
    expect(snapshot.prevId).toBe("91819966-8b99-4123-ac9b-c9a073f60c86");
    expect(snapshot.tables["public.tenants"].columns.model_id.notNull).toBe(false);
    expect(snapshot.tables["public.tenants"].columns.enable_thinking.notNull).toBe(true);
    expect(snapshot.tables["public.tenants"].columns.enable_thinking.default).toBe(false);
  });
});
