import { expect, test, type Page } from '@playwright/test';
import { isBenignConsoleMessage } from './console';

// sudo's sound where the browser starts sound only inside a gesture, as Safari does. The
// 'gesture-required' projects are Chromium told to ask the same, on a desktop and on a phone. On a
// keyboard the show opens after the key press that answers the password has passed, so sudo
// readies its track inside that key press (services/warm-show.ts unlockAudio), and the show plays
// it with no key more. On a phone the key readies nothing: the show asks for the right thumb on
// its fingerprint, and the touch starts the track. Here with nothing warmed at idle (mobile
// data), and with the show's chunk late enough for the key press's own activation (five seconds
// in Chromium) to have run out before the show plays.

const SECRET = 'hunter2-correct-horse';
const prompt = (page: Page) => page.locator('input.command-input');
const show = (page: Page) => page.getByRole('dialog', { name: 'You have been rickrolled' });

test("sudo's track plays at the gesture it asks for where sound needs one", { tag: '@smoke' }, async ({ page }) => {
  const phone = test.info().project.name === 'gesture-required-phone';
  test.skip(!phone && test.info().project.name !== 'gesture-required', 'Chromium holding sound back until a gesture');
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
  if (phone) await prompt(page).tap();
  else await prompt(page).click();
  await prompt(page).fill('sudo ls');
  await prompt(page).press('Enter');
  await expect(page.locator('.edit-row .read-prompt')).toHaveText('Password: ');
  await prompt(page).pressSequentially(SECRET);
  await prompt(page).press('Enter');
  // Nothing touches the page meanwhile: Playwright's own calls into it count as gestures.
  await page.waitForTimeout(8_000);
  await expect(show(page)).toBeVisible();
  if (phone) {
    // Silent until the thumb is on the print, which the touch starts.
    await expect(show(page)).toHaveAttribute('data-sound', 'off');
    await show(page).locator('.elevate .print').tap();
  }
  await expect(show(page)).toHaveAttribute('data-source', 'track');
  await expect(show(page)).toHaveAttribute('data-sound', 'on');
  expect(await show(page).locator('audio').evaluate((element: HTMLAudioElement) => ({ paused: element.paused, muted: element.muted }))).toEqual({
    paused: false,
    muted: false,
  });
  if (phone) await show(page).tap();
  else await page.keyboard.press('Escape');
  await expect(show(page)).toBeHidden();
  expect(errors).toEqual([]);
});
