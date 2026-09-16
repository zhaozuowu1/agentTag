#!/usr/bin/env python3
"""Install a single-face Noto Sans CJK SC font that matplotlib can load."""

from __future__ import annotations

import glob
import os
import subprocess
import sys
from pathlib import Path

OUT = Path(os.environ.get("AGENTTAG_CJK_FONT_OUT", "/usr/local/share/fonts/NotoSansCJKSC-Regular.otf"))
CJK_CHARS = "月度营收"


def find_sources() -> list[Path]:
    patterns = [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/opentype/noto/NotoSansCJKsc-Regular.otf",
        "/usr/share/fonts/opentype/noto/NotoSansSC-Regular.otf",
        "/usr/share/fonts/**/NotoSansCJK*Regular.ttc",
        "/usr/share/fonts/**/NotoSansCJKsc-Regular.*",
        "/usr/share/fonts/**/NotoSansSC-Regular.*",
    ]
    found: list[Path] = []
    for pat in patterns:
        for match in glob.glob(pat, recursive=True):
            path = Path(match)
            if path.is_file() and path not in found:
                found.append(path)
    return found


def save_sc_face(src: Path, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if src.suffix.lower() != ".ttc":
        dest.write_bytes(src.read_bytes())
        return
    from fontTools.ttLib import TTCollection

    ttc = TTCollection(str(src))
    chosen = ttc.fonts[0]
    for font in ttc.fonts:
        names: list[str] = []
        for rec in font["name"].names:
            if rec.nameID in (1, 4, 16):
                try:
                    names.append(rec.toUnicode())
                except UnicodeDecodeError:
                    continue
        if any("CJK SC" in name or name == "Noto Sans SC" for name in names):
            chosen = font
            break
    chosen.save(str(dest))


def assert_matplotlib_cjk(font_path: Path) -> None:
    import matplotlib

    matplotlib.use("Agg")
    from matplotlib import font_manager
    from matplotlib.font_manager import FontProperties, findfont
    from matplotlib.ft2font import FT2Font

    font_manager.fontManager.addfont(str(font_path))
    font_manager._load_fontmanager(try_read_cache=False)
    path = findfont(FontProperties())
    font = FT2Font(path)
    missing = [ch for ch in CJK_CHARS if font.get_char_index(ord(ch)) == 0]
    if missing:
        raise SystemExit(f"CJK glyphs missing in {path}: {missing}")
    print(f"cjk-font-ok {path}")


def main() -> int:
    sources = find_sources()
    if not sources:
        print("no Noto CJK font found", file=sys.stderr)
        return 1
    save_sc_face(sources[0], OUT)
    subprocess.run(["fc-cache", "-f"], check=False)
    assert_matplotlib_cjk(OUT)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
