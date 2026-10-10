import { expect, test, type Page } from '@playwright/test';

// The shell kernel in the browser (docs/plan/08-shell-and-commands.md): every command runs
// through it, so quotes, pipes, redirection, && and ||, $? and ^C work for all of them.

const prompt = (page: Page) => page.getByRole('combobox', { name: 'Terminal command' });
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
    // Through a pipe the help became text: plain lines, with no markup, styles or buttons.
    await expect(output.locator('.lines .text').first()).toBeVisible();
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

  test('a command from the catalogue, which loads after the kernel, runs and is listed like the rest', async ({ page }) => {
    const chunks: string[] = [];
    page.on('request', (request) => chunks.push(new URL(request.url()).pathname));
    await page.goto('/');
    // rev is in the catalogue's chunk, not the kernel's: the line gets it if it is not in yet.
    await run(page, 'echo hello | rev');
    await expect(lastEntry(page).locator('.command-output')).toHaveText('olleh');
    expect(chunks.some((path) => /^\/assets\/catalogue-[\w-]+\.js$/.test(path))).toBe(true);

    await run(page, 'which rev');
    await expect(lastEntry(page).locator('.command-output')).toHaveText('/usr/bin/rev');
    await run(page, 'help | cat');
    // In a pipe the index names every command on one line per category, by name, rev among the text tools.
    await expect(lastEntry(page)).toContainText(/Text: base64 bc column cut .*\brev sed seq\b/);
    await run(page, 'help --all | grep rev');
    await expect(lastEntry(page).locator('.command-output')).toHaveText(/^rev\s+reverse the characters of each line$/);
  });

  test('redirection, && and || and $? work for every command', async ({ page }) => {
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
    await run(page, 'theme wombat');
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

  test('^C on a line typed before the kernel arrives ends it at once', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-chrome', 'Ctrl+C on a hardware keyboard');
    // Hold the kernel's chunk back, as a slow network would.
    let release = (): void => {};
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(/\/assets\/shell-[\w-]+\.js$/, async (route) => {
      await held;
      await route.continue();
    });
    await page.goto('/');
    await prompt(page).fill('help');
    await prompt(page).press('Enter');
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'true');
    await prompt(page).press('Control+c');
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
    await expect(lastEntry(page)).toContainText('^C');
    release();
    // When the kernel arrives, the cancelled line does not run.
    await run(page, 'echo after');
    await expect(lastEntry(page).locator('.command-output')).toHaveText('after');
    await expect(page.locator('[role="log"] .command-output').filter({ hasText: 'Portfolio' })).toHaveCount(0);
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
