import { expect, test, type Page } from '@playwright/test';
import { isBenignConsoleMessage } from './console';

// sudo's show (src/commands/shell/sudo.run.ts, src/ui/apps/Rick.svelte): after the joke password
// the Rick app opens over the terminal, with the dancer and the status line naming the tune, and
// nothing opens anywhere else. Esc, q and ^C end it on a keyboard, the Close button and Back on a
// phone, and the sudoers line follows in the transcript. Under reduced motion one frame stands
// still. No console errors anywhere.

const PHONES = ['iphone-instagram', 'pixel-7'];
const isPhone = () => PHONES.includes(test.info().project.name);

/** The page the visitor came from, for Back to land on if it ever left vesen. */
const BEFORE = '/404.html';
const SECRET = 'hunter2-correct-horse';
const SUDOERS = 'guest is not in the sudoers file. This incident will be reported.';

const prompt = (page: Page) => page.locator('input.command-input');
const log = (page: Page) => page.getByRole('log');
const show = (page: Page) => page.getByRole('dialog', { name: 'You have been rickrolled' });
const frame = (page: Page) => show(page).locator('.frame');
const status = (page: Page) => show(page).locator('.status');

/** The entry a line was typed in, the newest first. */
const entryOf = (page: Page, line: string) =>
  page
    .locator('[role="log"] .entry')
    .filter({ has: page.locator('.command-input-display', { hasText: new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) })
    .last();

/** vesen, reached from another page, with the kernel and completion loaded and the prompt focused. */
async function arrive(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !isBenignConsoleMessage(message.text())) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(BEFORE);
  await page.goto('/');
  await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
  if (isPhone()) await prompt(page).tap();
  else await prompt(page).click();
  return errors;
}

/** Types `sudo ls`, then a password at the joke prompt, and waits for the show. */
async function sudoLs(page: Page): Promise<void> {
  await prompt(page).fill('sudo ls');
  await prompt(page).press('Enter');
  await expect(page.locator('.edit-row .read-prompt')).toHaveText('[sudo] password for guest: ');
  await prompt(page).pressSequentially(SECRET);
  await prompt(page).press('Enter');
  await expect(show(page)).toBeVisible();
}

/** The show is gone, the line has ended with the sudoers message, and nothing else opened. */
async function reported(page: Page, home: string): Promise<void> {
  await expect(show(page)).toBeHidden();
  await expect(page.locator('.app-host')).toHaveCount(0);
  await expect(log(page)).toHaveAttribute('aria-busy', 'false');
  await expect(entryOf(page, 'sudo ls')).toContainText(SUDOERS);
  await expect(entryOf(page, 'sudo ls').locator('.card')).toHaveCount(0);
  await expect(entryOf(page, 'sudo ls')).not.toContainText(SECRET);
  expect(page.url()).toBe(home);
  expect(page.context().pages()).toHaveLength(1);
}

test.describe("sudo's show", { tag: '@smoke' }, () => {
  test('opens over the terminal after the password, dances, and ends at Esc or Close with the sudoers line and no new page', async ({ page }) => {
    const errors = await arrive(page);
    const home = page.url();
    await sudoLs(page);

    await expect(show(page)).toContainText('You have been rickrolled');
    await expect(status(page)).toContainText("Never Logging Out, vesen's own 8-bit number");
    if (isPhone()) {
      await expect(show(page).getByRole('button', { name: 'Close' })).toBeVisible();
      await expect(show(page).getByRole('button', { name: /^(Mute|Unmute)$/ })).toBeVisible();
      await expect(status(page)).not.toContainText('Esc');
    } else {
      await expect(status(page)).toContainText('Esc, ^C or q to leave');
    }
    // The dancer: the stage floor is drawn, in the frame's own font, and the frames change.
    await expect(frame(page)).toContainText('━━━━');
    await expect(frame(page)).toHaveAttribute('aria-hidden', 'true');
    await expect(show(page)).toHaveAttribute('data-motion', 'running');
    const first = await frame(page).textContent();
    await expect.poll(() => frame(page).textContent(), { timeout: 3000 }).not.toBe(first);
    // Nothing scrolls sideways, and the shell under the show is inert.
    expect(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth))).toBe(0);
    await expect(page.locator('.shell')).toHaveAttribute('inert', '');
    // The password is not on the page.
    expect(await page.evaluate((secret) => document.documentElement.outerHTML.includes(secret), SECRET)).toBe(false);

    if (isPhone()) await show(page).getByRole('button', { name: 'Close' }).tap();
    else await page.keyboard.press('Escape');
    await reported(page, home);
    if (!isPhone()) await expect(prompt(page)).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('q and ^C end it too, and m mutes while the sound runs', async ({ page }) => {
    test.skip(isPhone(), 'a hardware keyboard');
    const errors = await arrive(page);
    const home = page.url();
    await sudoLs(page);
    // Where the browser lets the sound run, m mutes it and says so; where it waits for a gesture
    // of its own, the status line asks for one instead.
    const sound = await show(page).getAttribute('data-sound');
    expect(['on', 'waiting', 'off']).toContain(sound);
    if (sound === 'on') {
      await page.keyboard.press('m');
      await expect(status(page)).toContainText('(muted)');
      await page.keyboard.press('m');
      await expect(status(page)).not.toContainText('(muted)');
    } else if (sound === 'waiting') {
      await expect(status(page)).toContainText('tap or press any key for sound');
    }
    await page.keyboard.press('q');
    await reported(page, home);

    await prompt(page).click();
    await sudoLs(page);
    await page.keyboard.press('Control+c');
    await reported(page, home);
    // ^C in the show ended the show, not the line: the sudoers message followed, with no ^C mark.
    await expect(entryOf(page, 'sudo ls')).not.toContainText('^C');
    expect(errors).toEqual([]);
  });

  for (const [how, goBack] of Object.entries({
    'the browser goes back': (page: Page) => page.goBack(),
    'history.back()': (page: Page) => page.evaluate(() => history.back()),
  })) {
    test(`${how} closes it and stays on vesen`, async ({ page }) => {
      const errors = await arrive(page);
      const home = page.url();
      await sudoLs(page);
      await goBack(page);
      await reported(page, home);
      // The show's entry was its only one: one more Back is the page before vesen.
      await page.evaluate(() => void setTimeout(() => history.back(), 0));
      await expect(page).toHaveURL(/\/404\.html$/, { timeout: 15_000 });
      expect(errors).toEqual([]);
    });
  }

  test('under reduced motion one frame stands still, and Esc or Close still leaves', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const errors = await arrive(page);
    const home = page.url();
    await sudoLs(page);
    await expect(show(page)).toHaveAttribute('data-motion', 'still');
    const first = await frame(page).textContent();
    await page.waitForTimeout(400);
    expect(await frame(page).textContent()).toBe(first);
    if (isPhone()) await show(page).getByRole('button', { name: 'Close' }).tap();
    else await page.keyboard.press('Escape');
    await reported(page, home);
    expect(errors).toEqual([]);
  });

  test('into a file there is no show, only the message', async ({ page }) => {
    const errors = await arrive(page);
    await prompt(page).fill('sudo ls > /tmp/out.txt');
    await prompt(page).press('Enter');
    await expect(page.locator('.edit-row .read-prompt')).toHaveText('[sudo] password for guest: ');
    await prompt(page).pressSequentially(SECRET);
    await prompt(page).press('Enter');
    await expect(log(page)).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.app-host')).toHaveCount(0);
    await expect(entryOf(page, 'sudo ls > /tmp/out.txt')).toContainText(SUDOERS);
    expect(errors).toEqual([]);
  });
});
