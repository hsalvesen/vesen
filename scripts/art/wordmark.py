#!/usr/bin/env python3
"""The VESEN wordmark's drop shadow.

The banner's block letters (BANNER_ART and BANNER_ART_COMPACT in src/commands/lib/banner.ts) are
2x2-pixel bitmaps drawn in quadrant characters: each character maps to four bits. This reads them
back from banner.ts, shifts a copy one column right and one row down, and draws that shadow with
':' wherever no letter is; a cell that has any ink keeps its letter. A shadow already there is
read as empty, so running it again changes nothing.

    python3 scripts/art/wordmark.py             prints both wordmarks with their shadow
    python3 scripts/art/wordmark.py --write     rewrites the two constants in banner.ts
    python3 scripts/art/wordmark.py --preview   writes scripts/art/preview/wordmark.txt for the preview page
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
BANNER = REPO / 'src' / 'commands' / 'lib' / 'banner.ts'
SHADE = ':'

#: Each quadrant character's bits: (top left, top right, bottom left, bottom right).
QUADRANTS = {
    ' ': (0, 0, 0, 0), '▘': (1, 0, 0, 0), '▝': (0, 1, 0, 0), '▀': (1, 1, 0, 0),
    '▖': (0, 0, 1, 0), '▌': (1, 0, 1, 0), '▞': (0, 1, 1, 0), '▛': (1, 1, 1, 0),
    '▗': (0, 0, 0, 1), '▚': (1, 0, 0, 1), '▐': (0, 1, 0, 1), '▜': (1, 1, 0, 1),
    '▄': (0, 0, 1, 1), '▙': (1, 0, 1, 1), '▟': (0, 1, 1, 1), '█': (1, 1, 1, 1),
}  # fmt: skip
CHARACTERS = {bits: ch for ch, bits in QUADRANTS.items()}

Bitmap = list[list[int]]


def decode(art: str) -> Bitmap:
    """The 2x2 bitmap behind rows of quadrant characters; any other character is empty."""
    rows = art.split('\n')
    width = max(len(row) for row in rows)
    bitmap: Bitmap = []
    for row in rows:
        top: list[int] = []
        bottom: list[int] = []
        for ch in row.ljust(width):
            tl, tr, bl, br = QUADRANTS.get(ch, (0, 0, 0, 0))
            top += [tl, tr]
            bottom += [bl, br]
        bitmap += [top, bottom]
    return bitmap


def render(ink: Bitmap, dx: int = 2, dy: int = 2, shade: str = SHADE) -> str:
    """Quadrant characters for the ink, with its shadow `dx` pixels right and `dy` down drawn in `shade`."""
    h, w = len(ink), len(ink[0])
    H, W = h + dy, w + dx
    H += H % 2
    W += W % 2
    full = [[0] * W for _ in range(H)]
    shadow = [[0] * W for _ in range(H)]
    for y in range(h):
        for x in range(w):
            if ink[y][x]:
                full[y][x] = 1
                shadow[y + dy][x + dx] = 1
    lines: list[str] = []
    for y in range(0, H, 2):
        line = ''
        for x in range(0, W, 2):
            bits = (full[y][x], full[y][x + 1], full[y + 1][x], full[y + 1][x + 1])
            if any(bits):
                line += CHARACTERS[bits]
            elif shadow[y][x] or shadow[y][x + 1] or shadow[y + 1][x] or shadow[y + 1][x + 1]:
                line += shade
            else:
                line += ' '
        lines.append(line.rstrip())
    while lines and not lines[-1]:
        lines.pop()
    return '\n'.join(lines)


NAMES = ('BANNER_ART', 'BANNER_ART_COMPACT')


def constant(source: str, name: str) -> re.Match[str]:
    match = re.search(rf'\b{name}\s*=\s*`([^`]*)`', source)
    if match is None:
        raise SystemExit(f'wordmark: {name} not found in {BANNER}')
    return match


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--write', action='store_true', help=f'rewrite the constants in {BANNER.relative_to(REPO)}')
    parser.add_argument('--preview', action='store_true', help='write scripts/art/preview/wordmark.txt')
    args = parser.parse_args(argv)
    source = BANNER.read_text()
    pieces: list[str] = []
    for name in NAMES:
        match = constant(source, name)
        shadowed = render(decode(match.group(1)))
        rows = shadowed.split('\n')
        print(f'--- {name} ({max(len(r) for r in rows)}x{len(rows)})\n{shadowed}\n')
        pieces.append(f'{name}\n{shadowed}')
        source = source[: match.start(1)] + shadowed + source[match.end(1) :]
    if args.write:
        BANNER.write_text(source)
        print(f'wrote {BANNER.relative_to(REPO)}', file=sys.stderr)
    if args.preview:
        out = Path(__file__).with_name('preview') / 'wordmark.txt'
        out.write_text('\n%%\n'.join(pieces) + '\n')
        print(f'wrote {out}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
