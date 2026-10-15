#!/usr/bin/env python3
"""Builds an animated GIF from still frames, for docs/themes/themes.gif where ffmpeg is not
installed (scripts/theme-screenshots.mjs calls it then). Each frame is scaled to WIDTH, given its
own 256 colours without dithering, so text stays crisp, and shown for SECONDS; the GIF loops.

A plain median cut spends a frame's colours on what covers most of it, the background's gradient
and scanlines, and merges the small swatches of a theme's sixteen colours into a few greys. So
the median cut only seeds the palette: k-means then moves each colour to the middle of the pixels
nearest it, counting the saturated ones more, and every pixel takes the colour nearest it.

  python3 scripts/gif.py OUT.gif SECONDS WIDTH FRAME.png...

Needs Pillow and numpy (pip install pillow numpy).
"""
from __future__ import annotations

import sys

import numpy as np
from PIL import Image

COLOURS = 256
ROUNDS = 16
# How much more a saturated colour counts than a grey one: (FLOOR + chroma) ** CHROMA_WEIGHT.
CHROMA_WEIGHT = 2
FLOOR = 0.05


def nearest(points: np.ndarray, centres: np.ndarray) -> np.ndarray:
    """The index of the centre nearest each point, in chunks to keep the distances small."""
    best = np.empty(len(points), dtype=np.int64)
    for start in range(0, len(points), 4096):
        chunk = points[start : start + 4096]
        best[start : start + 4096] = ((chunk[:, None, :] - centres[None, :, :]) ** 2).sum(axis=2).argmin(axis=1)
    return best


def quantise(frame: Image.Image) -> Image.Image:
    """The frame in COLOURS colours of its own (mode P)."""
    rgb = np.asarray(frame, dtype=np.uint8).reshape(-1, 3).astype(np.uint32)
    packed = (rgb[:, 0] << 16) | (rgb[:, 1] << 8) | rgb[:, 2]
    unique, inverse, counts = np.unique(packed, return_inverse=True, return_counts=True)
    points = np.stack([(unique >> 16) & 255, (unique >> 8) & 255, unique & 255], axis=1).astype(np.float64)
    chroma = (points.max(axis=1) - points.min(axis=1)) / 255
    weights = counts * (FLOOR + chroma) ** CHROMA_WEIGHT
    seed = frame.quantize(colors=COLOURS, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    centres = np.array(seed.getpalette()[: 3 * COLOURS], dtype=np.float64).reshape(-1, 3)
    for _ in range(ROUNDS):
        near = nearest(points, centres)
        sums = np.zeros_like(centres)
        np.add.at(sums, near, points * weights[:, None])
        totals = np.bincount(near, weights=weights, minlength=len(centres))
        used = totals > 0
        centres[used] = sums[used] / totals[used, None]
    index = nearest(points, centres)[inverse.ravel()].astype(np.uint8)
    out = Image.frombytes('P', frame.size, index.tobytes())
    out.putpalette(np.clip(np.rint(centres), 0, 255).astype(np.uint8).ravel().tolist())
    return out


def main(argv: list[str]) -> int:
    if len(argv) < 4:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    out, seconds, width, *paths = argv
    frames = []
    for path in paths:
        with Image.open(path) as image:
            rgb = image.convert('RGB')
            height = round(rgb.height * int(width) / rgb.width)
            frames.append(quantise(rgb.resize((int(width), height), Image.Resampling.LANCZOS)))
    first, *rest = frames
    first.save(out, save_all=True, append_images=rest, duration=round(float(seconds) * 1000), loop=0, optimize=True, disposal=1)
    print(f'gif: wrote {out}, {len(frames)} frames')
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
