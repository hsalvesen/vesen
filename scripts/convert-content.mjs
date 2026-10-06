#!/usr/bin/env node
// Converts the owner's styled documents from inline HTML spans to the {colour} markup that
// src/output/markup.ts reads (docs/plan/designs/shell-architecture.md, "Content"):
//
//   <span style="color: var(--theme-bright-blue); font-weight: bold;">x</span>  ->  {brightBlue,bold}x{/}
//
//   public/README.md         -> src/content/README.vt
//   public/history.txt       -> src/content/history.vt
//   public/linux.txt         -> src/content/linux.vt
//
// It also records the colours of every run of text in the originals, in
// tests/fixtures/content/legacy-colours.json, which src/output/markup.test.ts compares the
// converted documents against, so `cat` keeps their exact colours.
//
// It was run once, when the documents moved into the bundle, and the public/ copies were then
// deleted; it refuses to run without them. To convert a document again, put its HTML back in
// public/ and run:
//   node scripts/convert-content.mjs
// Zero dependencies.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Each document: where its HTML was served from, and where its markup goes. */
export const DOCUMENTS = [
  { source: 'public/README.md', target: 'src/content/README.vt' },
  { source: 'public/history.txt', target: 'src/content/history.vt' },
  { source: 'public/linux.txt', target: 'src/content/linux.vt' },
];

export const COLOURS_FIXTURE = 'tests/fixtures/content/legacy-colours.json';

/** The palette names markup accepts, as themes.json spells them. */
const PALETTE = new Set([
  'black', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue', 'brightPurple', 'brightCyan', 'brightWhite',
  'foreground', 'background',
]);

/** @type {Readonly<Record<string, string>>} */
const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ' };

/**
 * One run of text and the style it had: the CSS colour token (or null) and whether it was bold.
 * @typedef {[colour: string | null, bold: boolean, text: string]} Run
 */

/**
 * Reads one span's style attribute: its theme colour and weight. Anything else fails, so a
 * document with styles the markup cannot express is never converted silently.
 * @param {string} style
 * @returns {{ colour: string | null, bold: boolean }}
 */
export function readStyle(style) {
  let colour = null;
  let bold = false;
  for (const declaration of style.split(';')) {
    const [property = '', ...rest] = declaration.split(':');
    const name = property.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (name === '') continue;
    if (name === 'color') {
      const match = /^var\(--theme-([a-z-]+)\)$/.exec(value);
      const key = match?.[1]?.replace(/-([a-z])/g, (_all, c) => String(c).toUpperCase());
      if (key === undefined || !PALETTE.has(key)) throw new Error(`unsupported colour: ${value}`);
      colour = key;
    } else if (name === 'font-weight' && value === 'bold') {
      bold = true;
    } else if (name === 'font-size' && value === '1em') {
      // The size the text has anyway.
    } else {
      throw new Error(`unsupported style: ${declaration.trim()}`);
    }
  }
  return { colour, bold };
}

/** @param {string} text */
function decodeEntities(text) {
  return text.replace(/&(?:lt|gt|amp|quot|#39|nbsp);/g, (entity) => ENTITIES[entity] ?? entity);
}

/**
 * Splits a document into runs of text with the style each was drawn in. Spans may nest, as the
 * browser draws them: a span's colour and weight apply until it closes, and an inner span's
 * override them. A stray `</span>` closes nothing and is ignored, as browsers ignore it. No other
 * tag may appear.
 * @param {string} html
 * @returns {{ colour: string | null, bold: boolean, text: string }[]}
 */
export function htmlRuns(html) {
  /** @type {{ colour: string | null, bold: boolean, text: string }[]} */
  const runs = [];
  /** The styles in force, innermost last. @type {{ colour: string | null, bold: boolean }[]} */
  const open = [];
  const current = () => open[open.length - 1] ?? { colour: null, bold: false };
  let at = 0;
  for (const match of html.matchAll(/<\/?[a-zA-Z][^>]*>/g)) {
    const text = decodeEntities(html.slice(at, match.index));
    if (text !== '') runs.push({ ...current(), text });
    at = match.index + match[0].length;
    const tag = match[0];
    if (tag === '</span>') {
      open.pop();
      continue;
    }
    const span = /^<span style="([^"]*)">$/.exec(tag);
    if (span === null) throw new Error(`unsupported tag ${tag} at offset ${match.index}`);
    const own = readStyle(span[1] ?? '');
    const parent = current();
    open.push({ colour: own.colour ?? parent.colour, bold: own.bold || parent.bold });
  }
  const rest = decodeEntities(html.slice(at));
  if (rest !== '') runs.push({ ...current(), text: rest });
  return runs;
}

/**
 * The document as markup: each styled run in a tag, and every literal `{` doubled.
 * @param {string} html
 */
export function htmlToMarkup(html) {
  return htmlRuns(html)
    .map(({ colour, bold, text }) => {
      const escaped = text.replace(/\{/g, '{{');
      const names = [...(colour === null ? [] : [colour]), ...(bold ? ['bold'] : [])];
      return names.length === 0 ? escaped : `{${names.join(',')}}${escaped}{/}`;
    })
    .join('');
}

/**
 * The colour of every run, as the page drew it: `var(--theme-x)` or null, bold, and the text.
 * Neighbouring runs with the same look are merged, so the record does not depend on how the
 * spans happened to be split.
 * @param {string} html
 * @returns {Run[]}
 */
export function colourRuns(html) {
  /** @type {Run[]} */
  const runs = [];
  for (const { colour, bold, text } of htmlRuns(html)) {
    const token = colour === null ? null : `var(--theme-${colour.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)})`;
    const last = runs[runs.length - 1];
    if (last !== undefined && last[0] === token && last[1] === bold) last[2] += text;
    else runs.push([token, bold, text]);
  }
  return runs;
}

function main() {
  const missing = DOCUMENTS.filter(({ source }) => !existsSync(join(ROOT, source)));
  if (missing.length > 0) {
    console.error(
      `convert-content: ${missing.map(({ source }) => source).join(', ')} not found.\n` +
        'The documents were converted once and now live in src/content; edit the .vt files there.',
    );
    process.exit(1);
  }
  /** @type {Record<string, Run[]>} */
  const fixture = {};
  for (const { source, target } of DOCUMENTS) {
    const html = readFileSync(join(ROOT, source), 'utf8');
    const markup = htmlToMarkup(html);
    mkdirSync(dirname(join(ROOT, target)), { recursive: true });
    writeFileSync(join(ROOT, target), markup);
    fixture[target] = colourRuns(html);
    console.log(`convert-content: ${source} -> ${target} (${markup.length} characters)`);
  }
  mkdirSync(dirname(join(ROOT, COLOURS_FIXTURE)), { recursive: true });
  // One run per line, so a change to a document reads as a small diff.
  const body = Object.entries(fixture)
    .map(([file, runs]) => `  ${JSON.stringify(file)}: [\n${runs.map((run) => `    ${JSON.stringify(run)}`).join(',\n')}\n  ]`)
    .join(',\n');
  writeFileSync(join(ROOT, COLOURS_FIXTURE), `{\n${body}\n}\n`);
  console.log(`convert-content: colours recorded in ${COLOURS_FIXTURE}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
