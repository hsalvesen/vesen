#!/usr/bin/env node
// Regenerates docs/themes/screenshots/<theme>.png: the built app at 1280x800 in each theme,
// showing the banner and `fastfetch`, whose logo, labels and sixteen swatches show every colour
// a theme has, so the theme docs never drift from the real look.
//
//   npm run build && node scripts/theme-screenshots.mjs
//
// It serves dist/ with Vite's preview server (on a free port, or the one PW_PORT names, as the
// Playwright runs do) and drives Playwright's Chromium (`npx playwright install chromium`). The
// CRT sweep is hidden, and the browser reports no GPU and no battery, so the images are the same
// on every run (a headless GPU names itself SwiftShader); the scanlines and vignette of the
// desktop default stay. It then rebuilds docs/themes/themes.gif from the screenshots, with ffmpeg
// where it is installed and otherwise with scripts/gif.py (Pillow and numpy).
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
export const LINES = ['fastfetch'];

/** The storage key the app reads its theme from (src/services/storage-keys.ts). */
const THEME_KEY = 'vesen:theme:v1';

/** @returns {string[]} theme names from themes.json, in order */
export function themeNames() {
  /** @type {{ name: string }[]} */
  const themes = JSON.parse(readFileSync(join(ROOT, 'src', 'themes.json'), 'utf8'));
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
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, locale: 'en-AU', timezoneId: 'Australia/Sydney' });
  await context.addInitScript(
    (/** @type {{ key: string, value: string }} */ { key, value }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {}
      // No battery to read: fastfetch leaves the row out rather than show this machine's charge.
      Object.defineProperty(Navigator.prototype, 'getBattery', { configurable: true, value: undefined });
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
    // Python, where ffmpeg is missing: the same frames, each with 256 colours of its own.
    const python = spawnSync('python3', [join(ROOT, 'scripts', 'gif.py'), GIF, '2', '960', ...themeNames().map(screenshotPath)], { stdio: 'inherit' });
    if (python.status !== 0) console.log('theme-screenshots: neither ffmpeg nor Python with Pillow and numpy is installed, so docs/themes/themes.gif is unchanged.');
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
  // PW_PORT, when set, is the port and nothing else will do; otherwise any free port.
  const port = Number(process.env.PW_PORT) || 0;
  const server = await preview({ root: ROOT, logLevel: 'error', preview: { port, strictPort: port !== 0, open: false } });
  const url = server.resolvedUrls?.local[0];
  if (!url) throw new Error('theme-screenshots: the preview server has no local URL');
  // No WebGL, so fastfetch has no GPU row: a headless browser's would be SwiftShader.
  const browser = await chromium.launch({ args: ['--disable-3d-apis'] });
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
