#!/usr/bin/env node
// Bundle budget: gzips every JS chunk in dist/assets, prints the sizes, and fails when
// the JavaScript a visitor must download before first paint exceeds the budget.
// That is the entry chunk referenced by dist/index.html plus any chunk the page
// modulepreloads alongside it. Lazy chunks are reported but not budgeted.
// Zero dependencies; run `npm run build` first, then `npm run check:bundle`.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const ASSETS = join(DIST, 'assets');

/** Initial-JS budget in kB (1 kB = 1000 bytes, as Vite reports). */
export const BUDGET_KB = 60;

/**
 * Finds the entry script and the modulepreloaded chunks named in index.html.
 * @param {string} html
 * @returns {{ entry: string | null, preloads: string[] }} asset file names
 */
export function initialChunks(html) {
  /** @param {string} tag */
  const src = (tag) => /\b(?:src|href)=["']([^"']+\.js)["']/.exec(tag)?.[1];
  let entry = null;
  /** @type {string[]} */
  const preloads = [];
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/g)) {
    const file = src(tag);
    if (!file) continue;
    if (/^<script\b/.test(tag) && /\btype=["']module["']/.test(tag)) entry ??= basename(file);
    else if (/\brel=["']modulepreload["']/.test(tag)) preloads.push(basename(file));
  }
  return { entry, preloads };
}

/**
 * The kernel's budget in kB gzip: the lazy `shell-*.js` chunk and the chunks it imports that the
 * page has not already loaded. Every line waits for it, so its growth is reported and capped.
 */
export const KERNEL_BUDGET_KB = 75;

/**
 * The chunks a chunk imports statically, by file name: `import{a}from"./x.js"`.
 * @param {string} code
 * @returns {string[]}
 */
export function staticImports(code) {
  const found = new Set();
  for (const match of code.matchAll(/\bimport\s*(?:[\w$*{}\s,]*?\s*from\s*)?["']\.\/([^"']+\.js)["']/g)) {
    if (match[1]) found.add(match[1]);
  }
  return [...found];
}

/** @param {number} bytes */
const kb = (bytes) => (bytes / 1000).toFixed(2).padStart(8);

function main() {
  const indexPath = join(DIST, 'index.html');
  if (!existsSync(indexPath) || !existsSync(ASSETS)) {
    console.error('check-bundle: dist/ is missing; run `npm run build` first.');
    process.exit(1);
  }

  const { entry, preloads } = initialChunks(readFileSync(indexPath, 'utf8'));
  if (!entry) {
    console.error('check-bundle: no <script type="module"> entry found in dist/index.html.');
    process.exit(1);
  }
  const initial = new Set([entry, ...preloads]);

  const chunks = readdirSync(ASSETS)
    .filter((name) => name.endsWith('.js'))
    .map((name) => {
      const bytes = readFileSync(join(ASSETS, name));
      return { name, raw: bytes.length, gzip: gzipSync(bytes).length };
    })
    .sort((a, b) => b.gzip - a.gzip);

  const missing = [...initial].filter((name) => !chunks.some((chunk) => chunk.name === name));
  if (missing.length > 0) {
    console.error(`check-bundle: index.html references missing chunk(s): ${missing.join(', ')}`);
    process.exit(1);
  }

  console.log('chunk'.padEnd(40) + 'raw kB'.padStart(8) + '  gzip kB'.padStart(10) + '  load');
  for (const chunk of chunks) {
    const load = chunk.name === entry ? 'entry' : initial.has(chunk.name) ? 'preload' : 'lazy';
    console.log(chunk.name.padEnd(40) + kb(chunk.raw) + kb(chunk.gzip).padStart(10) + '  ' + load);
  }

  const initialGzip = chunks.filter((chunk) => initial.has(chunk.name)).reduce((sum, chunk) => sum + chunk.gzip, 0);
  const verdict = `initial JS ${kb(initialGzip).trim()} kB gzip (budget ${BUDGET_KB} kB)`;
  if (initialGzip > BUDGET_KB * 1000) {
    console.error(`\ncheck-bundle: over budget: ${verdict}`);
    process.exit(1);
  }
  console.log(`\ncheck-bundle: ok: ${verdict}`);

  // The kernel: what the first command waits for once the page is up.
  const kernel = chunks.find((chunk) => /^shell-[\w-]+\.js$/.test(chunk.name));
  if (kernel === undefined) {
    console.error('check-bundle: no shell-*.js kernel chunk found.');
    process.exit(1);
  }
  const parts = new Set([kernel.name]);
  const queue = [kernel.name];
  while (queue.length > 0) {
    const name = queue.shift() ?? '';
    for (const imported of staticImports(readFileSync(join(ASSETS, name), 'utf8'))) {
      if (initial.has(imported) || parts.has(imported)) continue;
      parts.add(imported);
      queue.push(imported);
    }
  }
  const kernelGzip = chunks.filter((chunk) => parts.has(chunk.name)).reduce((sum, chunk) => sum + chunk.gzip, 0);
  const kernelVerdict = `kernel ${kb(kernelGzip).trim()} kB gzip in ${[...parts].join(' + ')} (budget ${KERNEL_BUDGET_KB} kB)`;
  if (kernelGzip > KERNEL_BUDGET_KB * 1000) {
    console.error(`check-bundle: over budget: ${kernelVerdict}`);
    process.exit(1);
  }
  console.log(`check-bundle: ok: ${kernelVerdict}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
