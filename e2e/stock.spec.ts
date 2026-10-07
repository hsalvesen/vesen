import { expect, test, type Locator, type Page } from '@playwright/test';
import { routeQuotes } from './quotes';

// stock on a phone and a desktop (docs/plan/07-stock-and-proxy.md, "Phone interactions and QA"),
// with every quote answered from the recordings: a card fits a 320 or 375 px screen with nothing
// to scroll sideways, its range chip runs the line again, a failed request shows the saved copy
// marked STALE, and Stop ends a request that never answers.

const prompt = (page: Page) => page.getByRole('combobox', { name: 'Terminal command' });
const lastEntry = (page: Page) => page.locator('[role="log"] .entry').last();

/** Runs a line at the prompt and waits until it is in the transcript and nothing runs. */
async function run(page: Page, line: string): Promise<void> {
  const echoes = page.locator('[role="log"] .command-input-display');
  const before = await echoes.count();
  await prompt(page).fill(line);
  await prompt(page).press('Enter');
  await expect(echoes).toHaveCount(before + 1);
  await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
}

/** A tap on a phone, a click on a desktop. */
async function press(target: Locator, hasTouch: boolean): Promise<void> {
  if (hasTouch) await target.tap();
  else await target.click();
}

/** How far the page and the transcript are wider than the screen; 0 when nothing scrolls sideways. */
const sideways = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      page: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      body: Math.max(0, document.body.scrollWidth - window.innerWidth),
      transcript: main ? Math.max(0, main.scrollWidth - main.clientWidth) : Number.POSITIVE_INFINITY,
    };
  });

test.describe('stock', { tag: '@smoke' }, () => {
  test.skip(() => test.info().project.name === 'pixel-7', 'the desktop and the Instagram iPhone cover it');

  for (const width of [320, 375]) {
    test(`a card fits ${width} px, its 5d chip runs again, and a failed request shows the saved copy`, async ({ page, hasTouch }) => {
      await page.setViewportSize({ width, height: 720 });
      const quotes = await routeQuotes(page);
      await page.goto('/');

      await run(page, 'stock AAPL');
      const card = lastEntry(page).locator('.quote');
      await expect(card).toBeVisible();
      await expect(card.locator('.symbol')).toHaveText('AAPL');
      await expect(card.locator('.price')).toHaveText('332.89 USD');
      await expect(card.locator('.badge')).toHaveCount(0);
      await expect(card.locator('svg path')).toHaveCount(1);
      await expect(card.locator('.footer')).toContainText('Yahoo Finance');
      expect(await sideways(page), 'nothing scrolls sideways').toEqual({ page: 0, body: 0, transcript: 0 });
      const box = await card.boundingBox();
      expect(box?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(width);
      // Every chip is a finger's width on a touch screen.
      if (hasTouch) {
        for (const chip of await card.locator('button.chip').all()) expect((await chip.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
      }

      // The 5d chip runs the line again, as if typed.
      await press(card.getByRole('button', { name: 'Show AAPL over 5 days' }), hasTouch);
      await expect(page.locator('[role="log"] .command-input-display').last()).toHaveText('stock -r 5d AAPL');
      await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
      const week = lastEntry(page).locator('.quote');
      await expect(week.locator('.chip[aria-pressed="true"]')).toHaveText('5d');
      await expect(week.locator('.axis')).toContainText('from');
      expect(quotes.requests.some((url) => url.includes('range%3D5d') || url.includes('range=5d'))).toBe(true);

      // With the service unreachable, refresh shows the last good copy, marked STALE.
      quotes.mode = 'abort';
      await press(week.getByRole('button', { name: 'Refresh AAPL' }), hasTouch);
      await expect(page.locator('[role="log"] .command-input-display').last()).toHaveText('stock -f -r 5d AAPL');
      await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false', { timeout: 15_000 });
      const stale = lastEntry(page).locator('.quote');
      await expect(stale.locator('.badge')).toHaveText('STALE');
      await expect(stale.locator('.footer')).toContainText('Saved copy from');
      await expect(stale.locator('.footer')).toContainText('live data unavailable');
      expect(await sideways(page), 'nothing scrolls sideways').toEqual({ page: 0, body: 0, transcript: 0 });
    });
  }

  test('Stop ends a request that never answers', async ({ page, hasTouch }) => {
    await page.setViewportSize({ width: 375, height: 720 });
    await routeQuotes(page, 'hang');
    await page.goto('/');
    await prompt(page).fill('stock CBA.AX');
    await prompt(page).press('Enter');

    const stop = page.getByRole('button', { name: 'Stop: fetching CBA.AX…' });
    await expect(stop).toBeVisible();
    await press(stop, hasTouch);
    await expect(lastEntry(page)).toContainText('^C');
    await expect(stop).toBeHidden();
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
  });

  test('several tickers make a table, each ticker a chip', async ({ page, hasTouch }) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await routeQuotes(page);
    await page.goto('/');
    await run(page, 'stock AAPL CBA.AX ZZZZQQ');
    const table = lastEntry(page).locator('.quotes table');
    await expect(table.locator('tbody tr')).toHaveCount(3);
    await expect(table.locator('td.failure')).toHaveText('— not found');
    expect(await sideways(page), 'nothing scrolls sideways').toEqual({ page: 0, body: 0, transcript: 0 });
    await press(table.getByRole('button', { name: 'Show CBA.AX' }), hasTouch);
    await expect(page.locator('[role="log"] .command-input-display').last()).toHaveText('stock CBA.AX');
    await expect(lastEntry(page).locator('.quote .symbol')).toHaveText('CBA.AX');
  });
});
