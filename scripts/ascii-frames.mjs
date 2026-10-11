#!/usr/bin/env node
// Writes the frames file sudo's show plays in place of its drawn dancer (the format is in
// src/lib/frames.ts; src/commands/lib/rick.ts says where the app looks for it) from a folder of
// PNG frames. Each image is decoded in Playwright's Chromium (as og.mjs and theme-screenshots.mjs
// drive it: `npx playwright install chromium`), its pixels box-averaged over a grid of cells, and
// each cell's luminance mapped to a character of a dark-to-light ramp, one row of characters per
// row of cells. Cells are half as wide as they are tall, as the terminal's font draws them.
//
// The frames come out of a video with ffmpeg, twelve a second, 240 px wide:
//
//   ffmpeg -i video.mp4 -vf fps=12,scale=240:-1 frames/%05d.png
//   node scripts/ascii-frames.mjs frames/ --width 60 --fps 12 --out public/audio/incident-report.frames
//
//   --width N   columns of characters a frame is (60); the rows follow from the image's shape
//   --fps N     frames a second, written into the header (12): ffmpeg's fps=, divided by --every
//   --every N   keep every Nth frame (1): 2 halves the file, and the fps to write
//   --invert    the ramp the other way, for frames meant for a light theme
//   --out PATH  where to write (public/audio/incident-report.frames)
//
// The video, the images and the frames file they make are the owner's: this project ships none,
// and the app plays its drawn dancer where the file is missing or malformed.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_WIDTH = 60;
export const DEFAULT_FPS = 12;
export const DEFAULT_OUT = 'public/audio/incident-report.frames';
/** A cell's width over its height in the terminal's font: a cell covers a block of pixels twice as tall as wide. */
export const CELL_ASPECT = 0.5;
/** Dark to light: the terminal's foreground is light on a dark background. */
export const RAMP = ' .:-=+*#%@';

/**
 * Reads the command line.
 * @param {readonly string[]} argv the arguments after the script's name
 * @returns {{ dir: string, width: number, fps: number, every: number, invert: boolean, out: string }}
 */
export function parseArgs(argv) {
  const options = { dir: '', width: DEFAULT_WIDTH, fps: DEFAULT_FPS, every: 1, invert: false, out: DEFAULT_OUT };
  /** @param {string} name @param {string | undefined} raw @param {number} min */
  const number = (name, raw, min) => {
    const value = Number(raw);
    if (raw === undefined || !/^\d+(?:\.\d+)?$/.test(raw) || !Number.isFinite(value) || value < min) throw new Error(`ascii-frames: ${name} needs a number of at least ${min}`);
    return value;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--width') options.width = Math.floor(number(arg, argv[++i], 1));
    else if (arg === '--fps') options.fps = number(arg, argv[++i], 0.1);
    else if (arg === '--every') options.every = Math.floor(number(arg, argv[++i], 1));
    else if (arg === '--invert') options.invert = true;
    else if (arg === '--out') {
      const out = argv[++i];
      if (out === undefined || out === '') throw new Error('ascii-frames: --out needs a path');
      options.out = out;
    } else if (arg.startsWith('--')) throw new Error(`ascii-frames: unknown option ${arg}`);
    else if (options.dir === '') options.dir = arg;
    else throw new Error(`ascii-frames: one folder of frames, not ${arg}`);
  }
  if (options.dir === '') throw new Error('ascii-frames: a folder of PNG frames is required');
  if (options.width > 400) throw new Error('ascii-frames: --width is at most 400');
  return options;
}

/**
 * The grid for an image: `cols` across, and the rows that keep the image's shape with cells of
 * the given aspect, at least one.
 * @param {number} width @param {number} height @param {number} cols @param {number} aspect
 */
export function gridSize(width, height, cols, aspect = CELL_ASPECT) {
  const rows = Math.max(1, Math.round((height / Math.max(1, width)) * cols * aspect));
  return { cols, rows: Math.min(rows, 200) };
}

/**
 * The mean luminance, 0 to 1, of each cell of a cols × rows grid over an RGBA bitmap, transparent
 * pixels counting as dark. Self-contained: it also runs inside the browser page, so it may use
 * nothing from outside itself.
 * @param {ArrayLike<number>} data RGBA bytes, row by row
 * @param {number} width @param {number} height @param {number} cols @param {number} rows
 * @returns {number[]} rows × cols values, row by row
 */
export function sampleCells(data, width, height, cols, rows) {
  const out = new Array(cols * rows).fill(0);
  for (let r = 0; r < rows; r += 1) {
    const y0 = Math.floor((r * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((r + 1) * height) / rows));
    for (let c = 0; c < cols; c += 1) {
      const x0 = Math.floor((c * width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * width) / cols));
      let sum = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < height; y += 1) {
        for (let x = x0; x < x1 && x < width; x += 1) {
          const i = (y * width + x) * 4;
          const alpha = (data[i + 3] ?? 0) / 255;
          sum += ((0.2126 * (data[i] ?? 0) + 0.7152 * (data[i + 1] ?? 0) + 0.0722 * (data[i + 2] ?? 0)) / 255) * alpha;
          n += 1;
        }
      }
      out[r * cols + c] = n === 0 ? 0 : sum / n;
    }
  }
  return out;
}

/**
 * The character for a luminance: the ramp's darkest for 0, lightest for 1, the other way round
 * when inverted.
 * @param {number} value @param {string} ramp @param {boolean} invert
 */
export function rampChar(value, ramp = RAMP, invert = false) {
  const level = Math.min(1, Math.max(0, invert ? 1 - value : value));
  const chars = Array.from(ramp);
  return chars[Math.round(level * (chars.length - 1))] ?? ' ';
}

/**
 * The rows of a frame from its cells.
 * @param {readonly number[]} cells @param {number} cols @param {number} rows
 * @param {{ ramp?: string, invert?: boolean }} options
 * @returns {string[]}
 */
export function cellsToLines(cells, cols, rows, { ramp = RAMP, invert = false } = {}) {
  const lines = [];
  for (let r = 0; r < rows; r += 1) {
    let line = '';
    for (let c = 0; c < cols; c += 1) line += rampChar(cells[r * cols + c] ?? 0, ramp, invert);
    lines.push(line);
  }
  return lines;
}

/**
 * The file's text: the header, then the frames, with `===` between them.
 * @param {readonly (readonly string[])[]} frames each frame's rows
 * @param {number} fps @param {number} cols @param {number} rows
 */
export function framesFile(frames, fps, cols, rows) {
  const header = `vesen-frames fps=${fps} cols=${cols} rows=${rows}`;
  return `${header}\n${frames.map((lines) => lines.join('\n')).join('\n===\n')}\n`;
}

/** The PNG frames in a folder, in name order, every Nth. @param {string} dir @param {number} every */
export function frameFiles(dir, every) {
  return readdirSync(dir)
    .filter((name) => /\.png$/i.test(name))
    .sort()
    .filter((_, index) => index % every === 0)
    .map((name) => join(dir, name));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const dir = resolve(options.dir);
  const files = frameFiles(dir, options.every);
  if (files.length === 0) throw new Error(`ascii-frames: no PNG frames in ${dir}`);
  const out = resolve(ROOT, options.out);

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    /** @type {string[][]} */
    const frames = [];
    /** @type {{ cols: number, rows: number } | null} */
    let grid = null;
    for (const [index, file] of files.entries()) {
      const dataUrl = `data:image/png;base64,${readFileSync(file).toString('base64')}`;
      /** @type {{ width: number, height: number, rows: number, cells: number[] }} */
      const sampled = await page.evaluate(
        async ({ src, cols, aspect, sampler, rows }) => {
          const sample = new Function(`return ${sampler}`)();
          const img = new Image();
          img.src = src;
          await img.decode();
          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          const context = canvas.getContext('2d');
          if (context === null) throw new Error('no 2d canvas');
          context.drawImage(img, 0, 0);
          const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
          const gridRows = rows ?? Math.min(200, Math.max(1, Math.round((canvas.height / Math.max(1, canvas.width)) * cols * aspect)));
          return { width: canvas.width, height: canvas.height, rows: gridRows, cells: sample(data, canvas.width, canvas.height, cols, gridRows) };
        },
        { src: dataUrl, cols: options.width, aspect: CELL_ASPECT, sampler: sampleCells.toString(), rows: grid?.rows ?? null },
      );
      // The first frame sets the grid (gridSize's rule, run in the page); the rest keep it.
      grid ??= { cols: options.width, rows: sampled.rows };
      frames.push(cellsToLines(sampled.cells, options.width, grid.rows, { invert: options.invert }));
      if ((index + 1) % 100 === 0) console.log(`ascii-frames: ${index + 1} of ${files.length} frames`);
    }
    if (grid === null) throw new Error('ascii-frames: nothing sampled');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, framesFile(frames, options.fps, options.width, grid.rows));
    console.log(`ascii-frames: wrote ${out} (${frames.length} frames of ${options.width}x${grid.rows} at ${options.fps} fps)`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
