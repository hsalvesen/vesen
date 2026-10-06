#!/usr/bin/env node
// Renders public/og.png, the 1200x630 link preview that Instagram DMs, iMessage, WhatsApp,
// LinkedIn and Slack show for www.vesen.app: the VESEN banner from the `banner` command, the
// tagline and the address, in swamphen colours. Everything sits inside the central 630x630
// square, because some apps crop the preview to a square.
//
// To rerun after changing the banner, the colours or the copy, then commit public/og.png:
//   node scripts/og.mjs
// It screenshots a local page in Playwright's Chromium (`npx playwright install chromium`).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'og.png');
export const WIDTH = 1200;
export const HEIGHT = 630;
/** Some apps refuse a larger preview image, and phones on mobile data fetch it. */
export const MAX_BYTES = 150_000;

/** Swamphen, from themes.json, and its icon colour. */
const COLOURS = { background: '#222235', foreground: '#ffffff', green: '#06c993', cyan: '#8FD2E0', icon: '#ec575d' };

/**
 * The banner's font size. The font's advance is 1200/2048 em, so this makes each cell exactly
 * 14 px wide and the block letters show no seams between columns. Rows are a pixel shorter than
 * a full block (2380/2048 em), so they overlap and show no seams either.
 */
const BANNER_PX = (14 * 2048) / 1200;

/** The terminal's own font, if it is in the repo; the system monospace font otherwise. */
const FONT_CANDIDATES = ['public/fonts/VesenMono.woff2', 'assets-src/fonts/CascadiaCode.ttf'];

/**
 * The six lines of the VESEN block banner, read from BANNER_ART, which the banner command draws,
 * so the preview never drifts from what visitors see.
 * @param {string} source the text of src/utils/commands/system.ts
 */
export function bannerArt(source) {
  const match = /\bBANNER_ART\s*=\s*`([^`]*)`/.exec(source);
  const art = match?.[1];
  if (!art) throw new Error('og: could not find the banner art in src/utils/commands/system.ts');
  const lines = art.split('\n').map((line) => line.trimEnd());
  if (lines.length !== 6) throw new Error(`og: expected 6 banner lines, found ${lines.length}`);
  return lines.join('\n');
}

/** @param {string} text */
const escapeHtml = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The page that is screenshotted.
 * @param {string} art
 * @param {string | null} fontUrl a data: URL of the font, or null for the system monospace font
 */
export function ogHtml(art, fontUrl) {
  const face = fontUrl ? `@font-face { font-family: 'Vesen OG'; src: url(${fontUrl}); }` : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
${face}
html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; background: ${COLOURS.background}; }
body { display: flex; align-items: center; justify-content: center; color: ${COLOURS.foreground};
  font-family: 'Vesen OG', ui-monospace, Menlo, monospace; }
.frame { position: absolute; inset: 28px; border: 4px solid ${COLOURS.green}; border-radius: 18px; }
.card { position: relative; display: flex; flex-direction: column; align-items: center; }
pre { margin: 0; font: inherit; font-size: ${BANNER_PX}px; line-height: ${BANNER_PX * (2380 / 2048) - 1}px; }
.tagline { margin-top: 40px; font-size: 34px; }
.address { margin-top: 18px; font-size: 30px; color: ${COLOURS.green}; }
.cursor { display: inline-block; width: 0.6em; height: 1.1em; margin-left: 0.15em; vertical-align: -0.2em; background: ${COLOURS.icon}; }
</style></head>
<body><div class="frame"></div><div class="card">
<pre>${escapeHtml(art)}</pre>
<div class="tagline">a terminal in your browser</div>
<div class="address">www.vesen.app<span class="cursor"></span></div>
</div></body></html>`;
}

async function main() {
  const art = bannerArt(readFileSync(join(ROOT, 'src', 'utils', 'commands', 'system.ts'), 'utf8'));
  const fontPath = FONT_CANDIDATES.map((path) => join(ROOT, path)).find((path) => existsSync(path));
  const fontUrl = fontPath
    ? `data:font/${fontPath.endsWith('.woff2') ? 'woff2' : 'ttf'};base64,${readFileSync(fontPath).toString('base64')}`
    : null;

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    await page.setContent(ogHtml(art, fontUrl));
    await page.evaluate(() => document.fonts.ready);
    const png = await page.screenshot({ type: 'png' });
    if (png.length > MAX_BYTES) throw new Error(`og: ${png.length} bytes is over the ${MAX_BYTES} byte budget`);
    writeFileSync(OUT, png);
    console.log(`og: wrote public/og.png (${png.length} bytes, font: ${fontPath ? fontPath.slice(ROOT.length + 1) : 'system'})`);
  } finally {
    await browser.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
