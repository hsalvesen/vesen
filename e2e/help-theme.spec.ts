import { expect, test, type Page } from '@playwright/test';

// help, theme and the shell built-ins as specs (docs/plan/08-shell-and-commands.md, step 2.3b):
// help lists the commands by category, in columns that reflow with the screen, and a tapped name
// goes to the prompt; theme set recolours what is already on the screen and moves the marker in
// an earlier theme ls; exit offers a new session. The index is checked on every project, the
// rest on a desktop and in Instagram's in-app browser on an iPhone.

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

/** The categories of the help index, in its order: the portfolio as a grid, the rest as columns. */
const CATEGORIES = ['Portfolio', 'Files', 'Text', 'Shell', 'System', 'Network', 'Fun', 'Editor'];

test.describe('the help index', { tag: '@smoke' }, () => {
  test('shows every category, the commands in columns that fit the screen, and a tapped name goes to the prompt', async ({ page, hasTouch }) => {
    await page.goto('/');
    await run(page, 'help');
    const output = lastEntry(page).locator('.command-output');
    for (const heading of CATEGORIES) {
      await expect(output.getByText(heading, { exact: true })).toBeVisible();
    }
    // The portfolio is a grid of names and what they do...
    await expect(output.locator('.grid .cell').filter({ hasText: 'change the colour theme' })).toHaveCount(1);
    // ...and every other category a column: its title over every one of its commands, by name,
    // nothing cut and nothing counted.
    const columns = output.locator('.lists .list');
    await expect(columns).toHaveCount(CATEGORIES.length - 1);
    const shape = await columns.evaluateAll((lists) =>
      lists.map((list) => ({
        title: list.querySelector('.list-title')?.textContent ?? '',
        names: Array.from(list.querySelectorAll('[role="listitem"] button'), (button) => button.textContent ?? ''),
        top: Math.round(list.getBoundingClientRect().top),
        right: list.getBoundingClientRect().right,
      })),
    );
    expect(shape.map((column) => column.title)).toEqual(CATEGORIES.slice(1));
    for (const column of shape) {
      expect(column.names.length, column.title).toBeGreaterThan(0);
      expect(column.names, column.title).toEqual([...column.names].sort((a, b) => a.localeCompare(b)));
    }
    expect(shape.find((column) => column.title === 'Files')?.names).toEqual(expect.arrayContaining(['cat', 'cd', 'find', 'ls', 'tree']));
    expect(shape.find((column) => column.title === 'Editor')?.names).toEqual(['less', 'more', 'nano']);
    expect(await output.getByText(/\+\d+ more/).count()).toBe(0);
    // A desktop shows the seven side by side; a phone three or four a band.
    const bands = new Set(shape.map((column) => column.top)).size;
    if (test.info().project.name === 'desktop-chrome') expect(bands).toBe(1);
    else expect(bands).toBeGreaterThanOrEqual(2);

    // Nothing is wider than the screen.
    const main = await page.locator('main').evaluate((element) => ({ overflow: element.scrollWidth - element.clientWidth, right: element.getBoundingClientRect().right }));
    expect(main.overflow).toBeLessThanOrEqual(0);
    for (const column of shape) expect(column.right, column.title).toBeLessThanOrEqual(main.right);

    // A name is a tap that puts it at the prompt.
    const name = output.getByRole('button', { name: 'nano', exact: true });
    await expect(name).toBeVisible();
    if (hasTouch) await name.tap();
    else await name.click();
    await expect(prompt(page)).toHaveValue('nano ');
  });

  test('in cathode phosphor, a tappable name glows like the text beside it', async ({ page }) => {
    // Chromium's own stylesheet gives a button no text shadow, so the glow has to be put back;
    // happy-dom applies no browser stylesheet, so only a browser can show it.
    test.skip(test.info().project.name !== 'desktop-chrome', 'desktop Chrome');
    await page.goto('/');
    await run(page, 'cathode phosphor');
    await expect(page.locator('html')).toHaveClass(/\bcrt-phosphor\b/);
    await run(page, 'help');
    const output = lastEntry(page).locator('.command-output');
    await expect(output.getByRole('button', { name: 'nano', exact: true })).toBeVisible();
    const shadows = await output.evaluate((element) => {
      // The glow is drawn in each element's own colour, so the shape is compared with the
      // colour, the element's own, written as the keyword.
      const shape = (node: Element | null | undefined): string | null => {
        if (!node) return null;
        const style = getComputedStyle(node);
        return style.textShadow.split(style.color).join('currentcolor');
      };
      // The hint line: the tappable `help --all`, then plain text, on one line.
      const hint = Array.from(element.querySelectorAll('.lines .text')).find((line) => line.textContent?.startsWith('help --all lists'));
      const button = hint?.querySelector('button.action');
      const span = hint?.querySelector('span');
      const buttons = Array.from(element.querySelectorAll('button.action'));
      const named = ['about', 'contact', 'banner', 'less', 'more', 'nano'].map((name) => buttons.find((candidate) => candidate.textContent === name));
      return {
        raw: button ? getComputedStyle(button).textShadow : null,
        button: shape(button),
        span: shape(span),
        names: named.map(shape),
      };
    });
    expect(shadows.raw).not.toBeNull();
    expect(shadows.raw).not.toBe('none');
    expect(shadows.button).toBe(shadows.span);
    for (const name of shadows.names) expect(name).toBe(shadows.span);
  });
});

test.describe('help and theme', { tag: '@smoke' }, () => {
  test.beforeEach(() => {
    test.skip(!['desktop-chrome', 'iphone-instagram'].includes(test.info().project.name), 'a desktop and Instagram on an iPhone');
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
    // The portfolio comes first. A phone shows a long output from its start, so its heading is in
    // view; a desktop follows the prompt, and the index, every command in columns, is taller than
    // its screen now, so there the heading is in view once the output is scrolled to its start.
    const heading = output.getByText('Portfolio', { exact: true });
    await expect(heading).toBeVisible();
    await expect(output.locator('.text').first()).toHaveText('Portfolio');
    if (hasTouch) await expect(heading).toBeInViewport();
    await expect(output.getByRole('button', { name: 'help --all', exact: true })).toBeVisible();

    // Scroll the prompt out of sight, to the start of the output, then tap a name: the prompt
    // comes back with the name in it.
    await page.locator('main').evaluate((main) => main.scrollTo({ top: 0 }));
    await expect(heading).toBeInViewport();
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
