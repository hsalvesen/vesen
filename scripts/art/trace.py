#!/usr/bin/env python3
"""Trace a silhouette into ASCII art, in the terminal's own font.

Vesen draws its art with letters and punctuation on the character grid. This tracer renders every
printable ASCII glyph of the terminal's source font (assets-src/fonts/CascadiaCode.ttf, the font
Vesen Mono is subset from) into one cell of the terminal's aspect (advance 1200/2048 em, line
height 1.35 em) and gives each cell of a silhouette the glyph whose ink matches it best, by the
sum of squared differences on a small grid plus a penalty on the difference in coverage. A cell
that is all ink gets one fill glyph (M by default) so the interior reads as a texture, not noise.
It suits organic shapes (an apple, a penguin, a cloud) and not sharp letterforms.

As a library (see logos.py, which draws fastfetch's logos with it):

    from trace import canvas, mask, trace
    im, d = canvas(cols, rows)         # a PIL image of cols x rows cells, and its ImageDraw
    d.ellipse([x0, y0, x1, y1], fill=255)   # paint the silhouette white; fill=0 cuts a hole
    rows = trace(mask(im), fill='M')   # a list of strings, one per row

As a command, it traces an image file (a dark silhouette on light, or --invert):

    python3 scripts/art/trace.py shape.png --cols 26 [--rows 14] [--fill M] [--invert]

The backtick is never used, so the art can sit in a template literal; a backslash still needs
escaping in a quoted string (logos.py does that when it prints TypeScript).
"""

from __future__ import annotations

import argparse
import sys
from functools import lru_cache
from pathlib import Path

try:
    import numpy as np
    from PIL import Image, ImageDraw, ImageFilter, ImageFont
except ImportError as error:  # --help still works; anything else says what to install
    MISSING: ImportError | None = error
else:
    MISSING = None

REPO = Path(__file__).resolve().parents[2]
FONT = REPO / 'assets-src' / 'fonts' / 'CascadiaCode.ttf'

SIZE = 48  # px; the rendering size, quality only
CW = round(SIZE * 1200 / 2048)  # 28 px: the font's advance
CH = round(SIZE * 1.35)  # 65 px: the terminal's line height
GRID = (8, 16)  # the comparison grid, per cell

#: Every printable ASCII glyph but the space and the backtick.
ALPHABET = ''.join(chr(c) for c in range(0x21, 0x7F) if chr(c) != '`')


@lru_cache(maxsize=None)
def _glyphs(font_path: str) -> dict[str, np.ndarray]:
    """Each glyph of the alphabet as a GRID-sized float bitmap of one cell, laid out as the browser lays it."""
    font = ImageFont.truetype(font_path, SIZE)
    ascent, descent = font.getmetrics()
    half_leading = max(0, (CH - (ascent + descent)) // 2)
    glyphs: dict[str, np.ndarray] = {}
    for ch in ALPHABET:
        im = Image.new('L', (CW, CH), 0)
        ImageDraw.Draw(im).text((0, half_leading), ch, font=font, fill=255)
        glyphs[ch] = np.asarray(im.resize(GRID, Image.BOX), dtype=np.float32) / 255.0
    return glyphs


def canvas(cols: int, rows: int) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    """A black image of cols x rows cells, in pixels, and an ImageDraw to paint a white silhouette on."""
    im = Image.new('L', (cols * CW, rows * CH), 0)
    return im, ImageDraw.Draw(im)


def mask(im: Image.Image) -> np.ndarray:
    """An image as a float array in 0..1."""
    return np.asarray(im.convert('L'), dtype=np.float32) / 255.0


def trace(
    silhouette: np.ndarray,
    fill: str = 'M',
    *,
    alphabet: str = ALPHABET,
    empty: float = 0.02,
    full: float = 0.92,
    bias: float = 0.35,
    font: Path | str = FONT,
) -> list[str]:
    """Trace a float mask sized (rows*CH, cols*CW) into rows of text.

    A cell covered less than `empty` is a space and one covered more than `full` is `fill`; every
    other cell gets the glyph of `alphabet` whose ink is closest, with `bias` weighting how much a
    glyph's overall darkness must match the cell's coverage.
    """
    glyphs = _glyphs(str(font))
    chosen = {ch: glyphs[ch] for ch in alphabet if ch in glyphs}
    ink = {ch: float(g.mean()) for ch, g in chosen.items()}
    rows, cols = silhouette.shape[0] // CH, silhouette.shape[1] // CW
    out: list[str] = []
    for r in range(rows):
        line = ''
        for c in range(cols):
            cell = silhouette[r * CH : (r + 1) * CH, c * CW : (c + 1) * CW]
            small = Image.fromarray((cell * 255).astype(np.uint8)).resize(GRID, Image.BOX)
            cell = np.asarray(small, dtype=np.float32) / 255.0
            cover = float(cell.mean())
            if cover < empty:
                line += ' '
                continue
            if cover > full:
                line += fill
                continue
            best, best_ch = None, ' '
            for ch, g in chosen.items():
                err = float(((g - cell) ** 2).sum()) + bias * abs(ink[ch] - cover) * GRID[0] * GRID[1]
                if best is None or err < best:
                    best, best_ch = err, ch
            line += best_ch
        out.append(line.rstrip())
    return out


def threshold(silhouette: np.ndarray, ch: str, level: float = 0.5) -> list[str]:
    """Every cell covered more than `level` as `ch`: a flat tone, for a lighter second layer."""
    rows, cols = silhouette.shape[0] // CH, silhouette.shape[1] // CW
    return [
        ''.join(ch if silhouette[r * CH : (r + 1) * CH, c * CW : (c + 1) * CW].mean() > level else ' ' for c in range(cols)).rstrip()
        for r in range(rows)
    ]


def outline(silhouette: np.ndarray, px: int) -> np.ndarray:
    """The edge of a mask, `px` pixels wide: the mask less its erosion."""
    im = Image.fromarray((silhouette * 255).astype(np.uint8))
    eroded = np.asarray(im.filter(ImageFilter.MinFilter(px | 1)), dtype=np.float32) / 255.0
    return np.clip(silhouette - eroded, 0.0, 1.0)


def layer(*traced: list[str]) -> list[str]:
    """Several traces over one another: for each cell, the first that is not a space."""
    rows = max(len(t) for t in traced)
    out: list[str] = []
    for i in range(rows):
        lines = [t[i] if i < len(t) else '' for t in traced]
        width = max(len(line) for line in lines)
        cells = [' '] * width
        for line in lines:
            for x, ch in enumerate(line):
                if cells[x] == ' ' and ch != ' ':
                    cells[x] = ch
        out.append(''.join(cells).rstrip())
    return out


def size(traced: list[str]) -> tuple[int, int]:
    """(columns, rows) of a trace, blank last rows left out."""
    while traced and not traced[-1].strip():
        traced = traced[:-1]
    return max((len(line) for line in traced), default=0), len(traced)


def _image_mask(path: Path, cols: int, rows: int | None, invert: bool) -> np.ndarray:
    im = Image.open(path).convert('L')
    if rows is None:
        rows = max(1, round(im.height / im.width * cols * CW / CH))
    im = im.resize((cols * CW, rows * CH), Image.LANCZOS)
    m = mask(im)
    return m if invert else 1.0 - m


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0], formatter_class=argparse.RawDescriptionHelpFormatter, epilog=__doc__.split('\n\n', 1)[1])
    parser.add_argument('image', type=Path, help='an image of the silhouette, dark on light')
    parser.add_argument('--cols', type=int, default=26, help='the width in columns (default 26)')
    parser.add_argument('--rows', type=int, help='the height in rows (default: from the image aspect)')
    parser.add_argument('--fill', default='M', help='the glyph for cells that are all ink (default M)')
    parser.add_argument('--invert', action='store_true', help='the silhouette is light on dark')
    parser.add_argument('--font', type=Path, default=FONT, help=f'the TrueType font to match glyphs in (default {FONT.relative_to(REPO)})')
    args = parser.parse_args(argv)
    if MISSING is not None:
        print(f'trace: {MISSING}: pip install pillow numpy (see scripts/art/README.md)', file=sys.stderr)
        return 1
    if not args.font.exists():
        print(f'trace: font not found: {args.font}', file=sys.stderr)
        return 1
    for line in trace(_image_mask(args.image, args.cols, args.rows, args.invert), fill=args.fill, font=args.font):
        print(line)
    return 0


if __name__ == '__main__':
    sys.exit(main())
