import { expect, test, type Page } from '@playwright/test';
import { isBenignConsoleMessage } from './console';

// sudo's show (src/commands/shell/sudo.run.ts, src/ui/apps/Rick.svelte): the password prompt is
// `Password: ` alone, with no line above it, and Esc cancels it; the show's files are warmed at
// idle after boot, and --help fetches nothing more. After the password the Rick app opens over
// the terminal, with the owner's frames and their track, and nothing opens anywhere else. On a
// keyboard the screen shows the frames and, once they have played a few seconds, one line saying
// how to leave; on a phone the frames alone, filling the terminal's frame upright or on its side,
// and turning with it. Esc, q and ^C end it on a keyboard, a tap and Back on a phone; the audio
// element goes with it, and the sudoers line follows in the transcript. Without the frames file
// the stage is empty. Under reduced motion the frames still play. No console errors anywhere.

const PHONES = ['iphone-instagram', 'pixel-7'];
const isPhone = () => PHONES.includes(test.info().project.name);

/** The page the visitor came from, for Back to land on if it ever left vesen. */
const BEFORE = '/404.html';
const SECRET = 'hunter2-correct-horse';
const SUDOERS = 'guest is not in the sudoers file.';
const TRACK = '/audio/incident-report.mp3';
const FRAMES = '/audio/incident-report.frames';
/** The portrait cut, which a screen taller than wide (a phone held upright) plays instead. */
const PORTRAIT_FRAMES = '/audio/incident-report.portrait.frames';
/** Either cut: a test routes or counts the frames whichever the screen plays. */
const FRAMES_ROUTE = '**/audio/incident-report*.frames';
const isFrames = (path: string): boolean => path === FRAMES || path === PORTRAIT_FRAMES;
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

/** Types `sudo ls` and waits for the password prompt: the word alone, no dim line. */
async function sudoPrompt(page: Page): Promise<void> {
  await prompt(page).fill('sudo ls');
  await prompt(page).press('Enter');
  await expect(readPrompt(page)).toHaveText('Password: ');
  await expect(hint(page)).toHaveCount(0);
}

/** Types `sudo ls`, then a password, and waits for the show. */
async function sudoLs(page: Page): Promise<void> {
  await sudoPrompt(page);
  await prompt(page).pressSequentially(SECRET);
  await prompt(page).press('Enter');
  await expect(show(page)).toBeVisible();
  if (isPhone()) await elevate(page);
}

/**
 * On a phone the show asks for a tap first, and nothing plays or shows until it comes: the tap
 * starts the sound and the picture together, inside a gesture every browser lets start sound.
 */
async function elevate(page: Page): Promise<void> {
  await expect(show(page).locator('.elevate')).toHaveText('Tap to elevate privileges');
  await expect(show(page)).toHaveAttribute('data-sound', 'off');
  await expect(show(page)).toHaveAttribute('data-motion', 'waiting');
  await expect(show(page).locator('audio')).toHaveCount(0);
  await show(page).tap();
  await expect(show(page).locator('.elevate')).toHaveCount(0);
  await expect.poll(() => show(page).getAttribute('data-sound'), { timeout: 10_000 }).not.toBe('off');
}

/**
 * On a phone, upright or on its side, the window sits where the terminal's frame does, 4px in from
 * each edge, with all four sides of its green border in view and nothing of the picture outside it,
 * and no line under the picture; the picture covers the window inside the border, as large as it
 * must be, and is cut evenly about its centre: as much from the left as from the right, and from
 * the top as from the bottom.
 */
async function coversTheStage(page: Page): Promise<void> {
  const box = await show(page).evaluate((dialog) => {
    const host = dialog.closest('.app-host') as HTMLElement;
    const rect = (element: Element | null) => (element as HTMLElement).getBoundingClientRect().toJSON() as DOMRect;
    const own = getComputedStyle(host);
    return {
      host: rect(host),
      border: [own.borderTopWidth, own.borderRightWidth, own.borderBottomWidth, own.borderLeftWidth, own.borderTopStyle],
      clip: own.overflow,
      stage: rect(dialog.querySelector('.stage')),
      picture: rect(dialog.querySelector('.frame')),
    };
  });
  const { host, border, clip, stage, picture } = box;
  const screenSize = page.viewportSize() ?? { width: 0, height: 0 };
  // The terminal's frame, 4px in from each edge, its border whole, and the picture kept inside it.
  expect([host.left, host.top, host.width, host.height]).toEqual([4, 4, screenSize.width - 8, screenSize.height - 8]);
  expect(border).toEqual(['2px', '2px', '2px', '2px', 'solid']);
  expect(clip).toBe('hidden');
  // Inside the border, the stage is all of the window.
  expect([stage.left, stage.top]).toEqual([6, 6]);
  expect(stage.width).toBeGreaterThanOrEqual(screenSize.width - 13);
  expect(stage.height).toBeGreaterThanOrEqual(screenSize.height - 13);
  expect(picture.left).toBeLessThanOrEqual(stage.left + 1);
  expect(picture.right).toBeGreaterThanOrEqual(stage.right - 1);
  expect(picture.top).toBeLessThanOrEqual(stage.top + 1);
  expect(picture.bottom).toBeGreaterThanOrEqual(stage.bottom - 1);
  expect(Math.abs(picture.left + picture.right - stage.left - stage.right)).toBeLessThanOrEqual(2);
  expect(Math.abs(picture.top + picture.bottom - stage.top - stage.bottom)).toBeLessThanOrEqual(2);
}

/** On a phone, once elevated, a tap leaves the show; where the browser held the sound back, the first tap starts it and the next leaves. */
async function tapToLeave(page: Page): Promise<void> {
  if ((await show(page).getAttribute('data-sound')) === 'waiting') await show(page).tap();
  await show(page).tap();
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
    // Without the owner's file (routed away here) the stage is empty; the file's own test is below.
    await page.route(FRAMES_ROUTE, (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' }));
    const { errors, requests } = await arrive(page);
    const home = page.url();

    // Once the page is idle the show's files are warmed (services/warm-show.ts): the track into an
    // element kept out of the page, the frames into the cache; --help fetches nothing more, and
    // reads like sudo's own.
    await expect(audio(page)).toHaveCount(0);
    await expect.poll(() => requests.filter((path) => path === TRACK).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(() => requests.filter(isFrames).length, { timeout: 15_000 }).toBe(1);
    // The cut the screen will play, and only that one.
    expect(requests.filter(isFrames)).toEqual([isPhone() ? PORTRAIT_FRAMES : FRAMES]);
    const warmed = requests.length;
    await prompt(page).fill('sudo --help');
    await prompt(page).press('Enter');
    await expect(log(page)).toHaveAttribute('aria-busy', 'false');
    await expect(entryOf(page, 'sudo --help')).toContainText('run a command as the superuser');
    expect(await entryOf(page, 'sudo --help').textContent()).not.toMatch(TELLING);
    // Nothing new: WebKit may fetch more ranges of the warmed track whenever it likes.
    expect(requests.slice(warmed).filter((path) => path !== TRACK)).toEqual([]);
    await expect(audio(page)).toHaveCount(0);

    await sudoLs(page);
    // Nothing on the screen but the stage and, on a keyboard, the way out: no title, no mute button.
    await expect(show(page)).not.toContainText('rickrolled');
    if (isPhone()) {
      // No buttons and no words on a phone: the picture alone, and a tap leaves.
      await expect(show(page).getByRole('button')).toHaveCount(0);
      await expect(status(page)).toHaveCount(0);
    } else {
      // How to leave comes once the show has played a few seconds, not as it opens.
      expect(await status(page).textContent()).toBe('');
      await expect(status(page)).toHaveText('Press q or Esc to exit', { timeout: 10_000 });
      // It names no track and uses ASCII marks only.
      expect(await status(page).textContent()).toMatch(/^[\x20-\x7e]*$/);
      expect(await status(page).textContent()).not.toMatch(/Never|number|\.mp3/);
    }

    // The track: an element made for the show, with the file from this origin, looping, modest.
    await expect(show(page).locator('audio')).toHaveCount(1);
    await expect(audio(page)).toHaveAttribute('src', TRACK);
    expect(await audio(page).evaluate((element: HTMLAudioElement) => ({ loop: element.loop, volume: Math.round(element.volume * 100) / 100, preload: element.preload }))).toEqual({
      loop: true,
      volume: 0.6,
      preload: 'auto',
    });
    await expect(show(page)).toHaveAttribute('data-source', 'track');
    // The owner's frames file was looked for again by the show (its warm-up got this test's 404, which is not cached).
    await expect.poll(() => requests.filter(isFrames).length).toBe(2);
    // play() has settled: the track runs, or the browser waits for a gesture of its own.
    await expect.poll(() => show(page).getAttribute('data-sound'), { timeout: 10_000 }).not.toBe('off');
    const sound = await show(page).getAttribute('data-sound');
    expect(['on', 'waiting', 'muted']).toContain(sound);
    if (sound === 'on') expect(requests).toContain(TRACK);

    // Without the file (routed away in this test) the stage stays empty: nothing else is drawn.
    await expect(frame(page)).toHaveAttribute('aria-hidden', 'true');
    await expect(show(page)).toHaveAttribute('data-frames', 'none');
    await expect(show(page)).toHaveAttribute('data-motion', 'still');
    await expect(frame(page)).toHaveText('');
    // Nothing scrolls sideways, and the shell under the show is inert.
    expect(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth))).toBe(0);
    await expect(page.locator('.shell')).toHaveAttribute('inert', '');
    // The password is not on the page.
    expect(await page.evaluate((secret) => document.documentElement.outerHTML.includes(secret), SECRET)).toBe(false);

    if (isPhone()) await tapToLeave(page);
    else await page.keyboard.press('Escape');
    await reported(page, home);
    if (!isPhone()) await expect(prompt(page)).toBeFocused();
    expect(errors).toEqual([]);
  });

  test('Esc at the password prompt cancels it, as the dim line says, and the show fetches nothing of its own', async ({ page }) => {
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
      // The idle warm-up (services/warm-show.ts) may have fetched the show's files by now; the prompt itself asks for nothing.
      expect(requests.filter((path) => path !== TRACK && !isFrames(path))).toEqual([]);
      expect(await page.evaluate((secret) => document.documentElement.outerHTML.includes(secret), SECRET)).toBe(false);
    }

    await sudoPrompt(page);
    // On a phone the dock offers a Cancel chip; on a keyboard nothing shows under the prompt.
    if (isPhone()) await expect(cancelChip).toBeVisible();
    else await expect(cancelChip).toHaveCount(0);
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
    // Where the browser lets the sound run, m mutes it, and says nothing of it: the line under the
    // picture only ever says how to leave.
    const sound = await show(page).getAttribute('data-sound');
    expect(['on', 'waiting', 'off']).toContain(sound);
    if (sound === 'on') {
      await page.keyboard.press('m');
      expect(await audio(page).evaluate((element: HTMLAudioElement) => element.muted)).toBe(true);
      await expect(status(page)).not.toContainText(/mute/i);
      await page.keyboard.press('m');
    }
    await expect(status(page)).toHaveText('Press q or Esc to exit', { timeout: 10_000 });
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
    await page.route(FRAMES_ROUTE, (route) => route.fulfill({ status: 200, contentType: 'text/plain', body: file }));
    const { errors } = await arrive(page);
    const home = page.url();
    await sudoLs(page);
    await expect(show(page)).toHaveAttribute('data-frames', 'file');
    // A phone held upright plays the portrait cut, covering its screen; a desktop the whole picture.
    await expect(show(page)).toHaveAttribute('data-cut', isPhone() ? 'portrait' : 'landscape');
    await expect.poll(() => frame(page).textContent()).toMatch(/^(#####\n@@@@@|\.\.\.\.\.\n:::::)$/);
    expect(await frame(page).evaluate((element) => [element.style.getPropertyValue('--cols'), element.style.getPropertyValue('--rows')])).toEqual(['5', '2']);
    if (isPhone()) await coversTheStage(page);
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
    if (isPhone()) await tapToLeave(page);
    else await page.keyboard.press('Escape');
    await reported(page, home);
    expect(errors).toEqual([]);
  });

  test('plays under reduced motion too, as a video does, filling a phone held upright, and Esc or Close still leaves', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const { errors } = await arrive(page);
    const home = page.url();
    await sudoLs(page);
    // The owner's frames, the real ones, once they are in: playing.
    await expect(show(page)).toHaveAttribute('data-frames', 'file', { timeout: 15_000 });
    await expect(show(page)).toHaveAttribute('data-motion', 'running');
    await expect(show(page)).toHaveAttribute('data-cut', isPhone() ? 'portrait' : 'landscape');
    const first = await frame(page).textContent();
    await expect.poll(() => frame(page).textContent(), { timeout: 5000 }).not.toBe(first);
    if (isPhone()) {
      await coversTheStage(page);
      expect(await frame(page).evaluate((element) => [element.style.getPropertyValue('--cols'), element.style.getPropertyValue('--rows')])).toEqual(['72', '56']);
    }
    if (isPhone()) await tapToLeave(page);
    else await page.keyboard.press('Escape');
    await reported(page, home);
    expect(errors).toEqual([]);
  });

  test('fills a phone on its side too, and turns with it, the other cut taking over', async ({ page }) => {
    test.skip(!isPhone(), 'a phone');
    // Two small cuts, told apart by their sizes: 4 by 6 upright, 12 by 3 on its side.
    const cut = (cols: number, rows: number) =>
      [`vesen-frames fps=4 cols=${cols} rows=${rows}`, ...Array.from({ length: rows }, () => '#'.repeat(cols)), '===', ...Array.from({ length: rows }, () => '.'.repeat(cols)), ''].join('\n');
    await page.route(FRAMES_ROUTE, (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', body: new URL(route.request().url()).pathname === PORTRAIT_FRAMES ? cut(4, 6) : cut(12, 3) }),
    );
    const { errors } = await arrive(page);
    const home = page.url();
    const upright = page.viewportSize() ?? { width: 390, height: 664 };
    const cols = () => frame(page).evaluate((element) => element.style.getPropertyValue('--cols'));
    await sudoLs(page);
    await expect(show(page)).toHaveAttribute('data-frames', 'file');
    await expect(show(page)).toHaveAttribute('data-cut', 'portrait');
    expect(await cols()).toBe('4');
    await coversTheStage(page);

    // On its side: the whole picture takes over, and covers the screen too.
    await page.setViewportSize({ width: upright.height, height: upright.width });
    await expect(show(page)).toHaveAttribute('data-cut', 'landscape');
    expect(await cols()).toBe('12');
    await coversTheStage(page);
    expect(await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth))).toBe(0);

    // And upright again.
    await page.setViewportSize(upright);
    await expect(show(page)).toHaveAttribute('data-cut', 'portrait');
    expect(await cols()).toBe('4');
    await coversTheStage(page);
    await tapToLeave(page);
    await reported(page, home);
    expect(errors).toEqual([]);
  });

  test('into a file there is no show, only the message', async ({ page }) => {
    const { errors, requests } = await arrive(page);
    await prompt(page).fill('sudo ls > /tmp/out.txt');
    await prompt(page).press('Enter');
    await expect(readPrompt(page)).toHaveText('Password: ');
    await prompt(page).pressSequentially(SECRET);
    await prompt(page).press('Enter');
    await expect(log(page)).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.app-host')).toHaveCount(0);
    await expect(entryOf(page, 'sudo ls > /tmp/out.txt')).toContainText(SUDOERS);
    await expect(audio(page)).toHaveCount(0);
    // Only the idle warm-up's requests (services/warm-show.ts), if it has run yet: the show fetched nothing of its own.
    expect(requests.filter((path) => path !== TRACK && !isFrames(path))).toEqual([]);
    expect(requests.filter(isFrames).length).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});
