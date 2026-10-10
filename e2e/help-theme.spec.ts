import { expect, test, type Page } from '@playwright/test';

// help, theme and the shell built-ins as specs (docs/plan/08-shell-and-commands.md, step 2.3b):
// help lists the commands by category, and a tapped name goes to the prompt; theme NAME recolours
// what is already on the screen and moves the marker in an earlier theme ls; exit offers a new
// session. Checked on a desktop and in Instagram's in-app browser on an iPhone.

const prompt = (page: Page) => page.getByRole('combobox', { name: 'Terminal command' });
const lastEntry = (page: Page) => page.locator('[role="log"] .entry').last();

/** Every theme in themes.json, in its order, with the background each paints the page. */
const THEMES: readonly [string, string][] = [
  ['cassowary', '#1D1E20'],
  ['cockatoo', '#e8ddd0'],
  ['crocodile', '#292520'],
  ['galah', '#3a4150'],
  ['kangaroo', '#262626'],
  ['kookaburra', '#222222'],
  ['lorikeet', '#1b1150'],
  ['magpie', '#0b0b0d'],
  ['petroica', '#2A2A2E'],
  ['platypus', '#0f3538'],
  ['quokka', '#f4e2bc'],
  ['swamphen', '#222235'],
  ['treefrog', '#0a4020'],
  ['wallaby', '#323232'],
  ['wombat', '#1c1814'],
];

/** `#rrggbb` as getComputedStyle reports it. */
const rgb = (hex: string): string => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

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

  test('help shows the portfolio heading, and a tapped name brings the prompt into view', async ({ page, hasTouch }) => {
    await page.goto('/');
    if (hasTouch) {
      // As a visitor on a phone runs it: a tap on help in the banner, with the keyboard down. The
      // index is taller than a phone's screen now that the catalogue has arrived, and a long
      // output is shown from its start there (ui/actions/stickToBottom.ts).
      const echoes = page.locator('[role="log"] .command-input-display');
      const help = page.locator('[role="log"]').getByRole('button', { name: 'help', exact: true }).first();
      await expect(help).toBeVisible();
      const before = await echoes.count();
      await help.tap();
      await expect(echoes).toHaveCount(before + 1);
      await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
    } else await run(page, 'help');
    const output = lastEntry(page).locator('.command-output');
    // The portfolio comes first, and stays on screen rather than scrolled off.
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

  test('theme cockatoo recolours earlier output, and moves the marker in an earlier theme ls', async ({ page }) => {
    await page.goto('/');
    await run(page, 'help');
    await run(page, 'theme ls');
    const heading = page.locator('[role="log"]').getByText('Portfolio', { exact: true }).first();
    const before = await heading.evaluate((el) => getComputedStyle(el).color);
    // The theme ls entry itself, which stays where it is as later lines are added.
    const listing = page.locator('[role="log"] .entry').nth((await page.locator('[role="log"] .entry').count()) - 1);
    await expect(listing.locator('button[aria-current="true"]')).toHaveText('swamphen');

    await run(page, 'theme cockatoo');
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

  test('theme ls lists all fifteen themes, each a tap that switches, and the five newest apply', async ({ page, hasTouch }) => {
    await page.goto('/');
    await run(page, 'theme ls');
    // The theme ls entry itself, which stays where it is as later lines are added.
    const listing = page.locator('[role="log"] .entry').nth((await page.locator('[role="log"] .entry').count()) - 1);
    await expect(listing.locator('.swatches')).toHaveCount(15);
    for (const [name, background] of THEMES) {
      const button = listing.getByRole('button', { name, exact: true });
      await expect(button).toHaveCount(1);
      await expect(listing.locator('.swatches').nth(THEMES.findIndex(([other]) => other === name))).toHaveCSS('background-color', rgb(background));
    }
    await expect(listing).toContainText(`Try one with: theme NAME, or ${hasTouch ? 'tap' : 'click'} a name.`);
    await expect(listing.locator('button[aria-current="true"]')).toHaveText('swamphen');

    // `theme set NAME` is gone: set is read as a theme name.
    await run(page, 'theme set wombat');
    await expect(lastEntry(page)).toContainText("theme: extra operand 'wombat'");
    await expect(page.locator('html')).toHaveCSS('background-color', rgb('#222235'));

    for (const name of ['galah', 'lorikeet', 'magpie', 'platypus', 'quokka']) {
      const background = THEMES.find(([other]) => other === name)?.[1] ?? '';
      await run(page, `theme ${name}`);
      await expect(lastEntry(page)).toContainText(`Theme set to ${name}.`);
      // The page takes the new background, and the earlier listing's marker moves.
      await expect(page.locator('html')).toHaveCSS('background-color', rgb(background));
      await expect(page.locator('html')).toHaveCSS('--theme-background', background);
      await expect(listing.locator('button[aria-current="true"]')).toHaveText(name);
    }
    // quokka is the second light theme.
    expect(await page.locator('html').evaluate((el) => el.style.colorScheme)).toBe('light');

    // A tap on a name in the listing switches too.
    const cassowary = listing.getByRole('button', { name: 'cassowary', exact: true });
    if (hasTouch) await cassowary.tap();
    else await cassowary.click();
    await expect(lastEntry(page)).toContainText('Theme set to cassowary.');
    await expect(listing.locator('button[aria-current="true"]')).toHaveText('cassowary');
  });

  test('after theme ls on a phone, the dock offers every one of the fifteen themes as a chip', async ({ page, hasTouch }) => {
    test.skip(!hasTouch, 'the phone dock');
    await page.goto('/');
    await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
    const dock = page.locator('.dock');
    const starter = dock.getByRole('option', { name: 'Run: theme ls', exact: true });
    await expect(starter).toBeVisible();
    await starter.tap();
    await expect(lastEntry(page)).toContainText('Try one with: theme NAME, or tap a name.');
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
    // One chip a theme, in the listing's order, none cut off into a count, then the starters.
    const followups = dock.getByRole('option', { name: /^Run: theme (?!ls$)/ });
    await expect(followups).toHaveCount(15);
    expect(await followups.evaluateAll((chips) => chips.map((chip) => chip.getAttribute('aria-label')))).toEqual(THEMES.map(([name]) => `Run: theme ${name}`));
    await expect(dock.locator('.more')).toHaveCount(0);
    await expect(dock.getByRole('option', { name: 'Run: help', exact: true })).toHaveCount(1);
    // The row scrolls sideways to the last of them, which then switches in one tap.
    const wombat = dock.getByRole('option', { name: 'Run: theme wombat', exact: true });
    await wombat.scrollIntoViewIfNeeded();
    await wombat.tap();
    await expect(lastEntry(page)).toContainText('Theme set to wombat.');
    await expect(page.locator('html')).toHaveCSS('background-color', rgb('#1c1814'));
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
