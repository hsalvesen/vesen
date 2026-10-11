import { expect, test, type Page } from '@playwright/test';

// The status line under a running line, and output that reflows when the screen changes size
// (docs/plan/designs/shell-architecture.md, step 6 and section 8; docs/plan/04, "Output reflow";
// F013, F015, F016, F047, F074).

const PHONES = ['iphone-instagram', 'pixel-7'];
const isPhone = () => PHONES.includes(test.info().project.name);

const prompt = (page: Page) => page.getByRole('combobox', { name: 'Terminal command' });

/** Runs a line at the prompt and waits until it has finished. */
async function run(page: Page, line: string): Promise<void> {
  const echoes = page.locator('[role="log"] .command-input-display');
  const before = await echoes.count();
  await prompt(page).fill(line);
  await prompt(page).press('Enter');
  await expect(echoes).toHaveCount(before + 1);
  await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
}

/** How far the page, and the transcript, are wider than the screen; both 0 when nothing scrolls sideways. */
const sideways = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('main');
    return {
      page: Math.max(0, document.documentElement.scrollWidth - window.innerWidth),
      body: Math.max(0, document.body.scrollWidth - window.innerWidth),
      transcript: main ? Math.max(0, main.scrollWidth - main.clientWidth) : Infinity,
    };
  });

/** The entry a line was typed in, the newest first. */
const entryOf = (page: Page, line: string) =>
  page.locator('[role="log"] .entry').filter({ has: page.locator('.command-input-display', { hasText: new RegExp(`^${line}$`) }) }).last();

test.describe('the status line', { tag: '@smoke' }, () => {
  test('a long sleep shows its label at once, the seconds after 3 s, and stops on Escape', async ({ page }) => {
    await page.goto('/');
    await prompt(page).fill('sleep 5');
    await prompt(page).press('Enter');

    // The line is in the transcript at once (F013), with the status line under it.
    const entry = entryOf(page, 'sleep 5');
    await expect(entry).toHaveClass(/\brunning\b/);
    const status = entry.getByRole('button', { name: 'Stop: sleeping 5' });
    await expect(status).toBeVisible();
    await expect(status).toContainText('sleeping 5');
    if (isPhone()) await expect(status.locator('.stop-chip')).toHaveText('■ Stop');
    else await expect(status).toContainText('(Ctrl+C or Esc to stop)');
    await expect(status.locator('.elapsed')).toHaveCount(0);
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'true');

    // From three seconds, how long it has run.
    await expect(status.locator('.elapsed')).toHaveText(/· [34]s$/, { timeout: 4500 });

    await page.keyboard.press('Escape');
    await expect(status).toBeHidden();
    await expect(entry).toContainText('^C');
    await expect(entry).not.toHaveClass(/\brunning\b/);
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
  });

  test('output a line writes shows under it while it still runs', async ({ page }) => {
    await page.goto('/');
    await prompt(page).fill('echo first; sleep 5; echo last');
    await prompt(page).press('Enter');
    const entry = entryOf(page, 'echo first; sleep 5; echo last');
    await expect(entry.locator('.command-output')).toHaveText('first');
    await expect(entry.getByRole('button', { name: 'Stop: sleeping 5' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(entry.locator('.command-output')).toHaveText(/^first\s*\^C$/);
  });
});

test.describe('output reflow', { tag: '@smoke' }, () => {
  test('rotating after help and fastfetch reflows both, without running them again', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await run(page, 'help');
    await run(page, 'fastfetch');

    const layout = () =>
      page.evaluate(() => {
        const entries = Array.from(document.querySelectorAll('[role="log"] .entry'));
        const typed = (line: string) => entries.find((entry) => entry.querySelector('.command-input-display')?.textContent === line);
        // The help index's widest band: how many of its category columns share one top edge.
        const tops = Array.from(typed('help')?.querySelectorAll('.lists .list') ?? [], (list) => Math.round(list.getBoundingClientRect().top));
        const columns = Math.max(0, ...Array.from(new Set(tops), (top) => tops.filter((t) => t === top).length));
        const [side, main] = Array.from(typed('fastfetch')?.querySelector('.columns')?.children ?? [], (column) => column.getBoundingClientRect());
        return { entries: entries.length, columns, sideBySide: side !== undefined && main !== undefined && Math.abs(side.top - main.top) < 2 };
      });

    const portrait = await layout();
    expect(await sideways(page)).toEqual({ page: 0, body: 0, transcript: 0 });

    await page.setViewportSize({ width: 812, height: 375 });
    await expect.poll(async () => (await layout()).columns, { message: 'the help index fits more columns to a band' }).toBeGreaterThan(portrait.columns);
    const landscape = await layout();
    expect(landscape.entries, 'nothing ran again').toBe(portrait.entries);
    expect(portrait.sideBySide, 'fastfetch is stacked in portrait').toBe(false);
    expect(landscape.sideBySide, 'fastfetch is side by side in landscape').toBe(true);
    expect(await sideways(page)).toEqual({ page: 0, body: 0, transcript: 0 });

    // And back.
    await page.setViewportSize({ width: 375, height: 812 });
    await expect.poll(async () => (await layout()).columns).toBe(portrait.columns);
    expect(await sideways(page)).toEqual({ page: 0, body: 0, transcript: 0 });
  });

  for (const width of [320, 375, 414, 768, 1024, 1440]) {
    test(`at ${width}px nothing makes the page scroll sideways`, async ({ page }) => {
      // Phones at phone widths; the desktop at all of them.
      test.skip(isPhone() && width > 414, 'phone widths on the phones');
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      expect(await sideways(page), 'banner').toEqual({ page: 0, body: 0, transcript: 0 });
      for (const line of ['help', 'ls -la', 'history', 'theme ls', 'cathode ls', 'fastfetch', 'qr vesen.app', 'banner']) {
        await run(page, line);
        expect(await sideways(page), line).toEqual({ page: 0, body: 0, transcript: 0 });
      }
    });
  }

  test('a table stacks into key: value rows when narrow, and goes back to columns when wide', async ({ page }) => {
    test.skip(isPhone(), 'the desktop window is resized');
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/');
    await run(page, 'privacy');
    const table = entryOf(page, 'privacy').locator('table').first();
    const shape = () =>
      table.evaluate((element) => ({
        row: getComputedStyle(element.querySelector('tbody tr') as Element).display,
        label: getComputedStyle(element.querySelector('.cell-label') as Element).display,
      }));
    expect(await shape()).toEqual({ row: 'block', label: 'inline' });
    await page.setViewportSize({ width: 1440, height: 800 });
    await expect.poll(shape).toEqual({ row: 'table-row', label: 'none' });
    expect(await sideways(page)).toEqual({ page: 0, body: 0, transcript: 0 });
  });

  test("fastfetch's logo stacks above its details on a narrow screen, and goes beside them when wide", async ({ page }) => {
    test.skip(isPhone(), 'the desktop window is resized');
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto('/');
    await run(page, 'fastfetch');
    const columns = entryOf(page, 'fastfetch').locator('.columns');
    const lefts = () => columns.evaluate((element) => Array.from(element.children, (column) => Math.round(column.getBoundingClientRect().left)));
    const [logo, details] = await lefts();
    expect(details).toBe(logo);
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect.poll(async () => {
      const [wideLogo, wideDetails] = await lefts();
      return (wideDetails ?? 0) > (wideLogo ?? 0);
    }).toBe(true);
    expect(await sideways(page)).toEqual({ page: 0, body: 0, transcript: 0 });
  });
});

test.describe('ls and the banner at phone widths', { tag: '@smoke' }, () => {
  /** The distinct column positions of the newest grid's names, and its height. */
  const lsColumns = (page: Page) =>
    page.evaluate(() => {
      const grids = document.querySelectorAll('[role="log"] .grid.by-column');
      const grid = grids[grids.length - 1] as HTMLElement;
      const lefts = new Set(Array.from(grid.children, (child) => Math.round(child.getBoundingClientRect().left)));
      return { columns: lefts.size, height: grid.getBoundingClientRect().height, rows: Math.ceil(grid.children.length / lefts.size) };
    });

  for (const width of [375, 812, 1280]) {
    test(`ls lays names out in columns at ${width}px, filled top to bottom`, async ({ page }) => {
      await page.setViewportSize({ width, height: width > 800 ? 800 : 667 });
      await page.goto('/');
      if (isPhone()) await prompt(page).tap();
      await run(page, 'ls /usr/bin');
      const { columns } = await lsColumns(page);
      expect(columns).toBeGreaterThan(1);
    });
  }

  test('rotation reflows ls without running it again', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto('/');
    if (isPhone()) await prompt(page).tap();
    await run(page, 'ls /usr/bin');
    const portrait = await lsColumns(page);
    await page.setViewportSize({ width: 667, height: 375 });
    await expect.poll(async () => (await lsColumns(page)).columns).toBeGreaterThan(portrait.columns);
  });

  test("at 320px the banner never splits the owner's name across two lines", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto('/');
    const lines = await page.evaluate(() => {
      const span = Array.from(document.querySelectorAll('[role="log"] span')).find((element) => element.textContent?.includes('by Has'));
      const node = span?.firstChild;
      if (!node || node.nodeType !== Node.TEXT_NODE) return null;
      const text = node.textContent ?? '';
      const range = document.createRange();
      const at = text.indexOf('Has');
      range.setStart(node, at);
      range.setEnd(node, at + 'Has Salvesen'.length);
      return new Set(Array.from(range.getClientRects(), (rect) => Math.round(rect.top))).size;
    });
    expect(lines).toBe(1);
  });
});
