#!/usr/bin/env node
// Every character the source could put on the screen must be one the terminal's font draws.
// Vesen Mono (public/fonts/VesenMono.woff2) is a subset; a code point it lacks falls back to
// another font and looks wrong: a different weight or width, or an emoji. This reads the font's
// code points from scripts/fonts/glyphs.json (written by scripts/fonts/build-vesen-mono.py, with
// the font's SHA-256 so a rebuilt font with a stale list fails here), scans the source and the
// static pages, and fails listing every non-ASCII character the font lacks, with its file and
// line. Characters the font is not meant to draw are allowed by name in ALLOWED, each with why.
// Zero dependencies; run with `npm run check:glyphs`.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The list the font build writes: the code points the shipped font maps to a glyph. */
export const GLYPHS_PATH = 'scripts/fonts/glyphs.json';

/** Folders scanned for every .ts, .svelte and .css file, test files and snapshots left out. */
export const SCANNED_DIRS = ['src'];
export const SCANNED_EXTENSIONS = ['.ts', '.svelte', '.css'];
/** The static pages, which use the same font. */
export const SCANNED_FILES = ['index.html', 'public/404.html', 'public/probe/index.html'];
const TEST_FILE = /\.test\.[^/]+$/;
const SKIPPED_DIRS = new Set(['__snapshots__', 'node_modules']);

/**
 * Characters the terminal font does not draw, on purpose. Each is matched on input, stripped
 * before anything reaches the screen, drawn on a canvas, or used only by tests, so the font
 * never needs it. Anything else outside ASCII that the font lacks fails the check.
 * @type {readonly { from: number, to: number, why: string }[]}
 */
export const ALLOWED = [
  { from: 0x02bb, to: 0x02bc, why: 'the okina and modifier apostrophe are folded out of place searches (services/weather/places.ts)' },
  { from: 0x0300, to: 0x036f, why: 'combining marks are stripped from figlet input (commands/lib/block-font.ts)' },
  { from: 0x200e, to: 0x200f, why: 'bidirectional marks are removed from upstream text (lib/upstream-text.ts)' },
  { from: 0x2012, to: 0x2012, why: 'the figure dash is folded out of place searches (services/weather/places.ts)' },
  { from: 0x201f, to: 0x201f, why: 'a smart quote made plain as it is typed (shell/editor/normalize.ts)' },
  { from: 0x202a, to: 0x202e, why: 'bidirectional overrides are removed from upstream text (lib/upstream-text.ts)' },
  { from: 0x202f, to: 0x202f, why: 'the narrow no-break space is made plain as it is typed (shell/editor/normalize.ts)' },
  { from: 0x2038, to: 0x2038, why: 'the caret marks the cursor in test lines (src/testing/completion-env.ts)' },
  { from: 0x2066, to: 0x2069, why: 'bidirectional isolates are removed from upstream text (lib/upstream-text.ts)' },
  { from: 0xff66, to: 0xff9d, why: "half-width katakana: cmatrix's rain, drawn on a canvas where the fallback font is meant (commands/lib/matrix.ts)" },
];

/**
 * @typedef {{ font: string, sha256: string, count: number, ranges: readonly (readonly [number, number])[] }} GlyphList
 * @typedef {{ line: number, char: string, codePoint: number }} Missing
 */

/**
 * Whether the font draws a code point, from its list of inclusive ranges.
 * @param {GlyphList['ranges']} ranges
 * @returns {(codePoint: number) => boolean}
 */
export function coverage(ranges) {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  return (codePoint) => {
    let low = 0;
    let high = sorted.length - 1;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const range = sorted[middle] ?? [0, -1];
      if (codePoint < range[0]) high = middle - 1;
      else if (codePoint > range[1]) low = middle + 1;
      else return true;
    }
    return false;
  };
}

/** @param {number} codePoint */
export function isAllowed(codePoint) {
  return ALLOWED.some((entry) => codePoint >= entry.from && codePoint <= entry.to);
}

/**
 * The non-ASCII characters in `text` the font lacks and the allowlist does not cover, each once
 * per line, in order.
 * @param {string} text
 * @param {(codePoint: number) => boolean} drawn
 * @returns {Missing[]}
 */
export function findMissing(text, drawn) {
  /** @type {Missing[]} */
  const missing = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const seen = new Set();
    for (const char of lines[i] ?? '') {
      const codePoint = char.codePointAt(0) ?? 0;
      if (codePoint < 0x80 || seen.has(codePoint) || drawn(codePoint) || isAllowed(codePoint)) continue;
      seen.add(codePoint);
      missing.push({ line: i + 1, char, codePoint });
    }
  }
  return missing;
}

/** @param {number} codePoint */
export function describe(codePoint) {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

/**
 * @param {string} dir absolute
 * @returns {string[]} every file under it, test files and snapshots left out
 */
function walk(dir) {
  /** @type {string[]} */
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!SKIPPED_DIRS.has(name)) files.push(...walk(path));
    } else if (SCANNED_EXTENSIONS.some((extension) => name.endsWith(extension)) && !TEST_FILE.test(name)) {
      files.push(path);
    }
  }
  return files;
}

/** @param {string} root */
export function scannedFiles(root) {
  const files = SCANNED_DIRS.flatMap((dir) => walk(join(root, dir)));
  for (const file of SCANNED_FILES) if (existsSync(join(root, file))) files.push(join(root, file));
  return files;
}

/**
 * Reads the glyph list and checks it describes the font that is shipped.
 * @param {string} root
 * @returns {{ list: GlyphList, problem: string | null }}
 */
export function loadGlyphs(root) {
  const list = /** @type {GlyphList} */ (JSON.parse(readFileSync(join(root, GLYPHS_PATH), 'utf8')));
  const fontPath = join(root, list.font);
  if (!existsSync(fontPath)) return { list, problem: `${GLYPHS_PATH} names ${list.font}, which does not exist` };
  const sha256 = createHash('sha256').update(readFileSync(fontPath)).digest('hex');
  if (sha256 !== list.sha256) {
    return { list, problem: `${list.font} is not the font ${GLYPHS_PATH} describes: run python3 scripts/fonts/build-vesen-mono.py --list and commit the list` };
  }
  return { list, problem: null };
}

/**
 * Every character the font lacks, over the whole repository: `path:line U+XXXX 'c'`.
 * @param {string} root
 * @returns {{ failures: string[], scanned: number }}
 */
export function scanRepo(root) {
  const { list, problem } = loadGlyphs(root);
  if (problem !== null) return { failures: [problem], scanned: 0 };
  const drawn = coverage(list.ranges);
  /** @type {string[]} */
  const failures = [];
  const files = scannedFiles(root);
  for (const file of files) {
    const repoPath = relative(root, file).split(sep).join('/');
    for (const { line, char, codePoint } of findMissing(readFileSync(file, 'utf8'), drawn)) {
      failures.push(`${repoPath}:${line} ${describe(codePoint)} '${char}'`);
    }
  }
  return { failures, scanned: files.length };
}

function main() {
  const { failures, scanned } = scanRepo(ROOT);
  if (failures.length > 0) {
    console.error(`check-glyphs: ${failures.length} character(s) the terminal font does not draw\n`);
    for (const failure of failures) console.error(`  ${failure}`);
    console.error('\nUse a glyph the font has (→ × ▾ ● ○ ▣ … are), a word, or an inline SVG icon in the component;');
    console.error('a character that never reaches the screen goes in ALLOWED in scripts/check-glyphs.mjs, with why.');
    process.exit(1);
  }
  console.log(`check-glyphs: ok (${scanned} file(s) scanned against the code points of Vesen Mono)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
