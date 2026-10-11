#!/usr/bin/env python3
"""fastfetch's OS logos: four silhouettes painted with PIL and traced into ASCII by trace.py.

    python3 scripts/art/logos.py              prints the four logos with their sizes
    python3 scripts/art/logos.py --ts         prints them as the rows of src/commands/system/fastfetch.logos.ts
    python3 scripts/art/logos.py --preview    writes scripts/art/preview/art.txt for the preview page

Each logo is a function that paints white shapes (and black holes) on a canvas of cells, then
traces it with the fill glyph that suits it. Edit the geometry, run with --preview, reload the
preview page (README.md) and look at it in the real font before copying the rows into the app.
"""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

from trace import CH, CW, MISSING, canvas, layer, mask, size, threshold, trace

if MISSING is None:
    from PIL import Image, ImageDraw

Point = tuple[float, float]


def lens(d: ImageDraw.ImageDraw, a: Point, b: Point, half_width: float, fill: int = 255, bulge: float = 1.0) -> None:
    """A pointed leaf shape from a to b, widest in the middle; bulge > 1 moves the width towards b."""
    (x0, y0), (x1, y1) = a, b
    length = math.hypot(x1 - x0, y1 - y0)
    ux, uy = (x1 - x0) / length, (y1 - y0) / length
    nx, ny = -uy, ux
    side: list[Point] = []
    other: list[Point] = []
    steps = 40
    for i in range(steps + 1):
        t = i / steps
        w = half_width * math.sin(math.pi * t**bulge)
        px, py = x0 + ux * length * t, y0 + uy * length * t
        side.append((px + nx * w, py + ny * w))
        other.append((px - nx * w, py - ny * w))
    d.polygon(side + other[::-1], fill=fill)


def circle(d: ImageDraw.ImageDraw, c: Point, r: float, fill: int = 255) -> None:
    x, y = c
    d.ellipse([x - r, y - r, x + r, y + r], fill=fill)


def cell_hole(d: ImageDraw.ImageDraw, col: int, row: int, cols: int = 1) -> None:
    """Cuts whole cells out, so the hole is a clean space in the fill."""
    d.rectangle([col * CW, row * CH, (col + cols) * CW - 1, (row + 1) * CH - 1], fill=0)


def blank(im: Image.Image) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    """Another layer the size of a canvas."""
    other = Image.new('L', im.size, 0)
    return other, ImageDraw.Draw(other)


def apple(cols: int = 26, rows: int = 14) -> list[str]:
    """An apple: two lobes with a dip between them, a bite out of the upper right, cheeks widest below it, a notch at the foot, a leaf leaning right."""
    im, d = canvas(cols, rows)
    W, H = im.size
    cx = W / 2
    top, bottom = H * 0.245, H * 0.975
    bh = bottom - top
    # The lobes, apart enough for a real dip.
    r = W * 0.22
    for sign in (-1, 1):
        circle(d, (cx + sign * W * 0.19, top + r), r)
    # The cheeks, widest just under the bite, then the narrower foot.
    d.ellipse([cx - W * 0.47, top + bh * 0.24, cx + W * 0.47, top + bh * 0.92], fill=255)
    d.ellipse([cx - W * 0.32, top + bh * 0.60, cx + W * 0.32, bottom], fill=255)
    # The notch between the two feet.
    d.ellipse([cx - W * 0.08, bottom - H * 0.075, cx + W * 0.08, bottom + H * 0.075], fill=0)
    # The bite: one clean circle out of the upper right, ending where the cheek is widest.
    circle(d, (cx + W * 0.49, top + bh * 0.30), W * 0.24, fill=0)
    # The leaf: a slender pointed lens leaning right, above the dip.
    lens(d, (cx + W * 0.02, top - H * 0.025), (cx + W * 0.20, top - H * 0.24), W * 0.045, bulge=0.8)
    return trace(mask(im), fill='M')


def android(cols: int = 26, rows: int = 14) -> list[str]:
    """A bugdroid: the dome with two antennae and two eyes, the body, two arms and two legs."""
    im, d = canvas(cols, rows)
    W, H = im.size
    cx = W / 2
    # Widths on the grid: the body 16 columns, a column's gap, arms of 3 columns.
    hr = 8 * CW
    dome_top = 1.75 * CH
    dome_bottom = dome_top + hr
    d.pieslice([cx - hr, dome_top, cx + hr, dome_top + 2 * hr], 180, 360, fill=255)
    # The antennae lean out from the dome at a column a row, each crossing its cells corner to
    # corner, traced on their own as slashes.
    antennae_im, ad = blank(im)
    for sign in (-1, 1):
        ad.line([(cx + sign * 4 * CW, 2 * CH), (cx + sign * 6.2 * CW, -0.2 * CH)], fill=255, width=round(CW * 0.3))
    # The eyes, one cell each.
    for col in (int(cx / CW) - 4, int(cx / CW) + 3):
        cell_hole(d, col, 4)
    # The body, a half row under the head, with rounded feet.
    body_top = 6 * CH
    body_bottom = 11 * CH
    d.rounded_rectangle([cx - hr, body_top, cx + hr - 1, body_bottom], radius=CW * 2, fill=255)
    d.rectangle([cx - hr, body_top, cx + hr - 1, body_top + CH], fill=255)
    # The arms, a column out from the body.
    for sign in (-1, 1):
        x0 = cx + sign * (hr + CW)
        x1 = x0 + sign * 3 * CW
        d.rounded_rectangle([min(x0, x1), body_top, max(x0, x1) - 1, body_bottom - CH * 1.5], radius=CW * 1.4, fill=255)
    # The legs.
    for sign in (-1, 1):
        x0 = cx + sign * CW * 1.5
        x1 = x0 + sign * 3 * CW
        d.rounded_rectangle([min(x0, x1), body_bottom - CH * 0.5, max(x0, x1) - 1, H - CH * 0.3], radius=CW, fill=255)
    return layer(trace(mask(antennae_im), alphabet='/\\', empty=0.15), trace(mask(im), fill='M'))


#: Edge glyphs for the flat-filled panes: punctuation and thin letters, nothing as dark as the fill.
PANE_ALPHABET = '#.,:;\'"-_=+*^~<>/\\|()[]{}!il17TLJ'


def windows(cols: int = 28, rows: int = 13) -> list[str]:
    """Four panes in perspective: the left edge nearer the vanishing point, so the upper-left pane is the smallest."""
    im, d = canvas(cols, rows)
    W, H = im.size
    left, right = 0, W - 1
    gap_x = (11 * CW - 1, 13 * CW)  # the vertical gap: two columns
    gap_y = (6 * CH - 1, 7 * CH)  # the horizontal gap: one row
    # The top edge runs from (left, top_l) up to (right, 0); the bottom from (left, H - top_l) down to (right, H).
    top_l = H * 0.19

    def top_at(x: float) -> float:
        return top_l * (1 - x / W)

    def bottom_at(x: float) -> float:
        return H - 1 - top_at(x)

    panes = [
        [(left, top_at(left)), (gap_x[0], top_at(gap_x[0])), (gap_x[0], gap_y[0]), (left, gap_y[0])],
        [(gap_x[1], top_at(gap_x[1])), (right, top_at(right)), (right, gap_y[0]), (gap_x[1], gap_y[0])],
        [(left, gap_y[1]), (gap_x[0], gap_y[1]), (gap_x[0], bottom_at(gap_x[0])), (left, bottom_at(left))],
        [(gap_x[1], gap_y[1]), (right, gap_y[1]), (right, bottom_at(right)), (gap_x[1], bottom_at(gap_x[1]))],
    ]
    for pane in panes:
        d.polygon(pane, fill=255)
    return trace(mask(im), fill='#', alphabet=PANE_ALPHABET)


#: The feet, drawn flat; the eyes and the beak, drawn as what they are.
FEET_ALPHABET = '=-_,.\'"'
FACE_ALPHABET = 'oOvV'


def linux(cols: int = 27, rows: int = 14) -> list[str]:
    """A penguin: a black head with a light face, eyes and a beak; a body with a light belly; flippers out past it; two flat feet."""
    im, d = canvas(cols, rows)
    W, H = im.size
    cx = 13.5 * CW  # the middle of a column, so the eyes sit a column either side of the beak
    # The body, an egg, then the flippers leaning out past it, then the head.
    d.ellipse([cx - W * 0.30, 2.8 * CH, cx + W * 0.30, 10.8 * CH], fill=255)
    d.ellipse([cx - W * 0.36, 5.6 * CH, cx + W * 0.36, 12.85 * CH], fill=255)
    for sign in (-1, 1):
        lens(d, (cx + sign * W * 0.22, 4.2 * CH), (cx + sign * W * 0.39, 9.9 * CH), W * 0.075, bulge=1.2)
    circle(d, (cx, 2.0 * CH), 4.6 * CW)
    ink = mask(im)
    # The light front: the face, the neck and the belly.
    light_im, ld = blank(im)
    ld.ellipse([cx - 3.5 * CW, 1.0 * CH, cx + 3.5 * CW, 4.4 * CH], fill=255)
    ld.ellipse([cx - W * 0.30, 3.9 * CH, cx + W * 0.30, 11.8 * CH], fill=255)
    light = mask(light_im) * ink
    # The eyes, one cell each, and the beak, one cell between and below them, in ink on the face.
    face_im, fd = blank(im)
    beak = int(cx / CW)  # the middle column
    for col in (beak - 2, beak + 2):
        circle(fd, ((col + 0.5) * CW, 2.5 * CH), CW * 0.5)
    fd.polygon([(beak * CW + 1, 3 * CH + 6), ((beak + 1) * CW - 2, 3 * CH + 6), ((beak + 0.5) * CW, 3 * CH + 52)], fill=255)
    features = mask(face_im)
    # The feet: one flat row each, under the body.
    feet_im, fe = blank(im)
    for sign in (-1, 1):
        fe.ellipse([cx + sign * W * 0.26 - W * 0.17, 13 * CH + 2, cx + sign * W * 0.26 + W * 0.17, 14 * CH + 24], fill=255)
    feet = mask(feet_im)
    body = ink * (1 - light) * (1 - feet)
    return layer(
        trace(features, fill='o', alphabet=FACE_ALPHABET, full=1.1),
        trace(body, fill='W'),
        threshold(light, '.', 0.5),
        trace(feet, fill='=', alphabet=FEET_ALPHABET, full=0.8),
    )


LOGOS = {'apple': apple, 'android': android, 'windows': windows, 'linux': linux}


def ts_rows(art: list[str]) -> str:
    """The rows as the lines of an `art([...])` call in TypeScript, backslashes and quotes escaped."""
    while art and not art[-1].strip():
        art = art[:-1]
    return '\n'.join("  '" + line.replace('\\', '\\\\').replace("'", "\\'") + "'," for line in art)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--ts', action='store_true', help='print TypeScript rows for fastfetch.logos.ts')
    parser.add_argument('--preview', action='store_true', help='write scripts/art/preview/art.txt')
    parser.add_argument('names', nargs='*', choices=[*LOGOS, []], help='which logos (default: all)')
    args = parser.parse_args(argv)
    if MISSING is not None:
        print(f'logos: {MISSING}: pip install pillow numpy (see scripts/art/README.md)', file=sys.stderr)
        return 1
    names = args.names or list(LOGOS)
    pieces: list[str] = []
    for name in names:
        art = LOGOS[name]()
        cols, rows = size(art)
        if args.ts:
            print(f'// {name}: {cols}x{rows}\n{ts_rows(art)}\n')
        else:
            print(f'--- {name} ({cols}x{rows})')
            print('\n'.join(art))
            print()
        pieces.append(f'{name} {cols}x{rows}\n' + '\n'.join(art))
    if args.preview:
        out = Path(__file__).with_name('preview') / 'art.txt'
        out.write_text('\n%%\n'.join(pieces) + '\n')
        print(f'wrote {out}', file=sys.stderr)
    return 0


if __name__ == '__main__':
    sys.exit(main())
