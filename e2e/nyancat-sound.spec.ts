import { expect, test, type Page } from '@playwright/test';
import { isBenignConsoleMessage, isBenignPageError } from './console';

// nyancat's sound where the browser starts sound only inside a gesture, as Safari does: the
// 'gesture-required' projects. On a keyboard the Enter that runs nyancat readies its track
// (CommandSpec.plays, services/warm-show.ts unlockAudio), so the show plays it with no key more,
// even when the show's chunk comes after that key press's own activation (five seconds in
// Chromium) has run out. On a phone the show waits for a tap, which starts the track.

const prompt = (page: Page) => page.locator('input.command-input');
const show = (page: Page) => page.getByRole('dialog', { name: 'Nyan Cat' });

test("nyancat's track plays at the gesture that ran it, or the tap it asks for", { tag: '@smoke' }, async ({ page }) => {
  const phone = test.info().project.name === 'gesture-required-phone';
  test.skip(!phone && test.info().project.name !== 'gesture-required', 'Chromium holding sound back until a gesture');
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !isBenignConsoleMessage(message.text(), message.location().url)) errors.push(message.text());
  });
  page.on('pageerror', (error) => {
    if (!isBenignPageError(error.message)) errors.push(error.message);
  });
  // The show's chunk comes after the Enter's activation has run out.
  await page.route(/\/assets\/Nyan-[^/]*\.js$/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 5_500));
    await route.continue();
  });
  await page.goto('/');
  await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
  const type = async (line: string): Promise<void> => {
    await prompt(page).fill(line);
    await prompt(page).press('Enter');
  };
  if (phone) await prompt(page).tap();
  else await prompt(page).click();
  // The catalogue is here, so the Enter knows nyancat and the track it plays.
  await type('type nyancat');
  await expect(page.locator('[role="log"] .entry').last()).toContainText('nyancat is /usr/bin/nyancat');
  await type('nyancat');
  // Nothing touches the page meanwhile: Playwright's own calls into it count as gestures.
  await page.waitForTimeout(8_000);
  await expect(show(page)).toBeVisible();
  if (phone) {
    await expect(show(page)).toHaveAttribute('data-sound', 'off');
    await show(page).tap();
  }
  await expect(show(page)).toHaveAttribute('data-sound', 'on');
  expect(await show(page).locator('audio').evaluate((element: HTMLAudioElement) => ({ paused: element.paused, muted: element.muted }))).toEqual({ paused: false, muted: false });
  if (phone) await show(page).tap();
  else await page.keyboard.press('Escape');
  await expect(show(page)).toBeHidden();
  expect(errors).toEqual([]);
});
