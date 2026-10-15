import { expect, test, type Page } from '@playwright/test';
import { isBenignConsoleMessage, isBenignPageError } from './console';

// nyancat: Nyan Cat flies across the terminal's window in ASCII, filling it, to its chiptune. On a
// keyboard it starts at once and q ends it; on a touch screen it waits for a tap, and the next tap
// ends it; Back ends it and stays on vesen. When it ends, the terminal says how long it ran.

const PHONES = ['iphone-instagram', 'pixel-7'];
const isPhone = () => PHONES.includes(test.info().project.name);

const prompt = (page: Page) => page.locator('input.command-input');
const show = (page: Page) => page.getByRole('dialog', { name: 'Nyan Cat' });
const lastEntry = (page: Page) => page.locator('[role="log"] .entry').last();

async function arrive(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !isBenignConsoleMessage(message.text(), message.location().url)) errors.push(message.text());
  });
  page.on('pageerror', (error) => {
    if (!isBenignPageError(error.message)) errors.push(error.message);
  });
  await page.goto('/');
  await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
  if (isPhone()) await prompt(page).tap();
  else await prompt(page).click();
  return errors;
}

async function nyancat(page: Page): Promise<void> {
  await prompt(page).fill('nyancat');
  await prompt(page).press('Enter');
  await expect(show(page)).toBeVisible();
}

test.describe('nyancat', { tag: '@smoke' }, () => {
  test('flies across the whole window in ASCII, bobbing, and says how long it ran when it ends', async ({ page }) => {
    const errors = await arrive(page);
    await nyancat(page);
    if (isPhone()) {
      // The cat stands still until a tap starts it.
      await expect(show(page)).toHaveAttribute('data-motion', 'waiting');
      await expect(show(page).getByText('Tap to nyan')).toBeVisible();
      await show(page).tap();
    }
    await expect(show(page)).toHaveAttribute('data-motion', 'running');
    // The frames step on: the one showing changes.
    const first = await show(page).getAttribute('data-frame');
    await expect.poll(() => show(page).getAttribute('data-frame')).not.toBe(first);
    await expect(show(page).locator('.frame.shown')).toHaveCount(1);
    // The picture covers the window: wider and taller than it, or as wide or as tall.
    const fit = await show(page).evaluate((element) => {
      const stage = element.querySelector('.stage')?.getBoundingClientRect();
      const frame = element.querySelector('.frame.shown')?.getBoundingClientRect();
      if (!stage || !frame) return null;
      return {
        covers: frame.left <= stage.left + 1 && frame.right >= stage.right - 1 && frame.top <= stage.top + 1 && frame.bottom >= stage.bottom - 1,
        centred: Math.abs(frame.left + frame.width / 2 - (stage.left + stage.width / 2)) < 2,
      };
    });
    expect(fit).toEqual({ covers: true, centred: true });
    await expect(show(page).getByText(/^You have nyaned for \d+ seconds?!$/)).toBeVisible();
    // Nothing scrolls sideways.
    expect(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth))).toBe(0);

    if (isPhone()) await show(page).tap();
    else await page.keyboard.press('q');
    await expect(show(page)).toBeHidden();
    await expect(lastEntry(page)).toContainText(/You have nyaned for \d+ seconds?!/);
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
    expect(errors).toEqual([]);
  });

  test('Back ends it and stays on vesen', async ({ page }) => {
    const errors = await arrive(page);
    const home = page.url();
    await nyancat(page);
    await page.evaluate(() => void setTimeout(() => history.back(), 0));
    await expect(show(page)).toBeHidden();
    await expect(page).toHaveURL(home);
    await expect(lastEntry(page)).toContainText(/You have nyaned for \d+ seconds?!/);
    expect(errors).toEqual([]);
  });
});
