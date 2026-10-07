#!/usr/bin/env node
// Bundle budget: gzips every JS chunk in dist/assets, prints the sizes, and fails when
// the JavaScript a visitor must download before first paint exceeds the budget.
// That is the entry chunk referenced by dist/index.html plus any chunk the page
// modulepreloads alongside it. The kernel, the catalogue (the commands that load after it) and
// what stock's first quote fetches have budgets of their own; other lazy chunks are reported but
// not budgeted.
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

/**
 * The catalogue's budget in kB gzip: the specs under src/commands/more, which load together after
 * the kernel (on idle, or when a name the kernel lacks is typed) in `catalogue-*.js`, with the
 * chunks it imports that the page and the kernel have not loaded. Their bodies (`*.run.ts`) are
 * chunks of their own, fetched on a command's first run, and are not counted. Each wave of
 * commands grows it, never the kernel.
 */
export const CATALOGUE_BUDGET_KB = 40;

/** The catalogue's chunk, by name: src/commands/more/catalogue.ts. */
export const CATALOGUE_ROOT = /^catalogue-[\w-]+\.js$/;

/**
 * What `stock SYMBOL` fetches the first time, in kB gzip, beyond the page and the kernel: its
 * body, the market client and the quote card, with what they import. Plan 07 asks for 12 kB; the
 * interim provider (Yahoo through a public proxy, its normaliser and the short list of names)
 * takes it to about 18.3 until the stock Worker is deployed and the interim code goes
 * (docs/adr/0001-architecture.md, amendments). This holds it there meanwhile.
 */
export const STOCK_BUDGET_KB = 19;

/** The chunks stock's first quote loads by name: its body, the client and the card. */
export const STOCK_ROOTS = [/^stock\.run-[\w-]+\.js$/, /^client-[\w-]+\.js$/, /^QuoteCard-[\w-]+\.js$/];

/**
 * `roots` and every chunk they import statically, leaving out those in `loaded`.
 * @param {readonly string[]} roots
 * @param {ReadonlySet<string>} loaded
 * @param {(name: string) => string} read
 * @returns {Set<string>}
 */
export function closure(roots, loaded, read) {
  const parts = new Set(roots);
  const queue = [...roots];
  while (queue.length > 0) {
    const name = queue.shift() ?? '';
    for (const imported of staticImports(read(name))) {
      if (loaded.has(imported) || parts.has(imported)) continue;
      parts.add(imported);
      queue.push(imported);
    }
  }
  return parts;
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
  const read = (/** @type {string} */ name) => readFileSync(join(ASSETS, name), 'utf8');
  const parts = closure([kernel.name], initial, read);
  const kernelGzip = chunks.filter((chunk) => parts.has(chunk.name)).reduce((sum, chunk) => sum + chunk.gzip, 0);
  const kernelVerdict = `kernel ${kb(kernelGzip).trim()} kB gzip in ${[...parts].join(' + ')} (budget ${KERNEL_BUDGET_KB} kB)`;
  if (kernelGzip > KERNEL_BUDGET_KB * 1000) {
    console.error(`check-bundle: over budget: ${kernelVerdict}`);
    process.exit(1);
  }
  console.log(`check-bundle: ok: ${kernelVerdict}`);

  // The catalogue: the commands that come after the kernel, in one chunk the kernel only import()s.
  const catalogueRoots = chunks.filter((chunk) => CATALOGUE_ROOT.test(chunk.name));
  if (catalogueRoots.length !== 1) {
    console.error(
      `check-bundle: expected one chunk matching ${CATALOGUE_ROOT}, found ${catalogueRoots.length}; a static import of src/commands/more would merge the catalogue into the kernel.`,
    );
    process.exit(1);
  }
  const catalogueRoot = catalogueRoots[0]?.name ?? '';
  if (parts.has(catalogueRoot) || initial.has(catalogueRoot)) {
    console.error(`check-bundle: the catalogue (${catalogueRoot}) is loaded with the page or the kernel, not after them.`);
    process.exit(1);
  }
  const catalogue = closure([catalogueRoot], new Set([...initial, ...parts]), read);
  const catalogueGzip = chunks.filter((chunk) => catalogue.has(chunk.name)).reduce((sum, chunk) => sum + chunk.gzip, 0);
  const catalogueVerdict = `catalogue ${kb(catalogueGzip).trim()} kB gzip in ${[...catalogue].join(' + ')} (budget ${CATALOGUE_BUDGET_KB} kB)`;
  if (catalogueGzip > CATALOGUE_BUDGET_KB * 1000) {
    console.error(`check-bundle: over budget: ${catalogueVerdict}`);
    process.exit(1);
  }
  console.log(`check-bundle: ok: ${catalogueVerdict}`);

  // stock's first quote: what it fetches beyond the page and the kernel.
  const roots = STOCK_ROOTS.map((pattern) => chunks.filter((chunk) => pattern.test(chunk.name)));
  const ambiguous = roots.findIndex((found) => found.length !== 1);
  if (ambiguous !== -1) {
    console.error(`check-bundle: expected one chunk matching ${STOCK_ROOTS[ambiguous]}, found ${roots[ambiguous]?.length ?? 0}.`);
    process.exit(1);
  }
  const stock = closure(
    roots.map((found) => found[0]?.name ?? ''),
    new Set([...initial, ...parts]),
    read,
  );
  const stockGzip = chunks.filter((chunk) => stock.has(chunk.name)).reduce((sum, chunk) => sum + chunk.gzip, 0);
  const stockVerdict = `stock's first quote ${kb(stockGzip).trim()} kB gzip in ${[...stock].join(' + ')} (budget ${STOCK_BUDGET_KB} kB)`;
  if (stockGzip > STOCK_BUDGET_KB * 1000) {
    console.error(`check-bundle: over budget: ${stockVerdict}`);
    process.exit(1);
  }
  console.log(`check-bundle: ok: ${stockVerdict}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
