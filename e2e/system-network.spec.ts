import { expect, test, type Page, type Route } from '@playwright/test';

// fastfetch, curl and speedtest in a real browser (docs/plan/07, "curl"; 08, wave D; F027,
// F028, F050): fastfetch fits any width and its WM Theme follows the theme, curl prints what a
// site sends, and speedtest measures against routed fixtures, asking first on a phone. Every
// request is answered here: nothing reaches the network.

const PHONES = ['iphone-instagram', 'pixel-7'];
const isPhone = () => PHONES.includes(test.info().project.name);

const prompt = (page: Page) => page.locator('input.command-input');
const echoes = (page: Page) => page.locator('[role="log"] .command-input-display');

/** The entry a line was typed in, the newest first. */
const entryOf = (page: Page, line: string) =>
  page
    .locator('[role="log"] .entry')
    .filter({ has: page.locator('.command-input-display', { hasText: new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) })
    .last();

/** Types a line at the prompt and waits until it has run. */
async function run(page: Page, line: string): Promise<void> {
  const before = await echoes(page).count();
  await prompt(page).fill(line);
  await prompt(page).press('Enter');
  await expect(echoes(page)).toHaveCount(before + 1);
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

const CORS = { 'access-control-allow-origin': '*' };

test.describe('fastfetch', { tag: '@smoke' }, () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name === 'pixel-7', 'desktop Chrome and Instagram on an iPhone');
  });

  for (const width of [320, 375, 1280]) {
    test(`fits at ${width}px with nothing scrolling sideways, the logo beside the details only where there is room`, async ({ page }) => {
      test.skip(isPhone() && width > 414, 'phone widths on the phone');
      const asked: string[] = [];
      page.on('request', (request) => {
        if (!request.url().startsWith('http://localhost')) asked.push(request.url());
      });
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      await run(page, 'fastfetch');
      const entry = entryOf(page, 'fastfetch');
      await expect(entry).toContainText('OS: ');
      await expect(entry).toContainText('Terminal: vesen');
      expect(await sideways(page)).toEqual({ page: 0, body: 0, transcript: 0 });
      const sideBySide = await entry.locator('.columns').evaluate((columns) => {
        const [logo, details] = Array.from(columns.children, (column) => column.getBoundingClientRect());
        return logo !== undefined && details !== undefined && Math.abs(logo.top - details.top) < 2 && details.left > logo.left;
      });
      expect(sideBySide, 'the logo beside the details').toBe(width >= 1280);
      // Nothing is asked of the network without --net.
      expect(asked).toEqual([]);
    });
  }

  test("names the theme in a row that follows 'theme NAME', without running fastfetch again", async ({ page }) => {
    await page.goto('/');
    if (isPhone()) await prompt(page).tap();
    await run(page, 'fastfetch');
    const entry = entryOf(page, 'fastfetch');
    await expect(entry).toContainText('WM Theme: swamphen');
    await run(page, 'theme wombat');
    await expect(entry).toContainText('WM Theme: wombat');
    await expect(entry).not.toContainText('WM Theme: swamphen');
    await expect(echoes(page).filter({ hasText: /^fastfetch$/ })).toHaveCount(1);
  });

  test('adds the public IP with --net, and says where it came from', async ({ page }) => {
    await page.route('https://api.ipify.org/**', (route) => route.fulfill({ json: { ip: '203.0.113.7' }, headers: CORS }));
    await page.goto('/');
    await run(page, 'fastfetch --net');
    const entry = entryOf(page, 'fastfetch --net');
    await expect(entry).toContainText('Public IP: 203.0.113.7');
    await expect(entry).toContainText('Public IP from api.ipify.org, asked because of --net.');
  });
});

test.describe('ping', () => {
  test('^C, or the Stop chip on a phone, shows where the replies had got to, above the statistics', async ({ page }) => {
    // An address, so there is no name to look up, and its probes go to https://ADDRESS/ (a
    // favicon request never reaches Playwright's routes in Chromium). Two are answered; the third hangs.
    const address = '93.184.215.14';
    let probes = 0;
    await page.route(`https://${address}/**`, async (route) => {
      probes += 1;
      if (probes > 2) await new Promise((resolve) => setTimeout(resolve, 10_000));
      await route.fulfill({ status: 200, body: '' }).catch(() => {});
    });
    await page.goto('/');
    await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
    const line = `ping -c 10 -i 0.2 ${address}`;
    if (isPhone()) await prompt(page).tap();
    await prompt(page).fill(line);
    await prompt(page).press('Enter');
    const entry = entryOf(page, line);
    await expect(entry).toContainText(`reply from ${address}: seq=2 `);
    await expect.poll(() => probes).toBe(3);

    if (isPhone()) await page.locator('.dock').getByRole('option', { name: 'Cancel the running command (Control C)', exact: true }).tap();
    else await prompt(page).press('Control+c');
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');

    const rows = (await entry.locator('.command-output').innerText()).split('\n').filter((row) => row.trim() !== '');
    const shown = rows.join('\n');
    const at = (text: string) => rows.findIndex((row) => row.includes(text));
    expect(at('seq=2'), shown).toBeGreaterThan(at('seq=1'));
    expect(rows[at('seq=2') + 1]?.trim(), shown).toBe('^C');
    expect(rows[at('^C') + 1], shown).toContain(`--- ${address} ping statistics ---`);
    expect(rows.at(-1), shown).toContain('rtt min/avg/max/mdev');
    expect(rows.filter((row) => row.includes('^C')), shown).toHaveLength(1);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});

test.describe('curl', { tag: '@smoke' }, () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name === 'pixel-7', 'desktop Chrome and Instagram on an iPhone');
  });

  test('prints the body of a routed URL, as text', async ({ page }) => {
    await page.route('https://api.example.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/plain', headers: CORS, body: 'hello from the route\n<b>not bold</b>\n' }),
    );
    await page.goto('/');
    await run(page, 'curl https://api.example.test/hello');
    const entry = entryOf(page, 'curl https://api.example.test/hello');
    await expect(entry.locator('.command-output .text')).toHaveText(['hello from the route', '<b>not bold</b>']);
    await expect(entry.locator('b')).toHaveCount(0);
  });

  test('says honestly when the browser will not let it read a site', async ({ page }) => {
    // Blocked or unreachable look the same to the page, which is what curl says.
    await page.route('https://blocked.example.test/**', (route) => route.abort('failed'));
    await page.goto('/');
    await run(page, 'curl https://blocked.example.test/');
    await expect(entryOf(page, 'curl https://blocked.example.test/')).toContainText(
      'curl: (7) blocked.example.test: blocked by CORS or unreachable (the browser does not say which)',
    );
  });
});

/** Answers the speed test's endpoints with small bodies, as a slow fixture would. */
async function routeSpeedTest(page: Page): Promise<{ downloads: string[]; uploads: number }> {
  const seen = { downloads: [] as string[], uploads: 0 };
  await page.route('https://speed.cloudflare.com/**', async (route: Route) => {
    const request = route.request();
    const headers = { ...CORS, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST' };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const url = new URL(request.url());
    if (url.pathname === '/__up') {
      seen.uploads += 1;
      return route.fulfill({ status: 200, headers, contentType: 'text/plain', body: '' });
    }
    const bytes = Number(url.searchParams.get('bytes') ?? 0);
    if (bytes > 0) seen.downloads.push(url.searchParams.get('bytes') ?? '');
    return route.fulfill({ status: 200, headers, contentType: 'application/octet-stream', body: Buffer.alloc(Math.min(bytes, 64 * 1024)) });
  });
  return seen;
}

test.describe('speedtest', { tag: '@smoke' }, () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name === 'pixel-7', 'desktop Chrome and Instagram on an iPhone');
  });

  test('measures against routed fixtures and shows the table; a phone is asked first and runs light', async ({ page }) => {
    const seen = await routeSpeedTest(page);
    await page.goto('/');
    if (isPhone()) await prompt(page).tap();
    const before = await echoes(page).count();
    await prompt(page).fill('speedtest');
    await prompt(page).press('Enter');
    await expect(echoes(page)).toHaveCount(before + 1);
    if (isPhone()) {
      await expect(page.locator('.edit-row .read-prompt')).toHaveText('speedtest downloads about 6 MB. Continue? [y/N] ');
      await prompt(page).fill('y');
      await prompt(page).press('Enter');
    }
    const entry = entryOf(page, 'speedtest');
    await expect(entry.locator('table')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
    for (const label of ['Server', 'Latency', 'Jitter', 'Download', 'Upload', 'Data used']) await expect(entry.locator('table')).toContainText(label);
    await expect(entry.locator('table')).toContainText('Mbps');
    await expect(entry.locator('table')).toContainText(isPhone() ? '(light run)' : '(full run)');
    expect(seen.downloads).toEqual(isPhone() ? ['1048576', '5242880'] : ['1048576', '2097152', '5242880', '10485760', '26214400']);
    expect(seen.uploads).toBe(isPhone() ? 1 : 3);
    expect(await sideways(page)).toEqual({ page: 0, body: 0, transcript: 0 });
  });

  test('a no to the question on a phone spends nothing', async ({ page }) => {
    test.skip(!isPhone(), 'the question is asked on a touch screen');
    const seen = await routeSpeedTest(page);
    await page.goto('/');
    await prompt(page).tap();
    await prompt(page).fill('speedtest');
    await prompt(page).press('Enter');
    await expect(page.locator('.edit-row .read-prompt')).toHaveText('speedtest downloads about 6 MB. Continue? [y/N] ');
    await prompt(page).fill('n');
    await prompt(page).press('Enter');
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
    expect(seen.downloads).toEqual([]);
    expect(seen.uploads).toBe(0);
  });
});
