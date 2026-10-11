import { expect, test, type Page } from '@playwright/test';
import { isBenignConsoleMessage } from './console';

// sudo's show (src/commands/shell/sudo.run.ts, src/ui/apps/Rick.svelte): the dim line above the
// password prompt says only how to cancel, and Esc does cancel it; nothing of the show is fetched
// at boot or for --help. After the password the Rick app opens over the terminal, with the dancer
// and an <audio> element for the owner's track made only then, and nothing opens anywhere else.
// Esc, q and ^C end it on a keyboard, the Close button and Back on a phone; the element goes with
// it, and the sudoers line follows in the transcript. The owner's frames file plays when it is
// there. Under reduced motion one frame stands still. No console errors anywhere.

const PHONES = ['iphone-instagram', 'pixel-7'];
const isPhone = () => PHONES.includes(test.info().project.name);

/** The page the visitor came from, for Back to land on if it ever left vesen. */
const BEFORE = '/404.html';
const SECRET = 'hunter2-correct-horse';
const SUDOERS = 'guest is not in the sudoers file. This incident will be reported.';
const TRACK = '/audio/incident-report.mp3';
const FRAMES = '/audio/incident-report.frames';
const HINT = { keyboard: 'Ctrl+C or Esc to cancel', touch: 'Tap Cancel or press Esc to cancel' };
/** Words that would give the show away before it opens. */
const TELLING = /joke|show|dancer|tune|track|rickroll|never kept/i;

const prompt = (page: Page) => page.locator('input.command-input');
const log = (page: Page) => page.getByRole('log');
const readPrompt = (page: Page) => page.locator('.edit-row .read-prompt');
const hint = (page: Page) => page.locator('.prompt-line .hint');
const show = (page: Page) => page.getByRole('dialog', { name: 'You have been rickrolled' });
const frame = (page: Page) => show(page).locator('.frame');
const status = (page: Page) => show(page).locator('.status');
const audio = (page: Page) => page.locator('audio');

/** The entry a line was typed in, the newest first. */
const entryOf = (page: Page, line: string) =>
  page
    .locator('[role="log"] .entry')
    .filter({ has: page.locator('.command-input-display', { hasText: new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) })
    .last();

/** vesen, reached from another page, with the kernel and completion loaded and the prompt focused. */
async function arrive(page: Page): Promise<{ errors: string[]; requests: string[] }> {
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !isBenignConsoleMessage(message.text(), message.location().url)) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith('/audio/')) requests.push(path);
  });
  await page.goto(BEFORE);
  await page.goto('/');
  await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
  if (isPhone()) await prompt(page).tap();
  else await prompt(page).click();
  return { errors, requests };
}

/** Types `sudo ls` and waits for the password prompt, with its dim line. */
async function sudoPrompt(page: Page): Promise<void> {
  await prompt(page).fill('sudo ls');
  await prompt(page).press('Enter');
  await expect(readPrompt(page)).toHaveText('[sudo] password for guest: ');
  await expect(hint(page)).toHaveText(isPhone() ? HINT.touch : HINT.keyboard);
}

/** Types `sudo ls`, then a password, and waits for the show. */
async function sudoLs(page: Page): Promise<void> {
  await sudoPrompt(page);
  await prompt(page).pressSequentially(SECRET);
  await prompt(page).press('Enter');
  await expect(show(page)).toBeVisible();
}

/** The show is gone, with its audio element, the line has ended with the sudoers message, and nothing else opened. */
async function reported(page: Page, home: string): Promise<void> {
  await expect(show(page)).toBeHidden();
  await expect(page.locator('.app-host')).toHaveCount(0);
  await expect(audio(page)).toHaveCount(0);
  await expect(log(page)).toHaveAttribute('aria-busy', 'false');
  await expect(entryOf(page, 'sudo ls')).toContainText(SUDOERS);
  await expect(entryOf(page, 'sudo ls').locator('.card')).toHaveCount(0);
  await expect(entryOf(page, 'sudo ls')).not.toContainText(SECRET);
  expect(page.url()).toBe(home);
  expect(page.context().pages()).toHaveLength(1);
}

test.describe("sudo's show", { tag: '@smoke' }, () => {
  test('opens over the terminal after the password, with the track, dances, and ends at Esc or Close with the sudoers line and no new page', async ({ page }) => {
    const { errors, requests } = await arrive(page);
    const home = page.url();

    // Before the show there is no audio element, nothing of it was fetched, and --help reads like sudo's own.
    await expect(audio(page)).toHaveCount(0);
    await prompt(page).fill('sudo --help');
    await prompt(page).press('Enter');
    await expect(log(page)).toHaveAttribute('aria-busy', 'false');
    await expect(entryOf(page, 'sudo --help')).toContainText('run a command as the superuser');
    expect(await entryOf(page, 'sudo --help').textContent()).not.toMatch(TELLING);
    expect(requests).toEqual([]);
    await expect(audio(page)).toHaveCount(0);

    await sudoLs(page);
    await expect(show(page)).toContainText('You have been rickrolled');
    if (isPhone()) {
      await expect(show(page).getByRole('button', { name: 'Close' })).toBeVisible();
      await expect(show(page).getByRole('button', { name: /^(Mute|Unmute)$/ })).toBeVisible();
      await expect(status(page)).not.toContainText('Esc');
    } else {
      await expect(status(page)).toContainText('Esc, ^C or q to leave');
    }
    // The status line names no track and uses ASCII marks only.
    expect(await status(page).textContent()).toMatch(/^[\x20-\x7e]*$/);
    expect(await status(page).textContent()).not.toMatch(/Never|number|\.mp3/);

    // The track: an element made for the show, with the file from this origin, looping, modest.
    await expect(show(page).locator('audio')).toHaveCount(1);
    await expect(audio(page)).toHaveAttribute('src', TRACK);
    expect(await audio(page).evaluate((element: HTMLAudioElement) => ({ loop: element.loop, volume: Math.round(element.volume * 100) / 100, preload: element.preload }))).toEqual({
      loop: true,
      volume: 0.6,
      preload: 'auto',
    });
    await expect(show(page)).toHaveAttribute('data-source', 'track');
    // The owner's frames file was looked for, once, and only now.
    await expect.poll(() => requests.filter((path) => path === FRAMES).length).toBe(1);
    // play() has settled: the track runs, or the browser waits for a gesture of its own.
    await expect.poll(() => show(page).getAttribute('data-sound'), { timeout: 10_000 }).not.toBe('off');
    const sound = await show(page).getAttribute('data-sound');
    expect(['on', 'waiting', 'muted']).toContain(sound);
    if (sound === 'on') expect(requests).toContain(TRACK);

    // The dancer: the stage floor is drawn in ASCII, in the frame's own font, and the frames change.
    await expect(frame(page)).toContainText('====');
    await expect(frame(page)).toHaveAttribute('aria-hidden', 'true');
    await expect(show(page)).toHaveAttribute('data-motion', 'running');
    await expect(show(page)).toHaveAttribute('data-frames', 'drawn');
    const first = await frame(page).textContent();
    expect(first).toMatch(/^[\x20-\x7e\n]*$/);
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

  test('Esc at the password prompt cancels it, as the dim line says, and nothing of the show is fetched', async ({ page }) => {
    const { errors, requests } = await arrive(page);
    const cancelChip = page.getByRole('option', { name: 'Cancel the password prompt' });

    /** The read is over with no show and no sudoers line, and the prompt is back for the next line. */
    async function cancelled(): Promise<void> {
      await expect(readPrompt(page)).toHaveCount(0);
      await expect(hint(page)).toHaveCount(0);
      await expect(log(page)).toHaveAttribute('aria-busy', 'false');
      await expect(show(page)).toHaveCount(0);
      await expect(entryOf(page, 'sudo ls')).not.toContainText(SUDOERS);
      await expect(audio(page)).toHaveCount(0);
      expect(requests).toEqual([]);
      expect(await page.evaluate((secret) => document.documentElement.outerHTML.includes(secret), SECRET)).toBe(false);
    }

    await sudoPrompt(page);
    // On a phone the dock offers the Cancel chip the hint names.
    if (isPhone()) await expect(cancelChip).toBeVisible();
    await prompt(page).pressSequentially(SECRET);
    await page.keyboard.press('Escape');
    await cancelled();
    await prompt(page).fill('echo after');
    await prompt(page).press('Enter');
    await expect(entryOf(page, 'echo after')).toContainText('after');

    if (isPhone()) {
      await sudoPrompt(page);
      await prompt(page).pressSequentially(SECRET);
      await cancelChip.tap();
      await cancelled();
    }
    expect(errors).toEqual([]);
  });

  test('q and ^C end it too, and m mutes while the sound runs', async ({ page }) => {
    test.skip(isPhone(), 'a hardware keyboard');
    const { errors } = await arrive(page);
    const home = page.url();
    await sudoLs(page);
    // Where the browser lets the sound run, m mutes it and says so; where it waits for a gesture
    // of its own, the status line asks for one instead.
    const sound = await show(page).getAttribute('data-sound');
    expect(['on', 'waiting', 'off']).toContain(sound);
    if (sound === 'on') {
      await expect(status(page)).toHaveText('Esc, ^C or q to leave; m to mute');
      await page.keyboard.press('m');
      await expect(status(page)).toHaveText('Esc, ^C or q to leave; m to unmute');
      expect(await audio(page).evaluate((element: HTMLAudioElement) => element.muted)).toBe(true);
      await page.keyboard.press('m');
      await expect(status(page)).toHaveText('Esc, ^C or q to leave; m to mute');
    } else if (sound === 'waiting') {
      await expect(status(page)).toHaveText('tap or press any key for sound; Esc, ^C or q to leave');
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
      const { errors } = await arrive(page);
      const home = page.url();
      await sudoLs(page);
      await goBack(page);
      await reported(page, home);
      // The show's entry was its only one: one more Back is the page before vesen. That Back
      // leaves the document, so it is the browser's own (a page.evaluate in flight while the
      // document goes away fails with "Execution context was destroyed" on a slow machine).
      await page.goBack({ timeout: 15_000 });
      await expect(page).toHaveURL(/\/404\.html$/, { timeout: 15_000 });
      expect(errors).toEqual([]);
    });
  }

  test("plays the owner's frames when the file is there, fitted to their size", async ({ page }) => {
    const file = ['vesen-frames fps=4 cols=5 rows=2', '#####', '@@@@@', '===', '.....', ':::::', ''].join('\n');
    await page.route(`**${FRAMES}`, (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: file }));
    const { errors } = await arrive(page);
    const home = page.url();
    await sudoLs(page);
    await expect(show(page)).toHaveAttribute('data-frames', 'file');
    await expect.poll(() => frame(page).textContent()).toMatch(/^(#####\n@@@@@|\.\.\.\.\.\n:::::)$/);
    expect(await frame(page).evaluate((element) => [element.style.getPropertyValue('--cols'), element.style.getPropertyValue('--rows')])).toEqual(['5', '2']);
    // At four a second the frames change. Watched from inside the page, frame by frame: a poll from
    // outside, settling into one-second intervals, samples a two-frame loop at the same phase every time.
    const changed = await frame(page).evaluate(
      (element) =>
        new Promise<boolean>((resolve) => {
          const first = element.textContent;
          const deadline = Date.now() + 10_000;
          const look = (): void => {
            if (element.textContent !== first) resolve(true);
            else if (Date.now() > deadline) resolve(false);
            else requestAnimationFrame(look);
          };
          look();
        }),
    );
    expect(changed, 'the frames change').toBe(true);
    expect(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth))).toBe(0);
    if (isPhone()) await show(page).getByRole('button', { name: 'Close' }).tap();
    else await page.keyboard.press('Escape');
    await reported(page, home);
    expect(errors).toEqual([]);
  });

  test('under reduced motion one frame stands still, and Esc or Close still leaves', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { errors } = await arrive(page);
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
    const { errors, requests } = await arrive(page);
    await prompt(page).fill('sudo ls > /tmp/out.txt');
    await prompt(page).press('Enter');
    await expect(readPrompt(page)).toHaveText('[sudo] password for guest: ');
    await prompt(page).pressSequentially(SECRET);
    await prompt(page).press('Enter');
    await expect(log(page)).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.app-host')).toHaveCount(0);
    await expect(entryOf(page, 'sudo ls > /tmp/out.txt')).toContainText(SUDOERS);
    await expect(audio(page)).toHaveCount(0);
    expect(requests).toEqual([]);
    expect(errors).toEqual([]);
  });
});
