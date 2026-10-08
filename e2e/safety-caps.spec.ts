import { expect, test, type Page } from '@playwright/test';

// The safety caps in a real page, on a desktop and on the phones: a command that reads all of an
// endless input, a line that draws thousands of pictures, and a ping to a private address given
// as IPv6. Before, the first filled the tab's memory until the phone killed it, the second put
// tens of megabytes of art on the page, and the third sent requests into the visitor's network.
// A timer in the page measures the longest it went without a turn while each ran: that is what
// shows the page was never frozen.

const prompt = (page: Page) => page.getByRole('combobox', { name: 'Terminal command' });
const lastEntry = (page: Page) => page.locator('[role="log"] .entry').last();

/** Runs a line at the prompt and waits until it is in the transcript and nothing runs. */
async function run(page: Page, line: string, timeout = 5_000): Promise<void> {
  const echoes = page.locator('[role="log"] .command-input-display');
  const before = await echoes.count();
  await prompt(page).fill(line);
  await prompt(page).press('Enter');
  await expect(echoes).toHaveCount(before + 1);
  await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false', { timeout });
}

/** Starts a timer in the page that keeps the longest gap between its ticks. */
async function startHeartbeat(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __gap: number };
    w.__gap = 0;
    let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      w.__gap = Math.max(w.__gap, now - last);
      last = now;
    }, 50);
  });
}

const longestGap = (page: Page): Promise<number> => page.evaluate(() => (window as unknown as { __gap: number }).__gap);

/** Longer than any turn a busy line should take from the page, even on a loaded machine. */
const FROZEN_MS = 5_000;

test.describe('safety caps', { tag: '@smoke' }, () => {
  test.beforeEach(async ({ page }) => {
    // Nothing leaves the machine: any request off this origin is refused and noted.
    const away: string[] = [];
    await page.route(
      (url) => url.hostname !== 'localhost',
      (route) => {
        away.push(route.request().url());
        return route.abort('failed');
      },
    );
    (page as Page & { away?: string[] }).away = away;
    await page.goto('/');
    await expect(prompt(page)).toBeVisible();
  });

  test('a command that reads all of an endless input stops at 16 MB, and the page answers throughout', async ({ page }) => {
    test.setTimeout(90_000);
    await startHeartbeat(page);
    await run(page, 'seq 1000000000 | sort', 60_000);
    await expect(lastEntry(page)).toContainText('sort: standard input: input too large (over 16 MB)');
    expect(await longestGap(page)).toBeLessThan(FROZEN_MS);
    await run(page, 'echo still here');
    await expect(lastEntry(page).locator('.command-output')).toHaveText('still here');
  });

  test('drawings count against the screen cap like lines, so a thousand figlets stop with a notice', async ({ page }) => {
    test.setTimeout(90_000);
    await startHeartbeat(page);
    // Each draws about 24 rows; together they are past the screen's 20,000.
    await run(page, 'seq 1000 1999 | xargs -n 1 figlet -w 6', 60_000);
    const entry = lastEntry(page);
    await expect(entry).toContainText('[output truncated]');
    const drawings = await entry.locator('.art').count();
    expect(drawings).toBeGreaterThan(100);
    expect(drawings).toBeLessThan(1000);
    expect(await longestGap(page)).toBeLessThan(FROZEN_MS);
    // A message too long to draw is refused before it is read.
    await run(page, 'seq 100000 | figlet');
    await expect(lastEntry(page)).toContainText('figlet: message too long (over 4096 characters)');
  });

  test('ping refuses a private address written inside an IPv6 one, and asks nothing of the network', async ({ page }) => {
    await run(page, 'ping -c 1 ::ffff:192.168.1.1');
    await expect(lastEntry(page)).toContainText('ping: ::ffff:192.168.1.1 (::ffff:192.168.1.1) is a private address, which a page on the internet may not reach');
    await run(page, 'ping -c 1 ff02::1');
    await expect(lastEntry(page)).toContainText('is a multicast address');
    const asked = (page as Page & { away?: string[] }).away ?? [];
    expect(asked.filter((url) => /192\.168|c0a8|ff02/i.test(url))).toEqual([]);
  });
});
