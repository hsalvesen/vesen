#!/usr/bin/env node
// Screenshots the art preview without a server: reads art.txt and the web font, builds the page
// index.html would show, and renders it in Playwright's Chromium at device scale 2.
//   node scripts/art/preview/shot.mjs [--out shot.png] [--art scripts/art/preview/art.txt]
// Then look at the PNG. Not an npm script, and nothing in the app imports it.
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..');

/** @type {Record<string, string>} */
const args = {};
for (const arg of process.argv.slice(2)) {
  const match = /^--([^=]+)=(.*)$/.exec(arg);
  if (match !== null && match[1] !== undefined && match[2] !== undefined) args[match[1]] = match[2];
}
const out = resolve(args['out'] ?? 'shot.png');
const artPath = resolve(args['art'] ?? join(HERE, 'art.txt'));

const COLOURS = { apple: '#06c993', android: '#06c993', windows: '#5da3c1', linux: '#f4c95d' };
const BLOCK = /[─-▟⠀-⣿]/;
/** @param {string} text */
const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const font = readFileSync(join(ROOT, 'public', 'fonts', 'VesenMono.woff2')).toString('base64');
const pieces = readFileSync(artPath, 'utf8')
  .replace(/\n$/, '')
  .split('\n%%\n')
  .map((part) => {
    const [title = '', ...rows] = part.split('\n');
    const art = rows.join('\n');
    const key = /** @type {keyof typeof COLOURS} */ (title.split(/\s/)[0] ?? '');
    const colour = COLOURS[key] ?? '#ffffff';
    const lineHeight = BLOCK.test(art) ? '1' : '1.35';
    const pre = (/** @type {number} */ px) => `<pre style="font-size:${px}px;line-height:${lineHeight};color:${colour}">${escapeHtml(art)}</pre>`;
    return `<h2>${escapeHtml(title)}</h2><div class="piece">${pre(16)}${pre(13)}</div>`;
  });

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: 'Vesen Mono'; src: url(data:font/woff2;base64,${font}) format('woff2'); }
body { background: #222235; color: #fff; margin: 0; padding: 24px; font: 16px/1.35 'Vesen Mono', monospace; }
h2 { font: 12px sans-serif; color: #8fd2e0; margin: 0 0 6px; }
.piece { display: flex; gap: 48px; align-items: flex-start; margin-bottom: 28px; }
pre { margin: 0; font: inherit; white-space: pre; font-variant-ligatures: none; }
</style><body>${pieces.join('')}</body>`;

const { chromium } = await import('@playwright/test');
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, deviceScaleFactor: 2 });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: out, fullPage: true });
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
