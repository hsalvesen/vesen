import { expect, test, type Page } from '@playwright/test';
import { isBenignConsoleMessage } from './console';

// sudo's sound where the browser starts sound only inside a gesture, as Safari does. The
// 'gesture-required' projects are Chromium told to ask the same, on a desktop and on a phone. The
// show opens after the gesture has passed, so sudo readies its track inside it (services/warm-show.ts
// unlockAudio): on a keyboard the key press that answers the password, on a phone the tap that
// elevates privileges, which the terminal asks for after the password. The show then plays it
// with no key or tap more. Here with nothing warmed at idle (mobile data), and with the show's
// chunk late enough for the gesture's own activation (five seconds in Chromium) to have run out
// before the show plays.

const SECRET = 'hunter2-correct-horse';
const prompt = (page: Page) => page.locator('input.command-input');
const show = (page: Page) => page.getByRole('dialog', { name: 'You have been rickrolled' });

test("sudo's track plays with no key or tap more where sound needs a gesture", { tag: '@smoke' }, async ({ page }) => {
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
  // The show's chunk comes after the gesture's activation has run out.
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
  // On a phone the key that answers readies nothing: the tap after it does.
  if (phone) await page.getByRole('button', { name: 'Tap to elevate privileges' }).tap();
  // Nothing touches the page meanwhile: Playwright's own calls into it count as gestures.
  await page.waitForTimeout(8_000);
  await expect(show(page)).toBeVisible();
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
