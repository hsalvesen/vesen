import { expect, test, type Page } from '@playwright/test';

// Tab completion on a keyboard (docs/plan/03-terminal-input.md, acceptance checks; 02, section 5):
// extend, then list, then a menu that Tab and Shift+Tab cycle and Escape undoes.

const prompt = (page: Page) => page.getByRole('textbox', { name: 'Terminal command' });

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
    await page.keyboard.type('ca');
    await page.keyboard.press('Tab');
    await expect(prompt(page)).toHaveValue('cat');

    // The second Tab lists, and changes nothing on the line.
    await page.keyboard.press('Tab');
    const list = page.getByRole('listbox', { name: 'Completions' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('option')).toHaveCount(2);
    await expect(prompt(page)).toHaveValue('cat');

    // Then Tab steps through them, wrapping, and Shift+Tab steps back.
    await page.keyboard.press('Tab');
    await expect(prompt(page)).toHaveValue('cat');
    await expect(list.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('Tab');
    await expect(prompt(page)).toHaveValue('cathode');
    await expect(list.getByRole('option').nth(1)).toHaveAttribute('aria-selected', 'true');
    await expect(prompt(page)).toHaveAttribute('aria-activedescendant', 'completion-list-1');
    await page.keyboard.press('Tab');
    await expect(prompt(page)).toHaveValue('cat');
    await page.keyboard.press('Shift+Tab');
    await expect(prompt(page)).toHaveValue('cathode');

    // Escape puts back what was typed before the menu, and closes the list.
    await page.keyboard.press('Escape');
    await expect(prompt(page)).toHaveValue('cat');
    await expect(list).toHaveCount(0);
    await expect(prompt(page)).toBeFocused();
  });

  test('Enter in the menu takes the choice without running it', async ({ page }) => {
    await open(page);
    await page.keyboard.type('theme set k');
    await page.keyboard.press('Tab');
    await expect(page.getByRole('listbox', { name: 'Completions' }).getByRole('option')).toHaveCount(2);
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await expect(prompt(page)).toHaveValue('theme set kookaburra');
    await page.keyboard.press('Enter');
    await expect(prompt(page)).toHaveValue('theme set kookaburra ');
    await expect(page.locator('[role="log"] .command-input-display')).toHaveCount(1);
  });

  test('clicking a chip puts it on the line and keeps focus in the prompt', async ({ page }) => {
    await open(page);
    await page.keyboard.type('theme set w');
    const chip = page.getByRole('listbox', { name: 'Suggestions' }).getByRole('option', { name: 'wombat' });
    await chip.click();
    await expect(prompt(page)).toHaveValue('theme set wombat ');
    await expect(prompt(page)).toBeFocused();
  });
});
