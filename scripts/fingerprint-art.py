#!/usr/bin/env python3
"""Draws the fingerprint sudo's show asks a touch screen's thumb on (src/commands/lib/fingerprint.ts)
in the letters of the banner's figlet Roman: `888` stems, `d88P` and `Y88b` for strokes that
slant, `.oooo.` along the top of a ridge and `'""'` along its foot. vesen's own: the ridges are
the level lines of a field made here, a loop like a thumb's, and nothing is traced.

The field is the distance to the loop's spine, a curve from the core down and out to the lower
left past the edge, so the ridges wrap round the core and run off towards the lower left, as a
loop's do; a little wander keeps them from being too even. Ridges are PITCH columns apart across
and VPITCH rows apart down (a row is about twice as tall as a column is wide). A ridge running
across is drawn on the one row its centre line crosses, low in the cell as o and high as ";
where it slants or stands, every cell within HALF em of its centre line is ink, and each row's
run of ink is drawn as the banner draws a stroke. The egg's outline cuts off the ridges, and the
first two rows, where it clips the outermost ones into scraps, are left out.

  python3 scripts/fingerprint-art.py          prints the rows, to paste into fingerprint.ts
"""
from __future__ import annotations

import math

COLS, ROWS = 52, 36
PITCH, VPITCH = 5.0, 2.0
HALF = 0.82
CW, CH = 0.585, 1.15
CX, CY = COLS / 2, ROWS / 2
CORE = (CX + 3, CY - ROWS * 0.13)


def bezier(t: float, p0: tuple[float, float], p1: tuple[float, float], p2: tuple[float, float]) -> tuple[float, float]:
    return (
        (1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
        (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1],
    )


# The loop's spine: from the core, down, then out to the lower left past the edge.
SPINE = [bezier(i / 200, CORE, (CORE[0] - COLS * 0.05, CORE[1] + ROWS * 0.24), (CORE[0] - COLS * 0.92, CORE[1] + ROWS * 0.78)) for i in range(201)]


def spine_distance(x: float, y: float) -> float:
    """How far (x, y) is from the spine, in ridges."""
    best = math.inf
    for (ax, ay), (bx, by) in zip(SPINE, SPINE[1:]):
        ux, uy = (bx - ax) / PITCH, (by - ay) / VPITCH
        px, py = (x - ax) / PITCH, (y - ay) / VPITCH
        length = ux * ux + uy * uy
        t = 0.0 if length == 0 else max(0.0, min(1.0, (px * ux + py * uy) / length))
        dx, dy = px - t * ux, py - t * uy
        best = min(best, dx * dx + dy * dy)
    return math.sqrt(best)


def field(x: float, y: float) -> float:
    """The ridge field: a ridge's centre line wherever it is a whole number."""
    u, v = (x - CORE[0]) / PITCH, (y - CORE[1]) / VPITCH
    wander = 0.10 * math.sin(0.9 * u + 0.7 * v) + 0.07 * math.sin(1.9 * v - 0.5 * u)
    return spine_distance(x, y) + 0.5 + wander


def inside(x: float, y: float) -> bool:
    """A thumb's outline: an egg, a little wider above its middle."""
    dx, dy = (x - CX) / (COLS / 2 * 0.97), (y - CY) / (ROWS / 2 * 0.98)
    return (dx / (1 - 0.10 * dy)) ** 2 + dy**2 <= 1


def gradient(x: float, y: float) -> tuple[float, float]:
    e = 0.05
    return (field(x + e, y) - field(x - e, y)) / (2 * e), (field(x, y + e) - field(x, y - e)) / (2 * e)


def slant(x: float, y: float) -> float:
    """The ridge's direction as it looks on the screen, in degrees: 0 across, 90 upright, positive rising to the right."""
    gx, gy = gradient(x, y)
    angle = math.degrees(math.atan2(-gx * 2.0, -gy))
    if angle < -90:
        angle += 180
    if angle > 90:
        angle -= 180
    return angle


def kinds() -> list[list[str | None]]:
    """What each cell holds: a ridge across, low or high in it, or one that rises, falls or stands."""
    grid: list[list[str | None]] = [[None] * COLS for _ in range(ROWS)]
    for r in range(ROWS):
        for c in range(COLS):
            x, y = c + 0.5, r + 0.5
            if not inside(x, y) or field(x, y) < 0.9:
                continue
            angle = slant(x, y)
            if abs(angle) < 22:
                top, foot = field(x, r), field(x, r + 1.0)
                k = math.floor(max(top, foot))
                if min(top, foot) < k <= max(top, foot) and k >= 1:
                    grid[r][c] = 'low' if (k - top) / (foot - top) > 0.5 else 'high'
                continue
            gx, gy = gradient(x, y)
            g = math.hypot(gx / CW, gy / CH) or 1e-9
            f = field(x, y)
            if abs(f - round(f)) / g < HALF:
                grid[r][c] = 'stands' if abs(angle) > 62 else 'rises' if angle > 0 else 'falls'
    return grid


def stroke(kind: str, n: int) -> str:
    """A run of n cells of one kind, as the banner's Roman draws it."""
    if kind == 'stands':
        return '8' * n
    if kind == 'rises':
        return '8' if n == 1 else 'dP' if n == 2 else 'd' + '8' * (n - 2) + 'P'
    if kind == 'falls':
        return '8' if n == 1 else 'Yb' if n == 2 else 'Y' + '8' * (n - 2) + 'b'
    if kind == 'low':
        return 'o' * n if n < 3 else '.' + 'o' * (n - 2) + '.'
    return '"' * n if n < 3 else "'" + '"' * (n - 2) + "'"


def art() -> list[str]:
    grid = kinds()
    rows = []
    for line in grid:
        out = [' '] * COLS
        c = 0
        while c < COLS:
            kind = line[c]
            if kind is None:
                c += 1
                continue
            end = c
            while end + 1 < COLS and line[end + 1] == kind:
                end += 1
            for i, ch in enumerate(stroke(kind, end - c + 1)):
                out[c + i] = ch
            c = end + 1
        rows.append(''.join(out).rstrip())
    while rows and not rows[0].strip():
        rows.pop(0)
    while rows and not rows[-1].strip():
        rows.pop()
    rows = rows[2:]
    indent = min(len(row) - len(row.lstrip()) for row in rows if row.strip())
    return [row[indent:] for row in rows]


if __name__ == '__main__':
    print('\n'.join(art()))
