import { expect, test, type Page } from '@playwright/test';
import { isBenignConsoleMessage } from './console';

// Back while a full-screen app is open. A visitor who comes from Instagram's bio and opens man,
// less, nano, cmatrix or sl, then presses Back (Android's button, iOS's edge swipe), lands back
// at the prompt: the page never goes back past vesen. Each app has one history entry; Back closes
// the app through its own close path, nano with unsaved changes asks to save first, and a normal
// close takes the entry off again without going back twice. The page before vesen stands in for
// Instagram's, so Back past vesen would show it. It is the site's own 404 page: a cross-site Back
// in WebKit swaps processes, which Playwright sometimes reports as a cancelled navigation.

const PHONES = ['iphone-instagram', 'pixel-7'];
const isPhone = () => PHONES.includes(test.info().project.name);

/** The page the visitor came from. */
const BEFORE = '/404.html';
const wasBefore = async (page: Page): Promise<void> => {
  await expect(page).toHaveURL(/\/404\.html$/);
  await expect(page.getByText('No such file or directory')).toBeVisible();
};

/**
 * One Back out of vesen, which must reach the page before it: a stray entry of vesen's would keep
 * the page where it is. The page goes back itself, and the URL decides. Under load, WebKit now and
 * then reports a page.goBack() from a page that has shown the pager as "Navigation canceled by
 * policy check" while the page goes back anyway a moment later (as it did before vesen had any
 * history entry of its own), so Playwright's view of that navigation plays no part here.
 */
async function leave(page: Page): Promise<void> {
  await page.evaluate(() => void setTimeout(() => history.back(), 0));
  await expect(page).toHaveURL(/\/404\.html$/, { timeout: 15_000 });
  await wasBefore(page);
}

const prompt = (page: Page) => page.locator('input.command-input');
const log = (page: Page) => page.getByRole('log');
const appHost = (page: Page) => page.locator('.app-host');
const editor = (page: Page) => page.locator('[data-editor]');

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
  await focusPrompt(page);
  return errors;
}

async function focusPrompt(page: Page): Promise<void> {
  if (isPhone()) await prompt(page).tap();
  else await prompt(page).click();
}

/** Types a line at the prompt and presses Enter, without waiting for it to end. */
async function enter(page: Page, line: string): Promise<void> {
  await prompt(page).fill(line);
  await prompt(page).press('Enter');
}

/** Still on vesen, at the prompt, with the line's entry in the transcript and nothing running. */
async function backAtPrompt(page: Page, line: string, home: string): Promise<void> {
  await expect(appHost(page)).toHaveCount(0);
  await expect(log(page)).toHaveAttribute('aria-busy', 'false');
  expect(page.url()).toBe(home);
  await expect(entryOf(page, line)).toHaveCount(1);
  await expect(prompt(page)).toBeVisible();
}

const BACKS = {
  'the browser goes back': (page: Page) => page.goBack(),
  'history.back()': (page: Page) => page.evaluate(() => history.back()),
} as const;

const APPS = [
  { line: 'man ls', shows: '[data-pager]' },
  { line: 'less README.md', shows: '[data-pager]' },
  { line: 'nano ~/draft.txt', shows: '[data-editor]' },
  { line: 'cmatrix', shows: '.matrix' },
  { line: 'sl', shows: '.sl' },
] as const;

test.describe('Back while an app is open', { tag: '@smoke' }, () => {
  for (const { line, shows } of APPS) {
    for (const [how, goBack] of Object.entries(BACKS)) {
      test(`'${line}': ${how} closes it and stays on vesen`, async ({ page }) => {
        const errors = await arrive(page);
        const home = page.url();
        await enter(page, line);
        await expect(page.locator(shows)).toBeVisible();

        await goBack(page);
        await backAtPrompt(page, line, home);
        // Nothing printed in its place (the text, a still frame, "could not be opened"): the app
        // closed the way it closes itself.
        await expect(entryOf(page, line).locator('.command-output')).toHaveCount(0);

        // The app's entry was its only one: the next Back leaves for the page before vesen.
        await leave(page);
        expect(errors).toEqual([]);
      });
    }
  }

  test('nano with unsaved changes asks to save on Back, keeps the text, and saves it', async ({ page }) => {
    const errors = await arrive(page);
    const home = page.url();
    await enter(page, 'nano ~/draft.txt');
    const text = editor(page).locator('textarea');
    await expect(text).toBeVisible();
    if (isPhone()) {
      await text.tap();
      await text.fill('unsaved words');
    } else {
      await expect(text).toBeFocused();
      await page.keyboard.type('unsaved words');
    }
    await expect(editor(page)).toContainText('Modified');

    // Back asks, and the editor stays.
    await page.goBack();
    await expect(editor(page).locator('.question')).toHaveText('Save modified buffer?');
    expect(page.url()).toBe(home);
    await expect(text).toHaveValue('unsaved words');

    // Back again while it asks leaves the question up: only Y, N or ^C answers it.
    await page.evaluate(() => history.back());
    await page.waitForTimeout(300);
    await expect(editor(page).locator('.question')).toHaveText('Save modified buffer?');
    await expect(text).toHaveValue('unsaved words');
    expect(page.url()).toBe(home);

    // Yes, then the file name, saves and leaves.
    if (isPhone()) {
      await page.getByRole('button', { name: 'Yes' }).tap();
      await expect(page.getByRole('textbox', { name: /Write to|File Name to Write/ })).toHaveValue('/home/guest/draft.txt');
      await page.getByRole('button', { name: 'Save' }).tap();
    } else {
      await page.keyboard.press('y');
      await expect(page.getByRole('textbox', { name: 'File Name to Write:' })).toBeFocused();
      await page.keyboard.press('Enter');
    }
    await backAtPrompt(page, 'nano ~/draft.txt', home);

    await focusPrompt(page);
    await enter(page, 'cat ~/draft.txt');
    await expect(entryOf(page, 'cat ~/draft.txt')).toContainText('unsaved words');
    // nano's entry, and the one it put back while it asked, are both gone: Back leaves vesen.
    await leave(page);
    expect(errors).toEqual([]);
  });

  test('closing an app normally takes its entry off once, and the Back snapshot still comes back', async ({ page }) => {
    const errors = await arrive(page);
    const home = page.url();
    await enter(page, 'man ls');
    const pager = page.locator('[data-pager]');
    const quit = async (): Promise<void> => {
      if (isPhone()) await page.getByRole('button', { name: 'Close' }).tap();
      else await page.keyboard.press('q');
    };
    await expect(pager).toBeVisible();
    await quit();
    await backAtPrompt(page, 'man ls', home);
    // Not twice: still on vesen once the page has settled.
    await page.waitForTimeout(300);
    expect(page.url()).toBe(home);
    await expect(entryOf(page, 'man ls')).toHaveCount(1);

    // Two apps one after the other on one line: the second gets its own entry, and Back closes it.
    const line = 'echo marker-5150; man ls; man cd';
    await focusPrompt(page);
    await enter(page, line);
    await expect(pager.locator('.status')).toContainText('ls(1)');
    await quit();
    await expect(pager.locator('.status')).toContainText('cd(1)');
    await page.goBack();
    await backAtPrompt(page, line, home);
    await page.waitForTimeout(300);
    expect(page.url()).toBe(home);

    // Away to another page and Back: the snapshot brings the screen back.
    await page.goto(BEFORE);
    await wasBefore(page);
    await page.goBack();
    await expect(log(page)).toContainText('marker-5150');
    expect(page.url()).toBe(home);
    // No entry was left behind: one more Back is the page before vesen.
    await leave(page);
    expect(errors).toEqual([]);
  });

  test("an app that opens before the last one's own Back has landed still gets its entry", async ({ page }) => {
    // A busy phone: the page's own history.back() takes a while to land, so the next app opens
    // first. A push made then would be undone by that Back, or would sit under it.
    await page.addInitScript(() => {
      const back = History.prototype.back;
      const win = window as Window & { __slowBack?: boolean };
      win.__slowBack = true;
      History.prototype.back = function (this: History) {
        if (win.__slowBack === true) setTimeout(() => back.call(this), 400);
        else back.call(this);
      };
    });
    const entry = (): Promise<unknown> => page.evaluate(() => (history.state as { vesenApp?: unknown } | null)?.vesenApp ?? null);
    const errors = await arrive(page);
    const home = page.url();
    const pager = page.locator('[data-pager]');
    const line = 'man ls; man cd';
    await enter(page, line);
    await expect(pager.locator('.status')).toContainText('ls(1)');
    const first = await entry();
    expect(typeof first).toBe('string');
    if (isPhone()) await page.getByRole('button', { name: 'Close' }).tap();
    else await page.keyboard.press('q');
    await expect(pager.locator('.status')).toContainText('cd(1)');
    // Once the first one's Back has landed, the second has an entry of its own, and Back closes it.
    await expect.poll(entry).not.toBe(first);
    expect(typeof (await entry())).toBe('string');
    // The browser's own Back from here on, at its own pace.
    await page.evaluate(() => ((window as Window & { __slowBack?: boolean }).__slowBack = false));
    await page.goBack();
    await backAtPrompt(page, line, home);
    await leave(page);
    expect(errors).toEqual([]);
  });
});

// What Back meets on a slow phone and after a reload: an app whose chunk is still on its way, and
// a history entry that an app of the page before the reload held.
test.describe('Back before an app has loaded, and after a reload', { tag: '@smoke' }, () => {
  const entryState = (page: Page): Promise<unknown> => page.evaluate(() => (history.state as { vesenApp?: unknown } | null)?.vesenApp ?? null);

  for (const { line, chunk } of [
    { line: 'nano ~/x.txt', chunk: /\/assets\/Editor-[\w-]+\.js$/ },
    { line: 'man ls', chunk: /\/assets\/Pager-[\w-]+\.js$/ },
  ]) {
    test(`'${line}': Back while its chunk loads closes it as it closes itself`, async ({ page }) => {
      let release: () => void = () => {};
      const arrived = new Promise<void>((resolve) => (release = resolve));
      await page.route(chunk, async (route) => {
        await arrived;
        await route.continue();
      });
      const errors = await arrive(page);
      const home = page.url();
      await enter(page, line);
      // AppHost is up and holds its entry; the app itself has not come.
      await expect.poll(() => entryState(page)).not.toBeNull();
      await expect(appHost(page)).toHaveCount(1);
      await page.goBack();
      expect(page.url()).toBe(home);
      release();
      await backAtPrompt(page, line, home);
      // Not "the editor could not be opened", and not the manual printed in its place.
      await expect(entryOf(page, line).locator('.command-output')).toHaveCount(0);
      await leave(page);
      expect(errors).toEqual([]);
    });
  }

  test('a reload while the pager is open leaves no entry behind: one Back leaves vesen', async ({ page }) => {
    const errors = await arrive(page);
    await enter(page, 'man ls');
    await expect(page.locator('[data-pager]')).toBeVisible();
    await page.reload();
    await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
    await expect(appHost(page)).toHaveCount(0);
    // The entry the pager held comes off without reloading the page again.
    await expect.poll(() => entryState(page)).toBeNull();
    expect(await page.evaluate(() => (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type)).toBe('reload');
    await leave(page);
    expect(errors).toEqual([]);
  });

  test("Forward onto a closed app's entry comes straight back off it", async ({ page }) => {
    const errors = await arrive(page);
    const home = page.url();
    await enter(page, 'man ls');
    await expect(page.locator('[data-pager]')).toBeVisible();
    await page.goBack();
    await backAtPrompt(page, 'man ls', home);
    await page.goForward();
    await expect.poll(() => entryState(page)).toBeNull();
    await expect(appHost(page)).toHaveCount(0);
    expect(page.url()).toBe(home);
    await leave(page);
    expect(errors).toEqual([]);
  });
});

// A phone's browser may skip the entry nano put back while it asked, so Back could still leave
// vesen with the buffer unsaved: nano keeps it when the page goes, and offers it back.
test.describe("nano's unsaved buffer when the page goes anyway", { tag: '@smoke' }, () => {
  test('is offered back by the next nano of the file, and Yes restores it', async ({ page }) => {
    page.on('dialog', (dialog) => void dialog.accept());
    const errors = await arrive(page);
    await enter(page, 'nano ~/draft.txt');
    const text = editor(page).locator('textarea');
    await expect(text).toBeVisible();
    if (isPhone()) {
      await text.tap();
      await text.fill('words nobody saved');
    } else {
      await expect(text).toBeFocused();
      await page.keyboard.type('words nobody saved');
    }
    await expect(editor(page)).toContainText('Modified');

    // Away, with no popstate for nano to catch, as when the browser skips its entry.
    await page.goto(BEFORE);
    await wasBefore(page);
    await page.goto('/');
    await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
    await focusPrompt(page);
    await enter(page, 'nano ~/draft.txt');
    await expect(editor(page).locator('.question')).toHaveText('Restore unsaved changes from before?');
    await expect(text).toHaveValue('');
    if (isPhone()) await page.getByRole('button', { name: 'Yes' }).tap();
    else await page.keyboard.press('y');
    await expect(text).toHaveValue('words nobody saved');
    await expect(editor(page)).toContainText('Modified');
    expect(errors).toEqual([]);
  });
});
