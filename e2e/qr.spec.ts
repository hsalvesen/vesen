import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { isBenignConsoleMessage } from './console';

// The QR card and Present mode (docs/plan/06-qr.md, acceptance checks; F048): a card 264-296 px
// wide on a 375 px phone with nothing scrolling sideways; screenshots that jsQR reads in three
// themes with the scanlines on, the code drawn above them; Present mode on a tap, closed by Esc
// and by Back with the keyboard as it was; escaped payloads; selectable text art; art in a pipe.

const PHONES = ['iphone-instagram', 'pixel-7'];
const isPhone = () => PHONES.includes(test.info().project.name);

const prompt = (page: Page) => page.locator('input.command-input');
const echoes = (page: Page) => page.locator('[role="log"] .command-input-display');
const lastEntry = (page: Page) => page.locator('[role="log"] .entry').last();
const lastFigure = (page: Page) => page.locator('[data-qr-card]').last().locator('[data-qr-figure]');

const JSQR = createRequire(import.meta.url).resolve('jsqr/dist/jsQR.js');

/** Opens the terminal with the kernel and the completion engine loaded; on a phone, the keyboard up. */
async function open(page: Page, width?: number): Promise<void> {
  if (width !== undefined) await page.setViewportSize({ width, height: 812 });
  await page.goto('/');
  await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
  if (isPhone()) {
    await prompt(page).tap();
    await expect(prompt(page)).toBeFocused();
  }
}

/** Types a line at the prompt and waits until it has run. */
async function run(page: Page, line: string): Promise<void> {
  const before = await echoes(page).count();
  await prompt(page).fill(line);
  await prompt(page).press('Enter');
  await expect(echoes(page)).toHaveCount(before + 1);
  await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
}

/** How far the page, and the transcript, are wider than the screen; both 0 when nothing scrolls sideways. */
const sideways = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      page: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      body: Math.max(0, document.body.scrollWidth - window.innerWidth),
      transcript: main ? Math.max(0, main.scrollWidth - main.clientWidth) : Infinity,
    };
  });

const promptFocused = (page: Page) => prompt(page).evaluate((input) => input === document.activeElement);

async function tapOrClick(target: Locator): Promise<void> {
  if (isPhone()) await target.tap();
  else await target.click();
}

/**
 * Reads a screenshot of `figure` with jsQR in the page, and reports how many colours its top
 * quiet zone has: one when nothing (the scanlines) is drawn over the code.
 */
async function scan(page: Page, figure: Locator): Promise<{ text: string | null; quietColours: number }> {
  if (!(await page.evaluate(() => 'jsQR' in window))) await page.addScriptTag({ path: JSQR });
  const png = await figure.screenshot();
  return page.evaluate(async (base64) => {
    const image = new Image();
    image.src = `data:image/png;base64,${base64}`;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    if (context === null) return { text: null, quietColours: -1 };
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const read = (window as unknown as { jsQR: (d: Uint8ClampedArray, w: number, h: number) => { data: string } | null }).jsQR;
    // The quiet zone's middle rows, clear of the rounded corners: four modules of the 33 or so.
    const colours = new Set<string>();
    const band = Math.floor((canvas.height * 4) / 33);
    for (let y = Math.floor(band / 4); y < Math.floor((band * 3) / 4); y++) {
      for (let x = band; x < canvas.width - band; x++) {
        const i = (y * canvas.width + x) * 4;
        colours.add(`${pixels.data[i]},${pixels.data[i + 1]},${pixels.data[i + 2]}`);
      }
    }
    return { text: read(pixels.data, pixels.width, pixels.height)?.data ?? null, quietColours: colours.size };
  }, png.toString('base64'));
}

/** Serves the app with firebase.json's headers, its content security policy included; returns what broke. */
async function servedLikeFirebase(page: Page, origin: string): Promise<string[]> {
  const config = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8')) as {
    hosting: { headers: { source: string; headers: { key: string; value: string }[] }[] };
  };
  const headers: Record<string, string> = {};
  for (const { key, value } of config.hosting.headers.find((rule) => rule.source === '**')?.headers ?? []) headers[key.toLowerCase()] = value;
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !isBenignConsoleMessage(message.text())) problems.push(message.text());
  });
  page.on('pageerror', (error) => {
    // WebKit reports this, harmlessly, when the transcript's resize observer (ui/actions/
    // stickToBottom.ts) sees a lazily loaded card take the place of its plain text.
    if (error.message !== 'ResizeObserver loop completed with undelivered notifications.') problems.push(error.message);
  });
  await page.route(
    (url) => url.origin === origin,
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), ...headers } });
    },
  );
  return problems;
}

test.describe('the QR card', { tag: '@smoke' }, () => {
  test('draws, presents and saves under the production content security policy', async ({ page, baseURL }) => {
    const problems = await servedLikeFirebase(page, new URL(baseURL ?? '').origin);
    await open(page);
    await run(page, 'qr vesen.app');
    await tapOrClick(lastFigure(page));
    const image = page.getByRole('dialog').getByRole('img');
    await expect(image).toBeVisible();
    // The data: image decoded, so the policy let it through.
    expect(await image.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    expect(problems).toEqual([]);
  });

  test('qr vesen.app is a card 264-296 px wide at 375 px, and nothing scrolls sideways', async ({ page }) => {
    await open(page, 375);
    await run(page, 'qr vesen.app');
    const figure = lastFigure(page);
    await expect(figure).toBeVisible();
    await expect.poll(async () => (await figure.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(264);
    const width = (await figure.boundingBox())?.width ?? 0;
    expect(width).toBeLessThanOrEqual(296);
    // Square, and a whole number of device pixels a module.
    expect((await figure.boundingBox())?.height).toBeCloseTo(width, 3);
    const modulesDevicePx = await figure.evaluate((element) => (element.getBoundingClientRect().width / 33) * window.devicePixelRatio);
    expect(Math.abs(modulesDevicePx - Math.round(modulesDevicePx))).toBeLessThan(0.01);
    expect(await sideways(page)).toEqual({ page: 0, body: 0, transcript: 0 });
    await expect(page.locator('[data-qr-card]').last()).toContainText('v2 · 25×25 · EC Q · 17/22 B');
    await expect(page.locator('[data-qr-card]').last()).toContainText(
      isPhone() ? 'Tap the code for full screen, then let a friend scan it' : 'Scan with your phone camera to open the link',
    );
  });

  for (const theme of ['cockatoo', 'swamphen', 'treefrog']) {
    test(`a screenshot of the card scans in ${theme}, with the scanlines on and under it`, async ({ page }) => {
      await open(page);
      await run(page, `theme ${theme}`);
      await run(page, 'cathode set scanlines');
      expect(await page.evaluate(() => document.documentElement.classList.contains('crt-scanlines'))).toBe(true);
      await run(page, 'qr vesen.app');
      const result = await scan(page, lastFigure(page));
      expect(result.text).toBe('https://vesen.app');
      expect(result.quietColours, 'the quiet zone is one colour: no scanlines cross the code').toBe(1);
    });
  }

  test('Present mode opens on a tap, closes on Esc and on Back, and leaves the keyboard as it was', async ({ page }) => {
    await open(page);
    await run(page, 'qr vesen.app');
    const focused = await promptFocused(page);
    const entries = await echoes(page).count();
    const url = page.url();
    const dialog = page.getByRole('dialog', { name: 'QR code for https://vesen.app' });

    await tapOrClick(lastFigure(page));
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('img', { name: 'QR code for https://vesen.app' })).toHaveAttribute('src', /^data:image\/png;base64,/);
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeFocused();
    if (test.info().project.name === 'iphone-instagram') {
      await expect(dialog).toContainText('Press and hold the code to save it, or take a screenshot');
      await expect(dialog.getByRole('button', { name: 'Save image' })).toHaveCount(0);
    } else {
      await expect(dialog.getByRole('button', { name: 'Save image' })).toBeVisible();
    }
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await promptFocused(page)).toBe(focused);

    await tapOrClick(lastFigure(page));
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    expect(page.url()).toBe(url);
    expect(await echoes(page).count()).toBe(entries);
    expect(await promptFocused(page)).toBe(focused);
    expect(await sideways(page)).toEqual({ page: 0, body: 0, transcript: 0 });
  });

  test('Present mode on a phone held sideways is at least as large as the card, beside its text', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 340 });
    await page.goto('/');
    await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
    await run(page, 'qr vesen.app');
    const figure = lastFigure(page);
    await expect(figure).toBeVisible();
    const inline = (await figure.boundingBox())?.width ?? 0;
    await tapOrClick(figure);
    const dialog = page.getByRole('dialog', { name: 'QR code for https://vesen.app' });
    const image = dialog.getByRole('img', { name: 'QR code for https://vesen.app' });
    await expect(image).toBeVisible();
    const shown = await image.boundingBox();
    expect(shown?.width ?? 0).toBeGreaterThanOrEqual(inline);
    // All of it on the screen, and the meta line beside it rather than under it.
    expect((shown?.y ?? -1) + (shown?.height ?? 0)).toBeLessThanOrEqual(340);
    const meta = await dialog.locator('.meta').boundingBox();
    expect(meta?.x ?? 0).toBeGreaterThan((shown?.x ?? 0) + (shown?.width ?? 0));
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test("Present mode's meta line breaks only between its parts on a 320 px phone", async ({ page }) => {
    await open(page, 320);
    await run(page, 'qr vesen.app');
    await tapOrClick(lastFigure(page));
    const parts = page.getByRole('dialog').locator('.meta .together');
    await expect(parts).toHaveText(['v2', '25×25', 'EC Q', '17/22 B', 'mask 0']);
    // Each part is on one line: as tall as one line of its text.
    for (const part of await parts.all()) {
      const lines = await part.evaluate((element) => element.getClientRects().length);
      expect(lines).toBe(1);
    }
    await page.keyboard.press('Escape');
  });

  test('qr -f opens Present mode, and the prompt comes back when it closes', async ({ page }) => {
    await open(page);
    await prompt(page).fill('qr -f vesen.app');
    await prompt(page).press('Enter');
    const dialog = page.getByRole('dialog', { name: 'QR code for https://vesen.app' });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('q');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
    await expect(lastFigure(page)).toBeVisible();
  });

  test("qr '<u>x</u>' shows the text, and makes no <u> element", async ({ page }) => {
    await open(page);
    await run(page, "qr '<u>x</u>'");
    await expect(page.locator('[data-qr-card]').last().locator('.qr-payload')).toHaveText('<u>x</u>');
    await run(page, 'qr <u>x</u>');
    await expect(page.locator('[role="log"] u')).toHaveCount(0);
  });

  test('qr -t utf8 hello prints selectable text art that never wraps', async ({ page }) => {
    await open(page);
    await run(page, 'qr -t utf8 hello');
    const art = lastEntry(page).locator('[data-qr-text]');
    await expect(art).toBeVisible();
    const shown = await art.evaluate((element) => {
      const style = getComputedStyle(element);
      const range = document.createRange();
      range.selectNodeContents(element);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      return {
        selected: selection?.toString() ?? '',
        whiteSpace: style.whiteSpace,
        userSelect: style.userSelect || style.getPropertyValue('-webkit-user-select'),
        lineHeight: Number.parseFloat(style.lineHeight) / Number.parseFloat(style.fontSize),
        overflow: element.scrollWidth - element.clientWidth,
      };
    });
    expect(shown.selected).toMatch(/^[█▀▄ ]+(\n[█▀▄ ]+)+$/);
    expect(shown.selected.split('\n')).toHaveLength(13);
    expect(shown.whiteSpace).toBe('pre');
    expect(shown.userSelect).not.toBe('none');
    expect(shown.lineHeight).toBeCloseTo(1.2, 2);
    expect(shown.overflow).toBeLessThanOrEqual(0);
  });

  test('utf8 art on a light theme ends in paper, not a band of ink, and a screenshot of it scans', async ({ page }) => {
    await open(page);
    await run(page, 'theme cockatoo');
    await run(page, 'qr -t utf8 vesen.app');
    const art = lastEntry(page).locator('[data-qr-text]');
    await expect(art).toBeVisible();
    expect((await art.innerText()).split('\n').pop()).toMatch(/^█+$/);
    expect((await scan(page, art)).text).toBe('https://vesen.app');
  });

  test('text art too wide for an 8 px font, and a size too big for the window, become a card that fits', async ({ page }) => {
    await open(page, 320);
    await run(page, `qr -t utf8 ${'x'.repeat(250)}`);
    const card = page.locator('[data-qr-card]').last();
    await expect(card.locator('[data-qr-text]')).toHaveCount(0);
    await expect(lastFigure(page)).toBeVisible();
    await expect(card).toContainText(/note: utf8 art needs 65 columns; this screen fits \d+\. Showing an image instead\./);
    await run(page, 'qr -s 32 vesen.app');
    await expect(page.locator('[data-qr-card]').last()).toContainText(/note: size reduced to [\d.]+ px to fit this window/);
    expect(await sideways(page)).toEqual({ page: 0, body: 0, transcript: 0 });
  });

  test('qr x | cat prints the art as text', async ({ page }) => {
    await open(page);
    await run(page, 'qr x | cat');
    const output = lastEntry(page).locator('.command-output');
    await expect(output.locator('[data-qr-card]')).toHaveCount(0);
    const text = (await output.innerText()).replace(/\n+$/, '');
    expect(text).toMatch(/^[█▀▄ ]+(\n[█▀▄ ]+)+$/);
  });
});
