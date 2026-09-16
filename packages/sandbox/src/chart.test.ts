import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createDockerSandbox, type Sandbox } from "./runner.ts";

const sandboxRoot = fileURLToPath(new URL("..", import.meta.url));

const PLOT_PY = `
import csv, pathlib, struct, zlib

def png(width, height, rows):
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)
    raw = b"".join(b"\\x00" + bytes(row) for row in rows)
    return (
        b"\\x89PNG\\r\\n\\x1a\\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )

rows = list(csv.DictReader(open("sales.csv", encoding="utf-8")))
width, height = 120, 80
img = [[230, 230, 230] * width for _ in range(height)]
vals = [float(r["amount"]) for r in rows]
mx = max(vals) or 1
bar_w = max(1, width // max(len(vals), 1))
for i, v in enumerate(vals):
    h = int(v / mx * (height - 10))
    for y in range(height - h, height):
        for x in range(i * bar_w, min((i + 1) * bar_w - 1, width)):
            img[y][x * 3 : x * 3 + 3] = [30, 90, 200]
pathlib.Path("chart.png").write_bytes(png(width, height, img))
`;

const CJK_TITLE_PY = `
import json
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.font_manager import FontProperties, findfont
from matplotlib.ft2font import FT2Font
from matplotlib.textpath import TextPath

TITLE = "2026 月度营收"
CJK = "月度营收"
fp = FontProperties()
path = findfont(fp)
font = FT2Font(path)
missing = [ch for ch in CJK if font.get_char_index(ord(ch)) == 0]
tp = TextPath((0, 0), "月", size=40, prop=fp)

fig, ax = plt.subplots(figsize=(6, 3))
ax.bar(["1月", "2月", "3月"], [10, 25, 15])
ax.set_title(TITLE)
fig.savefig("chart.png", dpi=120)
plt.close(fig)

payload = {
    "font": path,
    "missing": missing,
    "month_vertices": int(len(tp.vertices)),
    "png_bytes": Path("chart.png").stat().st_size,
}
print("CJK_REPORT:" + json.dumps(payload, ensure_ascii=False))
if missing or len(tp.vertices) < 20:
    sys.exit(1)
`;

function dockerDaemonUp(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeDocker = dockerDaemonUp() ? describe : describe.skip;

describe("sandbox CJK matplotlib config", () => {
  it("installs Noto Sans CJK in the image and prefers it for matplotlib titles", () => {
    const dockerfile = readFileSync(join(sandboxRoot, "Dockerfile.sandbox"), "utf8");
    const rcPath = join(sandboxRoot, "mpl", "matplotlibrc");
    expect(dockerfile).toMatch(/fonts-noto-cjk/);
    expect(dockerfile).toMatch(/MATPLOTLIBRC=/);
    expect(dockerfile).toMatch(/COPY\s+\S*matplotlibrc/);
    expect(dockerfile).toMatch(/pip install[^\n]*\bfonttools\b/);
    expect(dockerfile).not.toMatch(/pip uninstall[^\n]*fonttools/);
    expect(existsSync(rcPath)).toBe(true);
    const rc = readFileSync(rcPath, "utf8");
    expect(rc).toMatch(/Noto Sans CJK SC/);
    expect(rc).toMatch(/axes\.unicode_minus\s*:\s*False/);
  });
});

describeDocker("sandbox csv chart", () => {
  const boxes: Sandbox[] = [];
  afterEach(async () => {
    await Promise.all(boxes.splice(0).map((box) => box.destroy().catch(() => undefined)));
  });

  it("plots an uploaded CSV to png inside an isolated container", async () => {
    const sandbox = await createDockerSandbox({
      sessionId: "sess_csv_png",
      image: "python:3.12-slim",
    });
    boxes.push(sandbox);
    await sandbox.writeFile("sales.csv", "month,amount\n1,10\n2,25\n3,15\n");
    await sandbox.writeFile("plot.py", PLOT_PY);
    const ran = await sandbox.exec("python3 plot.py");
    expect(ran.code).toBe(0);
    const png = await sandbox.readFileBytes("chart.png");
    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it(
    "renders a Chinese matplotlib title with CJK glyphs under --network none",
    async () => {
      const image = "agenttag-sandbox:cjk-test";
      execFileSync("docker", ["build", "-f", "Dockerfile.sandbox", "-t", image, "."], {
        cwd: sandboxRoot,
        encoding: "utf8",
        timeout: 10 * 60 * 1000,
        maxBuffer: 16 * 1024 * 1024,
      });
      const sandbox = await createDockerSandbox({
        sessionId: "sess_cjk_title",
        image,
      });
      boxes.push(sandbox);

      const inspect = JSON.parse(execFileSync("docker", ["inspect", sandbox.id], { encoding: "utf8" })) as Array<{
        HostConfig?: { NetworkMode?: string };
      }>;
      expect(inspect[0]?.HostConfig?.NetworkMode).toBe("none");

      await sandbox.writeFile("plot_cjk.py", CJK_TITLE_PY);
      const ran = await sandbox.exec("python3 plot_cjk.py");
      expect(ran.code, `${ran.stdout}\n${ran.stderr}`).toBe(0);
      const line = ran.stdout.split("\n").find((row) => row.startsWith("CJK_REPORT:"));
      expect(line).toBeTruthy();
      const report = JSON.parse((line ?? "").slice("CJK_REPORT:".length)) as {
        font?: string;
        missing?: string[];
        month_vertices?: number;
      };
      expect(report.missing).toEqual([]);
      expect(report.month_vertices ?? 0).toBeGreaterThan(20);
      expect(report.font ?? "").toMatch(/Noto/i);
      const png = await sandbox.readFileBytes("chart.png");
      expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    },
    600_000,
  );
});
