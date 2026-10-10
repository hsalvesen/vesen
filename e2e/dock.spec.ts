import { expect, test, type Locator, type Page } from '@playwright/test';
import { fakeVisualViewport } from './viewport';

// The phone dock (docs/plan/04-phone-and-instagram.md, "Dock, chips and key bar" and "What
// visitors get"; designs/phone-and-instagram.md, S5 and sections A to D; F067): chips that run or
// build a line by tapping, a key bar that never takes focus from the prompt, a history sheet, and
// a dock that rides above the keyboard without covering the prompt.

const PHONES = ['iphone-instagram', 'pixel-7'];
const isPhone = () => PHONES.includes(test.info().project.name);

const prompt = (page: Page) => page.locator('input.command-input');
const dock = (page: Page) => page.locator('.dock');
const echoes = (page: Page) => page.locator('[role="log"] .command-input-display');
const lastEntry = (page: Page) => page.locator('[role="log"] .entry').last();
const chip = (page: Page, name: string) => dock(page).getByRole('option', { name, exact: true });
const key = (page: Page, name: string) => dock(page).getByRole('button', { name, exact: true });

/** Opens the terminal with the kernel, the completion engine and the dock loaded. */
async function open(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
  await expect(chip(page, 'Run: help')).toBeVisible();
}

async function focusPrompt(page: Page): Promise<void> {
  await prompt(page).tap();
  await expect(prompt(page)).toBeFocused();
}

/** Holds a finger on `target` for `ms`, as a long press. */
async function longPress(target: Locator, ms = 700): Promise<void> {
  const box = await target.boundingBox();
  if (!box) throw new Error('nothing to press');
  const at = { clientX: box.x + box.width / 2, clientY: box.y + box.height / 2, pointerType: 'touch', isPrimary: true, button: 0, pointerId: 7 };
  await target.dispatchEvent('pointerdown', at);
  await target.page().waitForTimeout(ms);
  await target.dispatchEvent('pointerup', at);
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const widths = await page.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
    view: window.innerWidth,
  }));
  expect(widths.page).toBeLessThanOrEqual(widths.view);
  expect(widths.body).toBeLessThanOrEqual(widths.view);
}

/**
 * The dock never covers the prompt: the screen, which holds it, ends where the dock begins, and
 * with the transcript at its end (where a long output may have left it further up), the prompt's
 * input sits wholly above the dock, in view.
 */
async function promptAboveDock(page: Page): Promise<void> {
  const boxes = await page.evaluate(() => {
    const main = document.querySelector('main') as HTMLElement;
    main.scrollTop = main.scrollHeight;
    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().toJSON() as DOMRect;
    return { input: box('input.command-input'), frame: box('.screen-frame'), dock: box('.dock'), height: window.innerHeight };
  });
  expect(boxes.frame.bottom).toBeLessThanOrEqual(boxes.dock.top + 0.5);
  expect(boxes.input.bottom).toBeLessThanOrEqual(boxes.dock.top);
  expect(boxes.input.top).toBeGreaterThanOrEqual(boxes.frame.top);
  expect(boxes.dock.bottom).toBeLessThanOrEqual(boxes.height + 0.5);
}

for (const size of [
  { width: 375, height: 812 },
  { width: 375, height: 560 },
]) {
  test.describe(`the dock at ${size.width}x${size.height}`, { tag: '@smoke' }, () => {
    test.use({ viewport: size });
    test.beforeEach(() => {
      test.skip(!isPhone(), 'a touch screen');
    });

    test('a starter chip runs help in one tap, without opening the keyboard', async ({ page }) => {
      await open(page);
      await expect(prompt(page)).not.toBeFocused();
      await expect(key(page, 'Type a command')).toBeVisible();
      const before = await echoes(page).count();
      await chip(page, 'Run: help').tap();
      await expect(echoes(page)).toHaveCount(before + 1);
      await expect(lastEntry(page)).toContainText('help');
      await expect(page.locator('main')).toContainText('fastfetch');
      await expect(prompt(page)).not.toBeFocused();
      // What follows help, one tap each.
      await expect(chip(page, 'Run: cat ~/README.md')).toBeVisible();
      await expect(chip(page, 'Run: cat ~/README.md')).toHaveText(/cat README\.md/);
      await noSidewaysScroll(page);
    });

    test("builds and runs theme wombat by tapping chips after typing 'the'", async ({ page }) => {
      await open(page);
      await focusPrompt(page);
      await prompt(page).fill('the');
      await chip(page, 'Insert: theme').tap();
      await expect(prompt(page)).toHaveValue('theme ');
      await expect(prompt(page)).toBeFocused();
      // After `theme `: ls, then every theme, each labelled with the word only and named with the whole line.
      await expect(chip(page, 'Run: theme ls')).toBeVisible();
      await expect(dock(page).getByRole('option', { name: /^Run: theme (?!ls$)/ })).toHaveCount(15);
      const wombat = chip(page, 'Run: theme wombat');
      await expect(wombat).toContainText('wombat');
      await expect(wombat).not.toContainText('theme');
      await wombat.tap();
      await expect(lastEntry(page)).toContainText('theme wombat');
      await expect(lastEntry(page)).toContainText(/Theme set to wombat\./i);
      await expect(prompt(page)).toHaveValue('');
      // The keyboard stayed open throughout.
      await expect(prompt(page)).toBeFocused();
      await noSidewaysScroll(page);
    });

    test('tab completes, as the key does, and keeps focus in the prompt', async ({ page }) => {
      await open(page);
      await focusPrompt(page);
      await prompt(page).fill('cat docu');
      await key(page, 'Tab: complete').tap();
      await expect(prompt(page)).toHaveValue('cat documents/');
      await expect(prompt(page)).toBeFocused();
      // A folder offers what is inside it next.
      await expect(chip(page, 'Insert: linux.txt')).toBeVisible();
      await chip(page, 'Insert: linux.txt').tap();
      await expect(prompt(page)).toHaveValue('cat documents/linux.txt ');
      await chip(page, 'Run: cat documents/linux.txt').tap();
      await expect(lastEntry(page)).toContainText('Linux');
      await expect(prompt(page)).toBeFocused();
    });

    test('holding ↑ opens the history sheet; a tap there puts the line at the prompt', async ({ page }) => {
      await open(page);
      const before = await echoes(page).count();
      await chip(page, 'Run: ls').tap();
      await expect(echoes(page)).toHaveCount(before + 1);
      await focusPrompt(page);
      await longPress(key(page, 'Previous command (hold for history)'));
      const sheet = page.getByRole('dialog', { name: 'History' });
      await expect(sheet).toBeVisible();
      await expect(sheet.getByRole('button', { name: 'Insert: ls' })).toBeFocused();
      await sheet.getByRole('button', { name: 'Insert: ls' }).tap();
      await expect(sheet).toHaveCount(0);
      await expect(prompt(page)).toHaveValue('ls');
      await expect(prompt(page)).toBeFocused();
      // Escape closes it too.
      await longPress(key(page, 'Previous command (hold for history)'));
      await expect(sheet).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(sheet).toHaveCount(0);
    });

    test('never covers the prompt, open or closed, and rides above a keyboard', async ({ page }) => {
      await open(page);
      await promptAboveDock(page);
      for (const line of ['help', 'ls -a', 'theme ls']) {
        await focusPrompt(page);
        await prompt(page).fill(line);
        await prompt(page).press('Enter');
        await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
      }
      await expect(dock(page).locator('.key-bar')).toBeVisible();
      await promptAboveDock(page);
      await noSidewaysScroll(page);
      await prompt(page).evaluate((input) => input.blur());
      await expect(key(page, 'Type a command')).toBeVisible();
      await promptAboveDock(page);
    });

    test('while sleep 5 runs, the one cancel chip stops it with ^C', async ({ page }) => {
      await open(page);
      await focusPrompt(page);
      await prompt(page).fill('sleep 5');
      await prompt(page).press('Enter');
      const cancel = chip(page, 'Cancel the running command (Control C)');
      await expect(cancel).toBeVisible();
      await expect(dock(page).getByRole('option')).toHaveCount(1);
      const height = await cancel.evaluate((element) => element.getBoundingClientRect().height);
      expect(height).toBeGreaterThanOrEqual(44);
      await expect(key(page, 'Control C: cancel')).toHaveClass(/emphasis/);
      const started = Date.now();
      await cancel.tap();
      await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
      expect(Date.now() - started).toBeLessThan(4000);
      await expect(lastEntry(page)).toContainText('^C');
      await expect(prompt(page)).toBeFocused();
    });
  });
}

test.describe('the dock on a short screen', { tag: '@smoke' }, () => {
  test.beforeEach(() => {
    test.skip(!isPhone(), 'a touch screen');
  });

  /** Every key's box, and the screen's width. */
  const keyBoxes = (page: Page) =>
    dock(page)
      .locator('.key')
      .evaluateAll((keys) => keys.map((element) => ({ label: element.textContent ?? '', ...element.getBoundingClientRect().toJSON(), view: window.innerWidth })));

  test('every key is 44px tall and wholly on the screen, in every layout, from 320px', async ({ page }) => {
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 560 });
      await open(page);
      const check = async (minWidth: number) => {
        for (const box of await keyBoxes(page)) {
          expect(box.height, box.label).toBeGreaterThanOrEqual(44);
          // A key the screen cuts off cannot be found: the hide key, the way back from the symbols, ← →.
          expect(box.left, box.label).toBeGreaterThanOrEqual(0);
          expect(box.right, box.label).toBeLessThanOrEqual(box.view);
          expect(box.width, box.label).toBeGreaterThanOrEqual(minWidth);
        }
      };
      // 44 by 44 wherever the width allows: seven keys at 375px; 41px each at 320px.
      await check(width >= 375 ? 44 : 40);
      await focusPrompt(page);
      await check(width >= 375 ? 44 : 40);
      // The twelve keys of the symbols page share the width too (WCAG 2.5.8's 24px at least),
      // with ••• to come back first.
      await key(page, 'Symbols').tap();
      await expect(key(page, 'Pipe')).toBeVisible();
      await check(24);
      expect((await keyBoxes(page))[0]?.label).toBe('•••');
      await key(page, 'Pipe').tap();
      await expect(prompt(page)).toHaveValue('|');
      await expect(prompt(page)).toBeFocused();
      await key(page, 'Symbols').tap();
      await expect(key(page, 'Hide the keyboard')).toBeVisible();
      await noSidewaysScroll(page);
    }
  });

  test('keeps ↑ and clear their own size beside the Type bar in landscape', async ({ page }) => {
    await page.setViewportSize({ width: 812, height: 375 });
    await open(page);
    const boxes = await keyBoxes(page);
    const type = boxes.find((box) => box.label.includes('Type a command'));
    for (const box of boxes.filter((b) => b !== type)) expect(box.width, box.label).toBeLessThan(100);
    expect(type?.width ?? 0).toBeGreaterThan(400);
  });

  test('starts the chips clear of the faded edge', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await open(page);
    const first = await dock(page)
      .locator('.chips')
      .evaluate((row) => ({ scroll: row.scrollLeft, left: (row.querySelector('.chip') as HTMLElement).getBoundingClientRect().left - row.getBoundingClientRect().left }));
    expect(first.scroll).toBe(0);
    expect(first.left).toBeGreaterThanOrEqual(10);
  });

  test('rides directly above the keyboard, in one row when the keyboard leaves little room', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await fakeVisualViewport(page);
    await open(page);
    await focusPrompt(page);
    const dockBottom = () => dock(page).evaluate((element) => element.getBoundingClientRect().bottom);
    for (const [visible, mode] of [
      [520, 'full'],
      [400, 'compact'],
    ] as const) {
      await page.evaluate((height) => window.__vv?.set({ height }), visible);
      await expect(dock(page)).toHaveAttribute('data-dock-mode', mode);
      await expect.poll(dockBottom).toBeCloseTo(visible, 0);
      await promptAboveDock(page);
    }
    // The keyboard goes: the whole screen again, and the closed bar.
    await prompt(page).evaluate((input) => input.blur());
    await page.evaluate(() => window.__vv?.set({ height: 812 }));
    await expect(key(page, 'Type a command')).toBeVisible();
    await expect.poll(dockBottom).toBeCloseTo(812, 0);
  });

  test('lays itself out in one row when little is visible, and keys only when less is', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 420 });
    await open(page);
    await focusPrompt(page);
    await expect(dock(page)).toHaveAttribute('data-dock-mode', 'compact');
    await expect(dock(page).locator('.one-row .key')).toHaveCount(3);
    await promptAboveDock(page);
    await page.setViewportSize({ width: 375, height: 280 });
    await expect(dock(page)).toHaveAttribute('data-dock-mode', 'minimal');
    // The chips are not drawn, only kept for screen readers.
    expect(await dock(page).locator('.chip-row').evaluate((row) => row.closest('.sr-only') !== null)).toBe(true);
    await promptAboveDock(page);
    // Tab's list is only ever chips on touch: while it is open, the one row comes back to show it.
    await prompt(page).fill('c');
    await key(page, 'Tab: complete').tap();
    await expect(dock(page).locator('.one-row')).toBeVisible();
    await expect(dock(page).locator('.one-row .chip').first()).toBeVisible();
    expect(await dock(page).locator('.one-row .chip').count()).toBeGreaterThan(2);
    await key(page, 'Tab: complete').tap();
    await expect(dock(page).locator('.one-row .chip.selected')).toBeVisible();
  });
});

test.describe('the dock on a desktop', { tag: '@smoke' }, () => {
  test.beforeEach(() => {
    test.skip(isPhone(), 'a mouse');
  });

  test('is not there, unless asked for with ?dock=1', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
    await expect(dock(page)).toHaveCount(0);
    await page.goto('/?dock=1');
    await expect(chip(page, 'Run: help')).toBeVisible();
    // A click on a key keeps the focus, and the line, in the prompt.
    await expect(prompt(page)).toBeFocused();
    await page.keyboard.type('theme sw');
    await key(page, 'Tab: complete').click();
    await expect(prompt(page)).toHaveValue('theme swamphen ');
    await expect(prompt(page)).toBeFocused();
  });
});

test.describe('following what a tap runs, and the keyboard', { tag: '@smoke' }, () => {
  test.use({ viewport: { width: 390, height: 664 } });
  test.beforeEach(() => {
    test.skip(!isPhone(), 'a touch screen');
  });

  /** Where the newest entry and the prompt are, against the screen. */
  const where = (page: Page) =>
    page.evaluate(() => {
      const main = document.querySelector('main') as HTMLElement;
      const screen = main.getBoundingClientRect();
      const echoes = document.querySelectorAll('[role="log"] .command-input-display');
      const echo = (echoes[echoes.length - 1] as HTMLElement).getBoundingClientRect();
      const input = (document.querySelector('input.command-input') as HTMLElement).getBoundingClientRect();
      return {
        echoInView: echo.top >= screen.top - 0.5 && echo.bottom <= screen.bottom + 0.5,
        inputInView: input.top >= screen.top - 0.5 && input.bottom <= screen.bottom + 0.5,
        pill: document.querySelector('.new-output') !== null,
      };
    });

  async function tapChip(page: Page, name: string): Promise<void> {
    const before = await echoes(page).count();
    await chip(page, name).tap();
    await expect(echoes(page)).toHaveCount(before + 1);
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
  }

  test('follows each line a chip runs, even after a long output was shown from its start', async ({ page }) => {
    await open(page);
    await tapChip(page, 'Run: fastfetch');
    for (const name of ['Run: ls', 'Run: theme ls']) {
      await tapChip(page, name);
      await expect.poll(async () => (await where(page)).echoInView, { message: name }).toBe(true);
      expect((await where(page)).pill, name).toBe(false);
    }
  });

  test('keeps the prompt above the keyboard after a long output typed there', async ({ page }) => {
    await fakeVisualViewport(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await open(page);
    await focusPrompt(page);
    await page.evaluate(() => window.__vv?.set({ height: 367 }));
    for (const line of ['help', 'fastfetch']) {
      const before = await echoes(page).count();
      await prompt(page).fill(line);
      await prompt(page).press('Enter');
      await expect(echoes(page)).toHaveCount(before + 1);
      await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
      await expect.poll(async () => (await where(page)).inputInView, { message: line }).toBe(true);
      await promptAboveDock(page);
    }
    await expect(prompt(page)).toBeFocused();
  });

  test('a run link in the output keeps the keyboard open', async ({ page }) => {
    await open(page);
    await focusPrompt(page);
    await prompt(page).fill('theme ls');
    await prompt(page).press('Enter');
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
    const before = await echoes(page).count();
    await page.locator('[role="log"] button.action', { hasText: 'wombat' }).last().tap();
    await expect(echoes(page)).toHaveCount(before + 1);
    await expect(prompt(page)).toBeFocused();
  });

  test('⌨ Type a command brings the prompt into view, however far up the visitor had read', async ({ page }) => {
    await fakeVisualViewport(page);
    await page.setViewportSize({ width: 375, height: 667 });
    await open(page);
    await tapChip(page, 'Run: cat ~/README.md');
    await tapChip(page, 'Run: help');
    await page.locator('main').evaluate((main) => {
      main.scrollTop = 100;
      main.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(async () => (await where(page)).inputInView).toBe(false);
    await key(page, 'Type a command').tap();
    await page.evaluate(() => window.__vv?.set({ height: 367 }));
    await expect(prompt(page)).toBeFocused();
    await expect.poll(async () => (await where(page)).inputInView).toBe(true);
  });

  test('the README starter works from any folder', async ({ page }) => {
    await open(page);
    await focusPrompt(page);
    await prompt(page).fill('cd documents');
    await prompt(page).press('Enter');
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
    await tapChip(page, 'Run: cat ~/README.md');
    await expect(lastEntry(page)).not.toContainText('No such file');
    await expect(lastEntry(page)).toContainText('vesen');
  });
});

test.describe('Android’s Back with the keyboard up', { tag: '@smoke' }, () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'pixel-7', 'Chrome on Android keeps focus when Back hides the keyboard');
  });

  test('puts the dock back to its closed bar, and a tap under the prompt brings the keyboard back', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page);
    await key(page, 'Type a command').tap();
    await expect(prompt(page)).toBeFocused();
    // The keyboard (Android resizes the page with it), then Back, which hides it but keeps focus.
    await page.setViewportSize({ width: 375, height: 512 });
    await expect(page.locator('html')).toHaveClass(/kb-open/);
    await expect(dock(page)).toHaveClass(/typing/);
    await page.setViewportSize({ width: 375, height: 812 });
    await expect(page.locator('html')).not.toHaveClass(/kb-open/);
    await expect(prompt(page)).not.toBeFocused();
    await expect(key(page, 'Type a command')).toBeVisible();
    await page.locator('.tap-to-type').tap({ position: { x: 100, y: 10 } });
    await expect(prompt(page)).toBeFocused();
  });
});
