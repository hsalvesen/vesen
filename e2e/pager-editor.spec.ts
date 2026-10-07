import { expect, test, type Page } from '@playwright/test';
import { isBenignConsoleMessage } from './console';

// The pager and the editor in a real browser (docs/plan/08-shell-and-commands.md, wave F): 'man
// ls' opens the pager over the terminal and q closes it; 'nano ~/notes.txt' is typed in, saved
// and left, with the keys on a desktop and the toolbar on a phone, and cat shows the text after.

const PHONES = ['iphone-instagram', 'pixel-7'];
const isPhone = () => PHONES.includes(test.info().project.name);

const prompt = (page: Page) => page.locator('input.command-input');

/** The entry a line was typed in, the newest first. */
const entryOf = (page: Page, line: string) =>
  page
    .locator('[role="log"] .entry')
    .filter({ has: page.locator('.command-input-display', { hasText: new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) })
    .last();

async function open(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !isBenignConsoleMessage(message.text())) errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
  if (isPhone()) await prompt(page).tap();
  else await prompt(page).click();
  return errors;
}

/** Types a line at the prompt and presses Enter, without waiting for it to end. */
async function enter(page: Page, line: string): Promise<void> {
  await prompt(page).fill(line);
  await prompt(page).press('Enter');
}

test.describe('the pager and the editor', { tag: '@smoke' }, () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name === 'pixel-7', 'desktop Chrome and Instagram on an iPhone');
  });

  test("'man ls' opens the pager over the terminal, and q closes it", async ({ page }) => {
    const errors = await open(page);
    await enter(page, 'man ls');
    const pager = page.locator('[data-pager]');
    await expect(pager).toBeVisible();
    await expect(pager.locator('.rows')).toContainText('LS(1)');
    await expect(pager.locator('.status')).toContainText('Manual page ls(1)');
    if (isPhone()) await expect(page.getByRole('button', { name: 'Close' })).toBeVisible();
    else await expect(pager).toContainText('h help · q quit');
    // Nothing scrolls sideways, at any width.
    const sideways = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - window.innerWidth));
    expect(sideways).toBe(0);

    // A screen on, then q.
    await page.keyboard.press('Space');
    await expect(pager.locator('.status')).not.toContainText(/ lines 1-/);
    await page.keyboard.press('q');
    await expect(pager).toBeHidden();
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
    // man leaves nothing in the transcript; on a desktop the caret is back in the prompt.
    await expect(entryOf(page, 'man ls')).not.toContainText('LS(1)');
    if (!isPhone()) await expect(prompt(page)).toBeFocused();
    expect(errors).toEqual([]);
  });

  test("'nano ~/notes.txt': type, save, leave, and cat shows the text", async ({ page }) => {
    const errors = await open(page);
    await enter(page, 'nano ~/notes.txt');
    const editor = page.locator('[data-editor]');
    await expect(editor).toBeVisible();
    await expect(editor.locator('.status')).toHaveText('[ New File ]');
    const text = editor.locator('textarea');

    if (isPhone()) {
      // A tap on the text opens the keyboard; the toolbar saves and leaves.
      await text.tap();
      await text.fill('written in nano');
      await expect(editor).toContainText('Modified');
      await page.getByRole('button', { name: 'Save' }).tap();
      await expect(editor.locator('.status')).toHaveText('[ Wrote 1 line ]');
      await page.getByRole('button', { name: 'Exit' }).tap();
    } else {
      await expect(text).toBeFocused();
      await page.keyboard.type('written in nano');
      await expect(editor).toContainText('Modified');
      await page.keyboard.press('Control+O');
      const name = page.getByRole('textbox', { name: 'File Name to Write:' });
      await expect(name).toBeFocused();
      await expect(name).toHaveValue('/home/guest/notes.txt');
      await page.keyboard.press('Enter');
      await expect(editor.locator('.status')).toHaveText('[ Wrote 1 line ]');
      await page.keyboard.press('Control+X');
    }
    await expect(editor).toBeHidden();
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
    if (!isPhone()) await expect(prompt(page)).toBeFocused();
    else await prompt(page).tap();

    await enter(page, 'cat ~/notes.txt');
    await expect(entryOf(page, 'cat ~/notes.txt')).toContainText('written in nano');
    expect(errors).toEqual([]);
  });
});
