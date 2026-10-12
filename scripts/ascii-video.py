#!/usr/bin/env python3
"""Writes the frames file sudo's show plays (the format is in src/lib/frames.ts; src/commands/lib/rick.ts
says where the app looks for it) straight from a video, with no folder of PNGs in between:
OpenCV decodes the video, numpy box-averages each frame over a grid of cells (a cell covers a block
of pixels twice as tall as wide, as the terminal's font draws them) and maps each cell's luminance
to a character of a dark-to-light ramp. scripts/ascii-frames.mjs does the same from PNG frames.

The tones are stretched so the scene fills the ramp: each frame's 1st and 99th percentiles set the
black and white points, eased over about half a second so cuts land cleanly and a steady shot does
not flicker, then a gamma lifts the midtones. Rows have their trailing spaces cut (the app pads them
back), which is most of a dark frame.

  python3 scripts/ascii-video.py video.mp4 --width 120 --fps 15 --out public/audio/incident-report.frames

  --width N   columns of characters a frame is (120); the rows follow from the video's shape
  --fps N     frames a second to keep (15): source frames are picked nearest to each instant
  --fit S     write the frame rate that makes the frames last S seconds, so they loop with a
              track of that length (the show starts them together and keeps them to it)
  --gamma G   midtone lift, below 1 brightens (0.85)
  --invert    the ramp the other way, for frames meant for a light theme
  --out PATH  where to write (public/audio/incident-report.frames)

Needs opencv-python and numpy (pip install opencv-python numpy).
"""
from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

import cv2
import numpy as np

DEFAULT_WIDTH = 120
DEFAULT_FPS = 15.0
DEFAULT_GAMMA = 0.85
DEFAULT_OUT = "public/audio/incident-report.frames"
# A cell's width over its height in the terminal's font.
CELL_ASPECT = 0.5
# Dark to light: the terminal's foreground is light on a dark background. Twenty steps, each a
# little more ink than the last.
RAMP = " .'`,:;-~=+*xoe%#&$@"
# The caps src/lib/frames.ts reads with.
MAX_COLS, MAX_ROWS, MAX_FRAMES, MAX_CHARS = 400, 200, 10_000, 32 * 1024 * 1024
# How far each frame moves the black and white points towards its own: 0.2 a frame is about half
# a second at 15 fps.
EASE = 0.2
# The least spread between the black and white points, so a flat scene does not blow up its noise.
MIN_SPREAD = 48.0


def grid_size(width: int, height: int, cols: int) -> tuple[int, int]:
    rows = max(1, round(height / max(1, width) * cols * CELL_ASPECT))
    return cols, min(rows, MAX_ROWS)


def luminance(bgr: np.ndarray) -> np.ndarray:
    """Rec. 709 luminance of a BGR frame, 0 to 255, as float32."""
    b, g, r = bgr[:, :, 0], bgr[:, :, 1], bgr[:, :, 2]
    return (0.2126 * r + 0.7152 * g + 0.0722 * b).astype(np.float32)


def frame_lines(cells: np.ndarray, black: float, white: float, gamma: float, ramp: np.ndarray) -> list[str]:
    """The rows of a frame from its cells' luminance and the tone points."""
    level = np.clip((cells - black) / max(white - black, 1e-6), 0.0, 1.0) ** gamma
    index = np.rint(level * (len(ramp) - 1)).astype(np.intp)
    return [row.tobytes().decode("ascii").rstrip() for row in ramp[index]]


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("video", help="the video to trace")
    parser.add_argument("--width", type=int, default=DEFAULT_WIDTH)
    parser.add_argument("--fps", type=float, default=DEFAULT_FPS)
    parser.add_argument("--fit", type=float, default=None, metavar="SECONDS")
    parser.add_argument("--gamma", type=float, default=DEFAULT_GAMMA)
    parser.add_argument("--invert", action="store_true")
    parser.add_argument("--out", default=DEFAULT_OUT)
    args = parser.parse_args(argv)
    if not 1 <= args.width <= MAX_COLS:
        parser.error(f"--width is 1 to {MAX_COLS}")
    if not 0.1 <= args.fps <= 120:
        parser.error("--fps is 0.1 to 120")
    if args.fit is not None and args.fit <= 0:
        parser.error("--fit is a length in seconds")

    capture = cv2.VideoCapture(args.video)
    if not capture.isOpened():
        print(f"ascii-video: cannot open {args.video}", file=sys.stderr)
        return 1
    source_fps = capture.get(cv2.CAP_PROP_FPS) or 25.0
    width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cols, rows = grid_size(width, height, args.width)
    ramp = np.frombuffer((RAMP[::-1] if args.invert else RAMP).encode("ascii"), dtype=np.uint8)

    started = time.time()
    frames: list[str] = []
    black = white = None
    source_index = 0
    wanted = 0  # the next output frame's index; its instant is wanted / fps
    while len(frames) < MAX_FRAMES:
        ok, bgr = capture.read()
        if not ok:
            break
        # The source frame nearest to the instant each output frame falls on.
        while round(wanted / args.fps * source_fps) == source_index:
            cells = cv2.resize(luminance(bgr), (cols, rows), interpolation=cv2.INTER_AREA)
            low, high = np.percentile(cells, [1, 99])
            high = max(high, low + MIN_SPREAD)
            if black is None:
                black, white = float(low), float(high)
            else:
                black += (float(low) - black) * EASE
                white += (float(high) - white) * EASE
            frames.append("\n".join(frame_lines(cells, black, white, args.gamma, ramp)))
            wanted += 1
        source_index += 1
    capture.release()
    if not frames:
        print("ascii-video: no frames decoded", file=sys.stderr)
        return 1

    # Fitted to a track: the rate that spreads these frames over its length, to four decimals.
    fps = round(len(frames) / args.fit, 4) if args.fit is not None else args.fps
    if not 0.1 <= fps <= 120:
        print(f"ascii-video: a rate of {fps} fps is outside the app's 0.1 to 120", file=sys.stderr)
        return 1
    fps_text = f"{fps:g}"
    text = f"vesen-frames fps={fps_text} cols={cols} rows={rows}\n" + "\n===\n".join(frames) + "\n"
    if len(text) > MAX_CHARS:
        print(f"ascii-video: {len(text):,} characters is over the app's cap of {MAX_CHARS:,}; use fewer columns or frames", file=sys.stderr)
        return 1
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="ascii", newline="\n")
    print(f"ascii-video: wrote {out} ({len(frames)} frames of {cols}x{rows} at {fps_text} fps, {len(text):,} characters, {time.time() - started:.1f} s)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
