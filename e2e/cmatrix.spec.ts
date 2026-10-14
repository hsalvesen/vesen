import { expect, test, type Page } from '@playwright/test';
import { isBenignConsoleMessage } from './console';

// cmatrix on every device (src/ui/apps/Matrix.svelte): the rain shows at once and keeps falling,
// under reduced motion too (it is the animation the visitor asked for; a phone with Reduce Motion
// on had shown one still screen of it), the canvas follows the screen when it turns, and a tap, or
// any key on a keyboard, ends it, with the line done.

const PHONES = ['iphone-instagram', 'pixel-7'];
const isPhone = () => PHONES.includes(test.info().project.name);

const prompt = (page: Page) => page.locator('input.command-input');
const matrix = (page: Page) => page.locator('.matrix');

/** How much of the canvas is lit, and a fingerprint of what is drawn, read from inside the page. */
const drawn = (page: Page) =>
  matrix(page).evaluate((button) => {
    const canvas = button.querySelector('canvas') as HTMLCanvasElement;
    const pixels = (canvas.getContext('2d') as CanvasRenderingContext2D).getImageData(0, 0, canvas.width, canvas.height).data;
    let lit = 0;
    let print = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      const v = (pixels[i] ?? 0) + (pixels[i + 1] ?? 0) + (pixels[i + 2] ?? 0);
      if (v > 200) {
        lit += 1;
        print = (print * 31 + i) % 1_000_000_007;
      }
    }
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    return { lit, print, fits: canvas.width === Math.floor(button.clientWidth * ratio) && canvas.height === Math.floor(button.clientHeight * ratio) };
  });

async function cmatrix(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !isBenignConsoleMessage(message.text(), message.location().url)) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
  if (isPhone()) await prompt(page).tap();
  else await prompt(page).click();
  await prompt(page).fill('cmatrix');
  await prompt(page).press('Enter');
  await expect(matrix(page)).toBeVisible();
  return errors;
}

/** The rain is there within half a second, and falls on. */
async function rains(page: Page): Promise<void> {
  await page.waitForTimeout(500);
  const first = await drawn(page);
  expect(first.lit, 'rain within half a second').toBeGreaterThan(500);
  expect(first.fits).toBe(true);
  await expect.poll(async () => (await drawn(page)).print, { timeout: 3000 }).not.toBe(first.print);
  await expect(matrix(page)).toHaveAttribute('data-motion', 'running');
}

async function ends(page: Page, errors: string[]): Promise<void> {
  if (isPhone()) await matrix(page).tap();
  else await page.keyboard.press('x');
  await expect(matrix(page)).toHaveCount(0);
  await expect(page.locator('.app-host')).toHaveCount(0);
  await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
  expect(errors).toEqual([]);
}

test.describe('cmatrix', { tag: '@smoke' }, () => {
  test('rains at once and keeps falling, fits the screen as it turns, and a tap or a key ends it', async ({ page }) => {
    const errors = await cmatrix(page);
    await rains(page);
    // The screen turns (or a phone's keyboard closes): the canvas is fitted to it again.
    const size = page.viewportSize() ?? { width: 800, height: 600 };
    await page.setViewportSize({ width: size.height, height: size.width });
    await expect.poll(async () => (await drawn(page)).fits).toBe(true);
    await expect.poll(async () => (await drawn(page)).lit, { timeout: 3000 }).toBeGreaterThan(200);
    await page.setViewportSize(size);
    await ends(page, errors);
  });

  test('rains under reduced motion too', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = await cmatrix(page);
    await rains(page);
    await ends(page, errors);
  });
});
