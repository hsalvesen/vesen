#!/usr/bin/env node
// Generates every icon from one mark, measured from the original 180 px favicons: a rounded
// square in the theme's icon colour with a white cursor bar.
//
//   public/icons/theme/<theme>.svg       the favicon for each theme; platform/head.ts swaps it
//   public/icons/favicon-32.png          the PNG fallback, in swamphen
//   public/icons/icon-192.png, icon-512.png   the manifest icons, in swamphen
//   public/icons/apple-touch-icon.png    180 px, opaque, in swamphen
//   public/icons/icon-maskable-512.png   full bleed, with the bar inside the maskable safe zone
//
// To rerun after changing a colour or the mark, then commit what it writes:
//   node scripts/icons.mjs
// It renders the PNGs as screenshots in Playwright's Chromium (`npx playwright install chromium`).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'icons');

/** The icon colour of each theme, as the original favicons had it. */
export const ICON_COLOURS = /** @type {const} */ ({
  cassowary: '#25e3be',
  cockatoo: '#eaa549',
  crocodile: '#619459',
  galah: '#f08cb0',
  kangaroo: '#f79501',
  kookaburra: '#13ab9c',
  lorikeet: '#5b3fd6',
  magpie: '#2b3a5c',
  petroica: '#da61d6',
  platypus: '#e8923a',
  quokka: '#c6873a',
  swamphen: '#ec575d',
  treefrog: '#03bb00',
  wallaby: '#ffc56d',
  wombat: '#d2b48c',
});

/** The theme the static icons use; the default theme. */
const DEFAULT_THEME = 'swamphen';

/** The white cursor bar, in the 180 px coordinates of the original favicons. */
const BAR = '<rect x="89.5" y="121.5" width="48" height="16" fill="#fff"/>';

/**
 * The favicon mark: a 150 px rounded square on a transparent 180 px canvas.
 * @param {string} colour
 */
export function markSvg(colour) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><rect x="15" y="15" width="150" height="150" rx="4" fill="${colour}"/>${BAR}</svg>\n`;
}

/**
 * The mark filling the whole canvas, for icons the system masks (iOS rounds the home screen
 * icon; Android crops maskable icons to as little as the central 80% circle, which holds the bar).
 * @param {string} colour
 */
export function tileSvg(colour) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180"><rect width="180" height="180" fill="${colour}"/>${BAR}</svg>\n`;
}

/**
 * Screenshots an SVG at `size` px square, keeping transparency.
 * @param {import('@playwright/test').Page} page
 * @param {string} svg
 * @param {number} size
 * @returns {Promise<Buffer>}
 */
async function renderPng(page, svg, size) {
  await page.setViewportSize({ width: size, height: size });
  const sized = svg.replace('<svg ', `<svg width="${size}" height="${size}" style="display:block" `);
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${sized}</body></html>`);
  return page.screenshot({ type: 'png', omitBackground: true });
}

async function main() {
  const themes = /** @type {{ name: string }[]} */ (JSON.parse(readFileSync(join(ROOT, 'themes.json'), 'utf8')));
  const colours = /** @type {Record<string, string>} */ (ICON_COLOURS);
  const missing = themes.map((t) => t.name).filter((name) => !(name in colours));
  if (missing.length > 0) throw new Error(`No icon colour for: ${missing.join(', ')}. Add it to ICON_COLOURS.`);

  mkdirSync(join(OUT, 'theme'), { recursive: true });
  for (const { name } of themes) writeFileSync(join(OUT, 'theme', `${name}.svg`), markSvg(colours[name] ?? ''));

  const colour = ICON_COLOURS[DEFAULT_THEME];
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    /** @type {[string, string, number][]} */
    const pngs = [
      ['favicon-32.png', markSvg(colour), 32],
      ['icon-192.png', markSvg(colour), 192],
      ['icon-512.png', markSvg(colour), 512],
      ['apple-touch-icon.png', tileSvg(colour), 180],
      ['icon-maskable-512.png', tileSvg(colour), 512],
    ];
    for (const [file, svg, size] of pngs) writeFileSync(join(OUT, file), await renderPng(page, svg, size));
  } finally {
    await browser.close();
  }
  console.log(`icons: wrote ${themes.length} theme SVGs and 5 PNGs to public/icons`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
