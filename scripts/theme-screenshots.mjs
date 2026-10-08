#!/usr/bin/env node
// Regenerates docs/themes/screenshots/<theme>.png: the built app at 1280x800 in each theme,
// showing the banner, `help` and `ls -a`, so the theme docs never drift from the real look.
//
//   npm run build && node scripts/theme-screenshots.mjs
//
// It serves dist/ with Vite's preview server and drives Playwright's Chromium
// (`npx playwright install chromium`). The CRT sweep is hidden so the images are the same on
// every run; the scanlines and vignette of the desktop default stay. With ffmpeg on the PATH it
// also rebuilds docs/themes/themes.gif from the screenshots.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'docs', 'themes', 'screenshots');
const GIF = join(ROOT, 'docs', 'themes', 'themes.gif');
export const VIEWPORT = { width: 1280, height: 800 };
/** What each screenshot shows after the banner. */
export const LINES = ['help', 'ls -a'];

/** The storage key the app reads its theme from (src/services/storage-keys.ts). */
const THEME_KEY = 'vesen:theme:v1';

/** @returns {string[]} theme names from themes.json, in order */
export function themeNames() {
  /** @type {{ name: string }[]} */
  const themes = JSON.parse(readFileSync(join(ROOT, 'themes.json'), 'utf8'));
  return themes.map((theme) => theme.name);
}

/** @param {string} name */
export const screenshotPath = (name) => join(OUT, `${name.toLowerCase()}.png`);

/**
 * @param {import('@playwright/test').Browser} browser
 * @param {string} url
 * @param {string} name
 */
async function shoot(browser, url, name) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1 });
  await context.addInitScript(
    (/** @type {{ key: string, value: string }} */ { key, value }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {}
    },
    { key: THEME_KEY, value: name },
  );
  const page = await context.newPage();
  await page.goto(url);
  await page.addStyleTag({ content: '.crt-layer-sweep { display: none !important; }' });
  const prompt = page.locator('input.command-input');
  await prompt.click();
  for (const line of LINES) {
    await prompt.fill(line);
    await prompt.press('Enter');
    await page.locator('.command-input-display', { hasText: line }).last().waitFor();
    // Then until it has finished: a line typed while `help` still waits for the catalogue is
    // type-ahead, and filling the input then could lose it.
    await page.locator('[role="log"][aria-busy="false"]').waitFor();
  }
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(0, 0);
  await page.screenshot({ path: screenshotPath(name) });
  await context.close();
}

/** Builds the animated overview from the screenshots, two seconds a theme. */
function buildGif() {
  if (spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status !== 0) {
    console.log('theme-screenshots: ffmpeg not found, so docs/themes/themes.gif is unchanged.');
    return;
  }
  const work = join(tmpdir(), `vesen-gif-${process.pid}`);
  mkdirSync(work, { recursive: true });
  try {
    const listFile = join(work, 'list.txt');
    writeFileSync(listFile, themeNames().map((name) => `file '${screenshotPath(name)}'\nduration 2\n`).join(''));
    const palette = join(work, 'palette.png');
    const scale = 'scale=960:-1:flags=lanczos';
    const run = (/** @type {string[]} */ args) => spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
    run(['-f', 'concat', '-safe', '0', '-i', listFile, '-vf', `${scale},palettegen`, palette]);
    run(['-f', 'concat', '-safe', '0', '-i', listFile, '-i', palette, '-lavfi', `${scale}[x];[x][1:v]paletteuse`, '-loop', '0', GIF]);
    console.log(`theme-screenshots: wrote ${GIF}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function main() {
  if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
    console.error('theme-screenshots: no build in dist/; run `npm run build` first.');
    process.exit(1);
  }
  const { preview } = await import('vite');
  const { chromium } = await import('@playwright/test');
  const server = await preview({ root: ROOT, logLevel: 'error', preview: { port: 0, open: false } });
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('theme-screenshots: the preview server has no local URL');
  const browser = await chromium.launch();
  try {
    mkdirSync(OUT, { recursive: true });
    for (const name of themeNames()) {
      await shoot(browser, url, name);
      console.log(`theme-screenshots: ${screenshotPath(name)}`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
  buildGif();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
