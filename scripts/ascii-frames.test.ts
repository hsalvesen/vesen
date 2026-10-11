// The frames converter's pure parts, with a bitmap by hand: cells are the mean luminance of their
// block of pixels (also as the function runs inside the browser page), the ramp maps dark to
// light and the other way round when inverted, the grid keeps the image's shape with cells half
// as wide as tall, the options parse, and the file it writes is one the app's parser reads back.
// Decoding the PNGs is Chromium's part, covered by a smoke run of the script.
import { describe, expect, it } from 'vitest';
import { parseFramesFile } from '../src/lib/frames';
import { CELL_ASPECT, cellsToLines, DEFAULT_FPS, DEFAULT_OUT, DEFAULT_WIDTH, frameFiles, framesFile, gridSize, parseArgs, RAMP, rampChar, sampleCells } from './ascii-frames.mjs';

/** A 4 by 2 RGBA bitmap: black, black, white, white over mid-grey, mid-grey, white, clear. */
const PIXELS = Uint8ClampedArray.from([
  ...[0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255, 255, 255, 255],
  ...[128, 128, 128, 255, 128, 128, 128, 255, 255, 255, 255, 255, 255, 255, 255, 0],
]);

describe('sampleCells', () => {
  it('averages each cell\'s block of pixels, transparent ones counting as dark', () => {
    const cells = sampleCells(PIXELS, 4, 2, 2, 1);
    expect(cells).toHaveLength(2);
    expect(cells[0]).toBeCloseTo((0 + 0 + 128 / 255 + 128 / 255) / 4, 6);
    expect(cells[1]).toBeCloseTo((1 + 1 + 1 + 0) / 4, 6);
    // Four cells across, two down: each pixel its own cell.
    expect(sampleCells(PIXELS, 4, 2, 4, 2).map((value) => Math.round(value * 100))).toEqual([0, 0, 100, 100, 50, 50, 100, 0]);
  });

  it('weighs the channels as the eye does', () => {
    const red = sampleCells(Uint8ClampedArray.from([255, 0, 0, 255]), 1, 1, 1, 1);
    const green = sampleCells(Uint8ClampedArray.from([0, 255, 0, 255]), 1, 1, 1, 1);
    expect(green[0]).toBeGreaterThan(red[0] ?? 0);
    expect(red[0]).toBeCloseTo(0.2126, 4);
  });

  it('is self-contained, so the page can run the same code', () => {
    const inPage = new Function(`return ${sampleCells.toString()}`)() as typeof sampleCells;
    expect(inPage(PIXELS, 4, 2, 2, 1)).toEqual(sampleCells(PIXELS, 4, 2, 2, 1));
  });

  it('copes with a grid finer than the image', () => {
    const cells = sampleCells(Uint8ClampedArray.from([255, 255, 255, 255]), 1, 1, 3, 2);
    expect(cells).toHaveLength(6);
    for (const cell of cells) expect(cell).toBeCloseTo(1, 9);
  });
});

describe('the ramp', () => {
  it('runs from dark to light, and the other way round when inverted', () => {
    expect(RAMP[0]).toBe(' ');
    expect(RAMP[RAMP.length - 1]).toBe('@');
    expect(rampChar(0)).toBe(' ');
    expect(rampChar(1)).toBe('@');
    expect(rampChar(0.5)).toBe(RAMP[Math.round(0.5 * (RAMP.length - 1))]);
    expect(rampChar(0, RAMP, true)).toBe('@');
    expect(rampChar(1, RAMP, true)).toBe(' ');
    expect(rampChar(-1)).toBe(' ');
    expect(rampChar(2)).toBe('@');
    expect(rampChar(1, '.#')).toBe('#');
  });

  it('writes a row of characters for each row of cells', () => {
    const cells = sampleCells(PIXELS, 4, 2, 4, 2);
    // Mid-grey is just over half way: the fifth step of ten.
    expect(cellsToLines(cells, 4, 2)).toEqual(['  @@', '++@ ']);
    expect(cellsToLines(cells, 4, 2, { invert: true })).toEqual(['@@  ', '== @']);
  });
});

describe('gridSize', () => {
  it('keeps the image\'s shape with cells half as wide as they are tall', () => {
    expect(CELL_ASPECT).toBe(0.5);
    expect(gridSize(240, 135, 60)).toEqual({ cols: 60, rows: 17 });
    expect(gridSize(1920, 1080, 80)).toEqual({ cols: 80, rows: 23 });
    expect(gridSize(100, 1, 10)).toEqual({ cols: 10, rows: 1 });
    expect(gridSize(1, 10_000, 10)).toEqual({ cols: 10, rows: 200 });
  });
});

describe('parseArgs', () => {
  it('reads the folder and the options, with defaults', () => {
    expect(parseArgs(['frames'])).toEqual({ dir: 'frames', width: DEFAULT_WIDTH, fps: DEFAULT_FPS, every: 1, invert: false, out: DEFAULT_OUT });
    expect(DEFAULT_WIDTH).toBe(60);
    expect(DEFAULT_OUT).toBe('public/audio/incident-report.frames');
    expect(parseArgs(['--width', '40', '--fps', '6', 'frames', '--every', '2', '--invert', '--out', 'x.frames'])).toEqual({
      dir: 'frames',
      width: 40,
      fps: 6,
      every: 2,
      invert: true,
      out: 'x.frames',
    });
  });

  it('refuses what it cannot use', () => {
    expect(() => parseArgs([])).toThrow(/folder/);
    expect(() => parseArgs(['a', 'b'])).toThrow(/one folder/);
    expect(() => parseArgs(['frames', '--width'])).toThrow(/--width/);
    expect(() => parseArgs(['frames', '--width', 'wide'])).toThrow(/--width/);
    expect(() => parseArgs(['frames', '--width', '0'])).toThrow(/--width/);
    expect(() => parseArgs(['frames', '--width', '401'])).toThrow(/at most 400/);
    expect(() => parseArgs(['frames', '--every', '0'])).toThrow(/--every/);
    expect(() => parseArgs(['frames', '--out'])).toThrow(/--out/);
    expect(() => parseArgs(['frames', '--loud'])).toThrow(/unknown option/);
  });
});

describe('framesFile', () => {
  it('writes the header and the frames with === between them, which the app reads back', () => {
    const text = framesFile(
      [
        ['ab', 'cd'],
        ['ef', 'gh'],
      ],
      12,
      2,
      2,
    );
    expect(text).toBe('vesen-frames fps=12 cols=2 rows=2\nab\ncd\n===\nef\ngh\n');
    const parsed = parseFramesFile(text);
    expect(parsed).toMatchObject({ fps: 12, cols: 2, rows: 2 });
    expect(parsed?.frames.map((frame) => frame.text)).toEqual(['ab\ncd', 'ef\ngh']);
  });

  it('round-trips the bitmap', () => {
    const cells = sampleCells(PIXELS, 4, 2, 4, 2);
    const parsed = parseFramesFile(framesFile([cellsToLines(cells, 4, 2)], 1, 4, 2));
    expect(parsed?.frames[0]?.text).toBe('  @@\n++@ ');
  });
});

describe('frameFiles', () => {
  it('lists the PNGs of a folder in name order, every Nth', () => {
    const here = new URL('.', import.meta.url).pathname;
    // This folder has no PNGs: nothing, whatever the stride.
    expect(frameFiles(here, 1)).toEqual([]);
    expect(frameFiles(here, 3)).toEqual([]);
  });
});
