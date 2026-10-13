import { expect, test, type Page } from '@playwright/test';
import { isBenignConsoleMessage } from './console';

// sudo's sound where the browser starts sound only inside a gesture: Safari and every browser on
// iOS, and the in-app browsers (Instagram's, Facebook's). The 'gesture-required' project is
// Chromium told to ask the same, as Android's WebView does. The show opens after the key press
// that answers the password has passed, so sudo readies its track inside that key press
// (services/warm-show.ts unlockAudio), and the show plays it without a tap. Here on mobile data,
// where nothing was warmed at idle, and with the show's chunk late enough for the key press's own
// activation (five seconds in Chromium) to have run out before the show plays.

const SECRET = 'hunter2-correct-horse';
const prompt = (page: Page) => page.locator('input.command-input');
const show = (page: Page) => page.getByRole('dialog', { name: 'You have been rickrolled' });

test("sudo's track plays without a tap where sound needs a gesture", { tag: '@smoke' }, async ({ page }) => {
  test.skip(test.info().project.name !== 'gesture-required', 'Chromium holding sound back until a gesture');
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !isBenignConsoleMessage(message.text(), message.location().url)) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    // Mobile data: the idle warm-up is skipped, so no element is waiting for the show.
    Object.defineProperty(navigator, 'connection', { configurable: true, get: () => ({ saveData: false, type: 'cellular', effectiveType: '4g' }) });
  });
  // The show's chunk comes after the key press's activation has run out.
  await page.route(/\/assets\/Rick-[^/]*\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5_500));
    await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
  await prompt(page).tap();
  await prompt(page).fill('sudo ls');
  await prompt(page).press('Enter');
  await expect(page.locator('.edit-row .read-prompt')).toHaveText('Password: ');
  await prompt(page).pressSequentially(SECRET);
  await prompt(page).press('Enter');
  // Nothing touches the page meanwhile: Playwright's own calls into it count as gestures.
  await page.waitForTimeout(8_000);
  await expect(show(page)).toBeVisible();
  await expect(show(page)).toHaveAttribute('data-source', 'track');
  await expect(show(page)).toHaveAttribute('data-sound', 'on');
  expect(await show(page).locator('audio').evaluate((element: HTMLAudioElement) => ({ paused: element.paused, muted: element.muted }))).toEqual({
    paused: false,
    muted: false,
  });
  await show(page).tap();
  await expect(show(page)).toBeHidden();
  expect(errors).toEqual([]);
});
