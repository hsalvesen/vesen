import { expect, test, type Page } from '@playwright/test';

// The shell kernel in the browser (docs/plan/08-shell-and-commands.md, "Kernel behind the
// legacy adapter"): every legacy command runs through it, so quotes, pipes, redirection, && and
// ||, $? and ^C work for all of them.

const prompt = (page: Page) => page.getByRole('textbox', { name: 'Terminal command' });
const lastEntry = (page: Page) => page.locator('[role="log"] .entry').last();

/** Runs a line at the prompt and waits until it is in the transcript and nothing runs. */
async function run(page: Page, line: string): Promise<void> {
  const echoes = page.locator('[role="log"] .command-input-display');
  const before = await echoes.count();
  await prompt(page).fill(line);
  await prompt(page).press('Enter');
  await expect(echoes).toHaveCount(before + 1);
  await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
}

test.describe('the shell kernel', { tag: '@smoke' }, () => {
  test('help | cat prints the command list as plain text', async ({ page }) => {
    await page.goto('/');
    await run(page, 'help | cat');

    const output = lastEntry(page).locator('.command-output');
    await expect(output).toContainText('whoami');
    await expect(output).toContainText('fastfetch');
    // Through a pipe the legacy HTML became text: plain lines, with no markup, styles or buttons.
    await expect(output.locator('.lines .text').first()).toBeVisible();
    await expect(output.locator('.legacy')).toHaveCount(0);
    await expect(output.locator('button, a, [style], [class*="out-"]')).toHaveCount(0);
  });

  test('lss says command not found and offers ls, which runs when tapped', async ({ page, hasTouch }) => {
    await page.goto('/');
    await run(page, 'lss');

    const entry = lastEntry(page);
    await expect(entry).toContainText('vesen: lss: command not found');
    await expect(entry).toContainText("Did you mean ls? Type 'help' to see all commands.");
    const suggestion = entry.getByRole('button', { name: 'ls', exact: true });
    await expect(suggestion).toBeVisible();

    if (hasTouch) await suggestion.tap();
    else await suggestion.click();

    await expect(page.locator('[role="log"] .command-input-display').last()).toHaveText('ls');
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
    await expect(lastEntry(page)).toContainText('README.md');
  });

  test('redirection, && and || and $? work for the legacy commands', async ({ page }) => {
    await page.goto('/');
    await run(page, 'echo "hi  there" > note.txt; cat note.txt');
    await expect(lastEntry(page)).toContainText('hi  there');

    await run(page, 'cat nope 2>/dev/null || echo missing');
    await expect(lastEntry(page).locator('.command-output')).toHaveText('missing');

    await run(page, 'lss; echo status $?');
    await expect(lastEntry(page)).toContainText('status 127');
  });

  test('clear empties the screen, as an effect of the shell', async ({ page }) => {
    await page.goto('/');
    await run(page, 'ls');
    await prompt(page).fill('clear');
    await prompt(page).press('Enter');
    await expect(page.locator('[role="log"] .entry')).toHaveCount(0);
  });

  test('reset restores the banner, the default theme, the files and an empty history', async ({ page }) => {
    await page.goto('/');
    await run(page, 'theme set wombat');
    await run(page, 'touch made.txt');
    await prompt(page).fill('reset');
    await prompt(page).press('Enter');
    await expect(page.locator('[role="log"] .command-input-display')).toHaveText(['banner']);
    await expect(page.locator('html')).toHaveCSS('--theme-background', '#222235');

    await run(page, 'ls');
    await expect(lastEntry(page)).toContainText('README.md');
    await expect(lastEntry(page)).not.toContainText('made.txt');
    await run(page, 'history');
    await expect(lastEntry(page).locator('.command-output')).toHaveText(/^\s*1\s+ls\s+2\s+history\s*$/);
  });

  test('history survives a reload', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-chrome', 'arrow keys on a hardware keyboard');
    await page.goto('/');
    await run(page, 'echo remembered');
    await page.reload();
    await prompt(page).press('ArrowUp');
    await expect(prompt(page)).toHaveValue('echo remembered');
  });
});
