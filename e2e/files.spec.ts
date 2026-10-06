import { expect, test, type Page } from '@playwright/test';

// The file system, the prompt and persistence (docs/plan/08-shell-and-commands.md, "The file
// system after this plan"): the prompt follows cd while earlier prompts keep their folder, files
// under ~ survive a reload, and reset puts the seed back.

const prompt = (page: Page) => page.getByRole('textbox', { name: 'Terminal command' });
const entries = (page: Page) => page.locator('[role="log"] .entry');
const lastEntry = (page: Page) => entries(page).last();

/** Runs a line at the prompt and waits until it is in the transcript and nothing runs. */
async function run(page: Page, line: string): Promise<void> {
  const echoes = page.locator('[role="log"] .command-input-display');
  const before = await echoes.count();
  await prompt(page).fill(line);
  await prompt(page).press('Enter');
  await expect(echoes).toHaveCount(before + 1);
  await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
}

/** A prompt's text, without the spaces layout may add. */
const promptText = async (locator: ReturnType<Page['locator']>) => ((await locator.textContent()) ?? '').replace(/\s+/g, '');

test.describe('files and the prompt', { tag: '@smoke' }, () => {
  test('cd documents shows ~/documents in the prompt, and earlier prompts keep their folder', async ({ page }) => {
    await page.goto('/');
    const live = page.locator('[data-prompt-area] .prompt');
    expect(await promptText(live)).toBe('guest@vesen:~$');

    await run(page, 'cd documents');
    await expect.poll(() => promptText(live)).toBe('guest@vesen:~/documents$');
    await run(page, 'pwd');
    await expect(lastEntry(page).locator('.command-output')).toHaveText('/home/guest/documents');

    const typedAt = await entries(page).locator('.prompt').evaluateAll((spans) => spans.map((span) => (span.textContent ?? '').replace(/\s+/g, '')));
    // The banner, cd documents, then pwd typed inside documents.
    expect(typedAt.slice(-3)).toEqual(['guest@vesen:~$', 'guest@vesen:~$', 'guest@vesen:~/documents$']);
  });

  test('a file touched under ~ is still there after a reload, and reset restores the seed', async ({ page }) => {
    await page.goto('/');
    await run(page, 'touch kept.txt');
    await run(page, 'echo remembered > note.txt');
    await run(page, 'rm history.txt');
    // Saving waits 300 ms after the last change; a reload saves what is waiting.
    await page.reload();

    await run(page, 'ls');
    await expect(lastEntry(page)).toContainText('kept.txt');
    await expect(lastEntry(page)).toContainText('note.txt');
    await expect(lastEntry(page)).not.toContainText('history.txt');
    await run(page, 'cat note.txt');
    await expect(lastEntry(page).locator('.command-output')).toHaveText('remembered');

    await prompt(page).fill('reset');
    await prompt(page).press('Enter');
    await expect(page.locator('[role="log"] .command-input-display')).toHaveText(['banner']);
    await run(page, 'ls');
    await expect(lastEntry(page)).toContainText('history.txt');
    await expect(lastEntry(page)).not.toContainText('kept.txt');

    // And reset is what a reload brings back too.
    await page.reload();
    await run(page, 'ls');
    await expect(lastEntry(page)).toContainText('history.txt');
    await expect(lastEntry(page)).not.toContainText('note.txt');
  });

  test('a long folder name never pushes the page sideways at 320 px, and the input keeps room', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    await run(page, 'mkdir -p ~/my-portfolio-website-2026 && cd ~/my-portfolio-website-2026');
    await run(page, 'pwd');
    await prompt(page).focus();
    const sizes = await page.evaluate(() => {
      const main = document.querySelector('main');
      const input = document.querySelector('input.command-input');
      return { overflow: main ? main.scrollWidth - main.clientWidth : Infinity, input: input?.getBoundingClientRect().width ?? 0 };
    });
    expect(sizes.overflow).toBeLessThanOrEqual(0);
    // At least ten cells of room to type.
    expect(sizes.input).toBeGreaterThan(70);
    expect(await promptText(page.locator('[data-prompt-area] .prompt'))).toMatch(/^guest@vesen:…[\w-]+\$$/);
  });

  test('system files are the system\'s: touch /etc/x is refused, and the $ turns red', async ({ page }) => {
    await page.goto('/');
    await run(page, 'touch /etc/x');
    await expect(lastEntry(page)).toContainText("touch: cannot touch '/etc/x': Permission denied");
    const dollar = page.locator('[data-prompt-area] .prompt span', { hasText: '$' }).last();
    await expect(dollar).toHaveAttribute('style', /--role-error/);
    await run(page, 'cat /etc/hostname');
    await expect(lastEntry(page).locator('.command-output')).toHaveText('vesen');
    await expect(dollar).toHaveAttribute('style', /--role-fg-strong/);
  });
});
