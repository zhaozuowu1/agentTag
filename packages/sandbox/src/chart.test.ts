import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { createDockerSandbox, type Sandbox } from "./runner.ts";

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

function dockerDaemonUp(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const describeDocker = dockerDaemonUp() ? describe : describe.skip;

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
});
