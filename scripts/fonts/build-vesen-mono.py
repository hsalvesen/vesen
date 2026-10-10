#!/usr/bin/env python3
"""Builds public/fonts/VesenMono.woff2 from the variable source font in assets-src/fonts.

The terminal's font is a subset of a font released under the SIL Open Font License 1.1 with a
Reserved Font Name, so the subset is a Modified Version and ships under its own name, Vesen Mono,
with public/fonts/OFL.txt beside it.

What it does:
  1. Instances the variable font at wght=400 (one static Regular face).
  2. Subsets it to the characters a terminal needs: Latin (with the macron vowels of te reo
     Māori), punctuation, currency, arrows, maths, box drawing, blocks, shapes and braille.
  3. Drops hinting and every layout feature that changes spacing or substitutes glyphs (kerning,
     ligatures, contextual alternates), so each character keeps one fixed-width cell.
  4. Renames the family and keeps the copyright and licence records.
  5. Writes WOFF2, then the list of code points it holds (scripts/fonts/glyphs.json), which
     `npm run check:glyphs` reads to find any character in the source the font would not draw.

Needs the pinned fontTools and brotli (pip install -r scripts/fonts/requirements.txt). Paths
default to the repository, so `python3 scripts/fonts/build-vesen-mono.py` works from any directory.
It stops if the source lacks any code point in REQUIRED, and lists the rest of RANGES it lacks.

`--list` writes only the list, from the font already built: the cmap of public/fonts/VesenMono.woff2
as inclusive ranges, with the font's SHA-256 so the check can tell when the list is out of date.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "assets-src" / "fonts" / "CascadiaCode.ttf"
OUTPUT = ROOT / "public" / "fonts" / "VesenMono.woff2"
GLYPHS = ROOT / "scripts" / "fonts" / "glyphs.json"

FAMILY = "Vesen Mono"
FULL_NAME = "Vesen Mono Regular"
POSTSCRIPT_NAME = "VesenMono-Regular"
COPYRIGHT_SUFFIX = " Modified as Vesen Mono."

# Inclusive code point ranges: the Unicode blocks a terminal draws from. The source font covers
# several of them only in part (no diagonal arrows, for example), and the subsetter skips what it
# lacks; the browser then falls back to the next font in --term-font, whose glyph may not fill
# exactly one cell. The build lists each missing code point so none is assumed to be in the font.
RANGES: list[tuple[int, int]] = [
    (0x0020, 0x007E),  # Basic Latin
    (0x00A0, 0x00FF),  # Latin-1 Supplement
    (0x0100, 0x017F),  # Latin Extended-A: ā ē ī ō ū Ā Ē Ī Ō Ū (Ōtautahi, Tāmaki Makaurau)
    (0x1E00, 0x1EFF),  # Latin Extended Additional (in part)
    (0x2000, 0x206F),  # General Punctuation (in part)
    (0x2070, 0x209F),  # Superscripts and Subscripts (in part)
    (0x20A0, 0x20CF),  # Currency Symbols (in part)
    (0x2100, 0x214F),  # Letterlike Symbols (in part)
    (0x2190, 0x21FF),  # Arrows (in part: ← ↑ → ↓ ↔ ↕, none of ↖ ↗ ↘ ↙)
    (0x2200, 0x22FF),  # Mathematical Operators (in part)
    (0x23CE, 0x23CE),  # Return symbol, for key hints
    (0x2500, 0x257F),  # Box Drawing
    (0x2580, 0x259F),  # Block Elements
    (0x25A0, 0x25FF),  # Geometric Shapes
    (0x2713, 0x2713),  # Check mark
    (0x2800, 0x28FF),  # Braille Patterns (the spinner)
    (0xFFFD, 0xFFFD),  # Replacement character
]

# What art and the interface draw in fixed cells, which must come from this font. A source that
# lacks any of these stops the build.
REQUIRED: list[tuple[int, int]] = [
    (0x0020, 0x007E),  # Basic Latin
    (0x00A0, 0x017F),  # Latin-1 and Latin Extended-A
    (0x2013, 0x2015),  # – — ― (dashes)
    (0x2018, 0x201D),  # ‘ ’ ‚ ‛ “ ” (quotes)
    (0x2022, 0x2022),  # Bullet (snow in the weather art; · U+00B7 above draws its stars)
    (0x2026, 0x2026),  # Ellipsis
    (0x2190, 0x2195),  # ← ↑ → ↓ ↔ ↕
    (0x23CE, 0x23CE),  # Return symbol
    (0x2500, 0x25FF),  # Box Drawing (the sun's rays, rain and fog in the weather art), Block Elements
                       # (the VESEN logo, fastfetch's OS logos and the weather art's discs, clouds and
                       # bolt), Geometric Shapes
    (0x2713, 0x2713),  # Check mark
    (0x2800, 0x28FF),  # Braille Patterns
    (0xFFFD, 0xFFFD),  # Replacement character
]

# Only what correct text needs: no kern, liga, calt (where the source keeps its code ligatures),
# rlig or stylistic sets.
LAYOUT_FEATURES = ["ccmp", "locl", "mark", "mkmk"]

# Name records kept: copyright (0), family and style (1, 2), unique ID (3), full name (4),
# version (5), PostScript name (6), designer and vendor credits (8, 9, 11, 12), licence (13, 14),
# typographic family and style (16, 17). The trademark record (7) is about the reserved name.
NAME_IDS = [0, 1, 2, 3, 4, 5, 6, 8, 9, 11, 12, 13, 14, 16, 17]


def code_points(ranges: list[tuple[int, int]]) -> list[int]:
    return [cp for start, end in ranges for cp in range(start, end + 1)]


def unicodes() -> list[int]:
    return code_points(RANGES)


def check_coverage(font: TTFont) -> None:
    """Stops when the source lacks a REQUIRED code point, and lists what else in RANGES it lacks."""
    cmap = font.getBestCmap()
    required = [cp for cp in code_points(REQUIRED) if cp not in cmap]
    if required:
        listed = " ".join(f"U+{cp:04X}" for cp in required)
        raise SystemExit(f"the source font lacks code points the terminal needs: {listed}")
    missing = [cp for cp in unicodes() if cp not in cmap]
    if missing:
        print(f"vesen-mono: {len(missing)} code points in RANGES are not in the source font and fall back:")
        for start, end in RANGES:
            gaps = [cp for cp in missing if start <= cp <= end]
            if gaps:
                print(f"  U+{start:04X}-U+{end:04X}: " + " ".join(f"{cp:04X}" for cp in gaps))


def rename(font: TTFont) -> None:
    name = font["name"]
    version = f"{font['head'].fontRevision:.3f}"
    copyright_text = name.getDebugName(0)
    if not copyright_text:
        raise SystemExit("the source font has no copyright record (name ID 0)")
    if not copyright_text.endswith(COPYRIGHT_SUFFIX):
        copyright_text += COPYRIGHT_SUFFIX

    # Platform 3 (Windows, Unicode BMP, en-US) is what browsers read. Every other record of the
    # renamed IDs is removed, so no old name survives on another platform.
    renamed = {
        0: copyright_text,
        1: FAMILY,
        2: "Regular",
        3: f"{version};{POSTSCRIPT_NAME}",
        4: FULL_NAME,
        6: POSTSCRIPT_NAME,
        16: FAMILY,
        17: "Regular",
    }
    for name_id in renamed:
        name.removeNames(nameID=name_id)
    for name_id, text in renamed.items():
        name.setName(text, name_id, 3, 1, 0x409)
    name.names = [record for record in name.names if record.nameID in NAME_IDS]

    # The copyright and licence records are kept as written; no other record may use the old name.
    leftovers = [
        record.nameID
        for record in name.names
        if record.nameID not in (0, 13, 14) and "cascadia" in record.toUnicode().lower()
    ]
    if leftovers:
        raise SystemExit(f"name records still carry the reserved name: {sorted(set(leftovers))}")


def build(source: Path, output: Path) -> int:
    # The source's own timestamps are kept so the output is the same on every run.
    font = TTFont(source, recalcTimestamp=False)
    check_coverage(font)
    font = instancer.instantiateVariableFont(font, {"wght": 400}, updateFontNames=False)

    options = subset.Options()
    options.layout_features = LAYOUT_FEATURES
    options.hinting = False
    options.name_IDs = NAME_IDS
    options.name_languages = [0x409]
    options.notdef_outline = True
    options.glyph_names = False
    options.drop_tables += ["gasp", "DSIG", "STAT"]
    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=unicodes())
    subsetter.subset(font)

    rename(font)

    output.parent.mkdir(parents=True, exist_ok=True)
    font.flavor = "woff2"
    font.save(output)
    return output.stat().st_size


def ranges_of(code_points: list[int]) -> list[list[int]]:
    """Sorted code points as inclusive [start, end] ranges."""
    ranges: list[list[int]] = []
    for cp in sorted(set(code_points)):
        if ranges and ranges[-1][1] == cp - 1:
            ranges[-1][1] = cp
        else:
            ranges.append([cp, cp])
    return ranges


def shown_path(path: Path) -> str:
    """A path as the repository names it, with forward slashes; the path itself when outside."""
    try:
        return path.resolve().relative_to(ROOT).as_posix()
    except ValueError:
        return str(path)


def list_glyphs(font_path: Path, output: Path) -> int:
    """Writes the code points `font_path` maps to a glyph, as ranges, and returns how many."""
    code_points = sorted(TTFont(font_path).getBestCmap())
    listing = {
        "font": shown_path(font_path),
        "sha256": hashlib.sha256(font_path.read_bytes()).hexdigest(),
        "count": len(code_points),
        "ranges": ranges_of(code_points),
    }
    text = json.dumps(listing, indent=2)
    # One range a line is enough; indent=2 would put each number on its own.
    text = text.replace("[\n      ", "[").replace(",\n      ", ", ").replace("\n    ]", "]")
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(text + "\n", encoding="utf-8")
    return len(code_points)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--source", type=Path, default=SOURCE)
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--glyphs", type=Path, default=GLYPHS, help="where the list of code points goes")
    parser.add_argument("--list", action="store_true", help="only list the code points of the font at --output")
    args = parser.parse_args(argv)

    if not args.list:
        size = build(args.source, args.output)
        print(f"vesen-mono: wrote {shown_path(args.output)} ({size:,} bytes, {size / 1000:.1f} kB)")
    count = list_glyphs(args.output, args.glyphs)
    print(f"vesen-mono: listed {count:,} code points of {shown_path(args.output)} in {shown_path(args.glyphs)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
