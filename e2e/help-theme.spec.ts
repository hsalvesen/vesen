import { expect, test, type Page } from '@playwright/test';

// help, theme and the shell built-ins as specs (docs/plan/08-shell-and-commands.md, step 2.3b):
// help lists the commands by category, and a tapped name goes to the prompt; theme set recolours
// what is already on the screen and moves the marker in an earlier theme ls; exit offers a new
// session. Checked on a desktop and in Instagram's in-app browser on an iPhone.

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

test.describe('help and theme', { tag: '@smoke' }, () => {
  test.beforeEach(() => {
    test.skip(!['desktop-chrome', 'iphone-instagram'].includes(test.info().project.name), 'a desktop and Instagram on an iPhone');
  });

  test('help shows grouped rows, and tapping a name puts it at the prompt', async ({ page, hasTouch }) => {
    await page.goto('/');
    await run(page, 'help');
    const output = lastEntry(page).locator('.command-output');
    for (const heading of ['Portfolio', 'Files', 'Shell', 'Network']) {
      await expect(output.getByText(heading, { exact: true })).toBeVisible();
    }
    // Each row is a name and what it does.
    const row = output.locator('.grid .cell').filter({ hasText: 'change the colour theme' });
    await expect(row).toHaveCount(1);
    const name = row.getByRole('button', { name: 'theme', exact: true });
    await expect(name).toBeVisible();

    // No row is wider than the screen.
    const overflow = await page.evaluate(() => {
      const main = document.querySelector('main');
      return main ? main.scrollWidth - main.clientWidth : Infinity;
    });
    expect(overflow).toBeLessThanOrEqual(0);

    if (hasTouch) await name.tap();
    else await name.click();
    await expect(prompt(page)).toHaveValue('theme ');
  });

  test('help fits the screen, with the portfolio heading in view, and a tapped name brings the prompt into view', async ({ page, hasTouch }) => {
    await page.goto('/');
    await run(page, 'help');
    const output = lastEntry(page).locator('.command-output');
    // The portfolio comes first, and the short index keeps it on screen rather than scrolled off.
    const heading = output.getByText('Portfolio', { exact: true });
    await expect(heading).toBeInViewport();
    await expect(output.getByRole('button', { name: 'help --all', exact: true })).toBeVisible();

    // Scroll the prompt out of sight, then tap a name: the prompt comes back with the name in it.
    await page.locator('main').evaluate((main) => main.scrollTo({ top: 0 }));
    const name = output.getByRole('button', { name: 'ls', exact: true });
    if (hasTouch) await name.tap();
    else await name.click();
    await expect(prompt(page)).toHaveValue('ls ');
    await expect(prompt(page)).toBeInViewport();
    await expect(prompt(page)).toBeFocused();
    await expect(page.getByRole('button', { name: 'Scroll to new output' })).toHaveCount(0);
  });

  test('theme set cockatoo recolours earlier output, and moves the marker in an earlier theme ls', async ({ page }) => {
    await page.goto('/');
    await run(page, 'help');
    await run(page, 'theme ls');
    const heading = page.locator('[role="log"]').getByText('Portfolio', { exact: true }).first();
    const before = await heading.evaluate((el) => getComputedStyle(el).color);
    // The theme ls entry itself, which stays where it is as later lines are added.
    const listing = page.locator('[role="log"] .entry').nth((await page.locator('[role="log"] .entry').count()) - 1);
    await expect(listing.locator('button[aria-current="true"]')).toHaveText('swamphen');

    await run(page, 'theme set cockatoo');
    await expect(lastEntry(page)).toContainText('Theme set to cockatoo.');

    const after = await heading.evaluate((el) => {
      // The accent role as the page paints it now.
      const probe = document.createElement('span');
      probe.style.color = getComputedStyle(document.documentElement).getPropertyValue('--role-accent');
      document.body.append(probe);
      const accent = getComputedStyle(probe).color;
      probe.remove();
      return { painted: getComputedStyle(el).color, accent };
    });
    // The heading was drawn before the switch, and takes cockatoo's accent without being run again.
    expect(after.painted).not.toBe(before);
    expect(after.painted).toBe(after.accent);
    // The earlier listing was not run again, yet its marker has moved.
    await expect(listing.locator('button[aria-current="true"]')).toHaveText('cockatoo');
    // The swatches keep each theme's own colours.
    await expect(listing.locator('.swatches').nth(1)).toHaveCSS('background-color', 'rgb(232, 221, 208)');
  });

  test('exit ends the session, and its chip starts a new one with the files kept', async ({ page, hasTouch }) => {
    await page.goto('/');
    await run(page, 'touch kept.txt; export NAME=Has');
    await run(page, 'exit');
    await expect(lastEntry(page)).toContainText('logout');
    await expect(lastEntry(page)).toContainText('[Process completed]');
    const chip = lastEntry(page).getByRole('button', { name: 'Start a new session' });
    if (hasTouch) await chip.tap();
    else await chip.click();
    await expect(page.locator('[role="log"] .command-input-display').first()).toHaveText('banner');
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
    await run(page, 'echo "[$NAME]"; ls kept.txt');
    await expect(lastEntry(page).locator('.command-output')).toHaveText(/\[\]\s*kept\.txt/);
  });
});
