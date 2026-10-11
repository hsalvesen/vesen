import { expect, test, type Page } from '@playwright/test';

// Tab completion on a keyboard (docs/plan/03-terminal-input.md, acceptance checks; 02, section 5):
// extend, then list, then a menu that Tab and Shift+Tab cycle and Escape undoes.

const prompt = (page: Page) => page.getByRole('combobox', { name: 'Terminal command' });

/** Opens the terminal and waits for the completion engine's chunk. */
async function open(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
  await expect(prompt(page)).toBeFocused();
}

test.describe('Tab completion', { tag: '@smoke' }, () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop-chrome', 'a hardware keyboard');
  });

  test('cat doc<Tab>li<Tab> completes to cat documents/linux.txt', async ({ page }) => {
    await open(page);
    await page.keyboard.type('cat doc');
    await page.keyboard.press('Tab');
    await expect(prompt(page)).toHaveValue('cat documents/');
    await page.keyboard.type('li');
    await page.keyboard.press('Tab');
    await expect(prompt(page)).toHaveValue('cat documents/linux.txt ');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('log')).toContainText('Linux');
  });

  test('a double Tab lists the choices, the next Tab cycles them, and Escape restores the line', async ({ page }) => {
    await open(page);
    await page.keyboard.type('prin');
    await page.keyboard.press('Tab');
    await expect(prompt(page)).toHaveValue('print');

    // The second Tab lists, and changes nothing on the line.
    await page.keyboard.press('Tab');
    const list = page.getByRole('listbox', { name: 'Completions' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('option')).toHaveCount(2);
    await expect(prompt(page)).toHaveValue('print');

    // Then Tab steps through them, wrapping, and Shift+Tab steps back.
    await page.keyboard.press('Tab');
    await expect(prompt(page)).toHaveValue('printenv');
    await expect(list.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Tab');
    await expect(prompt(page)).toHaveValue('printf');
    await expect(list.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(prompt(page)).toHaveAttribute('aria-activedescendant', 'completion-list-1');
    await page.keyboard.press('Tab');
    await expect(prompt(page)).toHaveValue('printenv');
    await page.keyboard.press('Shift+Tab');
    await expect(prompt(page)).toHaveValue('printf');

    // Escape puts back what was typed before the menu, and closes the list.
    await page.keyboard.press('Escape');
    await expect(prompt(page)).toHaveValue('print');
    await expect(list).toHaveCount(0);
    await expect(prompt(page)).toBeFocused();
  });

  test('Enter in the menu takes the choice without running it', async ({ page }) => {
    await open(page);
    await page.keyboard.type('theme k');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('listbox', { name: 'Completions' }).getByRole('option')).toHaveCount(2);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(prompt(page)).toHaveValue('theme kookaburra');
    await page.keyboard.press('Enter');
    await expect(prompt(page)).toHaveValue('theme kookaburra ');
    await expect(page.locator('[role="log"] .command-input-display')).toHaveCount(1);
  });

  test('clicking a chip puts it on the line and keeps focus in the prompt', async ({ page }) => {
    await open(page);
    await page.keyboard.type('theme w');
    const chip = page.getByRole('listbox', { name: 'Suggestions' }).getByRole('option', { name: 'wombat' });
    await chip.click();
    await expect(prompt(page)).toHaveValue('theme wombat ');
    await expect(prompt(page)).toBeFocused();
  });
});

test.describe('Tab before the catalogue arrives', () => {
  test("a first Tab on one of its commands waits for it, without saying 'No completions', then completes", async ({ page, hasTouch }) => {
    // The catalogue's chunk is held until the Tab has had time to give up, as on a slow network.
    let release: () => void = () => {};
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(/\/assets\/catalogue-[\w-]+\.js$/, async (route) => {
      await released;
      await route.continue();
    });
    await page.goto('/');
    await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
    if (hasTouch) {
      await prompt(page).tap();
      await prompt(page).fill('gre');
      await page.locator('.dock').getByRole('button', { name: 'Tab: complete', exact: true }).tap();
    } else {
      await prompt(page).fill('gre');
      await page.keyboard.press('Tab');
    }
    // Well past the short wait: nothing rang or was said, and the line is as typed.
    await page.waitForTimeout(800);
    await expect(prompt(page)).toHaveValue('gre');
    await expect(page.locator('[aria-live]').filter({ hasText: 'No completions' })).toHaveCount(0);
    release();
    await expect(prompt(page)).toHaveValue('grep ');
    await expect(prompt(page)).toBeFocused();
  });
});

// Tab's list (the owner's review): a name is never cut short. A long list is names only, in
// columns as wide as the longest, and the choice Tab cycles to is named under it with its
// summary; a short list keeps each summary beside its name. On a phone the list is the dock's
// chips, and the choice's line still comes under the prompt.
test.describe("Tab's list", { tag: '@smoke' }, () => {
  const PHONES = ['iphone-instagram', 'pixel-7'];
  const isPhone = () => PHONES.includes(test.info().project.name);
  const list = (page: Page) => page.locator('#completion-list');
  const choice = (page: Page) => page.locator('.completion-row .choice');

  /** Opens the terminal and focuses the prompt: with a tap on a phone, where focus waits for one. */
  async function ready(page: Page): Promise<void> {
    await page.goto('/');
    await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
    if (isPhone()) {
      await expect(page.locator('.dock').getByRole('option', { name: 'Run: help', exact: true })).toBeVisible();
      await prompt(page).tap();
    }
    await expect(prompt(page)).toBeFocused();
  }

  /** Tab: the key, or the dock's Tab key on a phone. */
  async function tab(page: Page): Promise<void> {
    if (isPhone()) await page.locator('.dock').getByRole('button', { name: 'Tab: complete', exact: true }).tap();
    else await page.keyboard.press('Tab');
  }

  /** Every name in the list is whole: none cut short, the list within the terminal, and the page not scrolling sideways. */
  async function wholeNames(page: Page): Promise<void> {
    const shape = await list(page).evaluate((el) => {
      const labels = Array.from(el.querySelectorAll<HTMLElement>('.label'));
      const box = el.getBoundingClientRect();
      const frame = (el.closest('main') ?? document.documentElement).getBoundingClientRect();
      const root = document.documentElement;
      return {
        count: labels.length,
        cut: labels.filter((label) => label.scrollWidth > label.clientWidth).map((label) => label.textContent),
        within: box.left >= frame.left - 0.5 && box.right <= frame.right + 0.5,
        pageScrolls: root.scrollWidth > root.clientWidth,
      };
    });
    expect(shape.count).toBeGreaterThan(0);
    expect(shape.cut).toEqual([]);
    expect(shape.within).toBe(true);
    expect(shape.pageScrolls).toBe(false);
  }

  test('on an empty prompt lists every command with its name whole, and Tab names the choice with its summary', async ({ page }) => {
    await ready(page);
    await tab(page);
    const question = page.locator('.completion-row .question');
    await expect(question).toHaveText(/^Display all \d+ possibilities\? \(y or n\)$/);
    // y: a key, or typed on a phone, whose keyboard may send no usable key press.
    if (isPhone()) await prompt(page).fill('y');
    else await page.keyboard.press('y');
    await expect(question).toHaveCount(0);
    await expect(prompt(page)).toHaveValue('');
    expect(await list(page).getByRole('option').count()).toBeGreaterThan(100);
    await wholeNames(page);
    if (!isPhone()) {
      // Names only, in columns, and nothing scrolls sideways.
      await expect(list(page).locator('.summary')).toHaveCount(0);
      expect(await list(page).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    }
    await expect(choice(page)).toHaveCount(0);

    // Tab puts the first candidate on the line, and names it with its summary under the list.
    await tab(page);
    const selected = list(page).locator('.chip.selected');
    await expect(selected).toHaveCount(1);
    const name = (await selected.locator('.label').textContent()) ?? '';
    expect(name).not.toBe('');
    await expect(prompt(page)).toHaveValue(name);
    await expect(choice(page)).toBeVisible();
    await expect(choice(page).locator('.choice-name')).toHaveText(name);
    await expect(choice(page).locator('.choice-summary')).not.toHaveText('');
    // The next Tab moves on.
    await tab(page);
    await expect(prompt(page)).not.toHaveValue(name);
    await expect(choice(page).locator('.choice-name')).not.toHaveText(name);
    await wholeNames(page);
  });

  test('a short list keeps each summary beside its name, and the name whole', async ({ page }) => {
    test.skip(isPhone(), "a phone's list is the dock's chips, which carry no summaries");
    await ready(page);
    await page.keyboard.type('the');
    await page.keyboard.press('Tab');
    await expect(prompt(page)).toHaveValue('theme ');
    await page.keyboard.press('Tab');
    const options = page.getByRole('listbox', { name: 'Completions' }).getByRole('option');
    await expect(options).toHaveCount(16);
    await expect(options.locator('.summary')).toHaveCount(16);
    await expect(options.first().locator('.label')).toHaveText('ls');
    await expect(options.first().locator('.summary')).toHaveText('list the themes, each with its colours');
    await wholeNames(page);
    // The summaries sit beside the names, so no line under the list repeats the choice's.
    await expect(choice(page)).toHaveCount(0);
    await page.keyboard.press('Tab');
    await expect(prompt(page)).toHaveValue('theme ls');
    await expect(options.first()).toHaveAttribute('aria-selected', 'true');
    await expect(choice(page)).toHaveCount(0);
  });
});
