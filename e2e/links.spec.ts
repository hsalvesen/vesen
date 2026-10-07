import { expect, test, type Page } from '@playwright/test';

// Links, the in-app policy, power off and the session snapshot (docs/plan/04-phone-and-instagram.md,
// "Inside Instagram's browser"; 02, section 7; F051, F029): openers print cards everywhere and
// open a tab only on a desktop browser, inside the Enter, with noopener; Copy copies; poweroff
// never leaves a dead page; and Back brings the terminal back.

const PHONES = ['iphone-instagram', 'pixel-7'];
const isPhone = () => PHONES.includes(test.info().project.name);
const isInstagram = () => test.info().project.name === 'iphone-instagram';

const prompt = (page: Page) => page.locator('input.command-input');
const echoes = (page: Page) => page.locator('[role="log"] .command-input-display');
const log = (page: Page) => page.getByRole('log');

/** window.open and window.close, recorded instead of done. */
async function spyOnWindow(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const spied = window as Window & { __opens?: unknown[][]; __closes?: number };
    spied.__opens = [];
    spied.__closes = 0;
    window.open = ((...args: unknown[]) => {
      spied.__opens?.push(args);
      return null;
    }) as typeof window.open;
    window.close = () => {
      spied.__closes = (spied.__closes ?? 0) + 1;
    };
  });
}

const opens = (page: Page) => page.evaluate(() => (window as Window & { __opens?: unknown[][] }).__opens ?? []);
const closes = (page: Page) => page.evaluate(() => (window as Window & { __closes?: number }).__closes ?? 0);

/** Opens the terminal with the kernel and the completion engine loaded. */
async function open(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('[data-completion="ready"]')).toHaveCount(1);
  if (isPhone()) {
    await prompt(page).tap();
    await expect(prompt(page)).toBeFocused();
  }
}

/** Types a line at the prompt and waits until it has run. */
async function run(page: Page, line: string): Promise<void> {
  const before = await echoes(page).count();
  await prompt(page).fill(line);
  await prompt(page).press('Enter');
  await expect(echoes(page)).toHaveCount(before + 1);
  await expect(log(page)).toHaveAttribute('aria-busy', 'false');
}

test.describe('links and the in-app policy', { tag: '@smoke' }, () => {
  test('whoami prints cards everywhere, and opens LinkedIn only on a desktop browser, once, with noopener', async ({ page }) => {
    await spyOnWindow(page);
    await open(page);
    await run(page, 'whoami');

    const cards = page.locator('[role="log"] .card');
    await expect(cards).toHaveCount(3);
    await expect(cards.nth(0)).toContainText('linkedin.com/in/harrysalvesen');
    await expect(cards.nth(1)).toContainText('github.com/hsalvesen');
    await expect(cards.nth(2)).toContainText('has@salvesen.app');
    await expect(cards.nth(2).getByRole('link', { name: '✉ Open mail app' })).toHaveAttribute('href', /^mailto:has@salvesen\.app\?subject=/);

    const calls = await opens(page);
    const linkedin = cards.nth(0).getByRole('link');
    if (isPhone()) {
      // Nothing navigates without a tap.
      expect(calls).toEqual([]);
      await expect(log(page)).not.toContainText('opened in a new tab');
      // Inside Instagram a tapped link opens in the same view, so Back comes back.
      await expect(linkedin).toHaveAttribute('target', isInstagram() ? '_self' : '_blank');
    } else {
      expect(calls).toHaveLength(1);
      expect(calls[0]?.[0]).toBe('https://www.linkedin.com/in/harrysalvesen/');
      expect(calls[0]?.[1]).toBe('_blank');
      expect(String(calls[0]?.[2])).toContain('noopener');
      await expect(log(page)).toContainText('(opened in a new tab)');
      await expect(linkedin).toHaveAttribute('target', '_blank');
    }
    await expect(linkedin).toHaveAttribute('rel', 'noopener noreferrer');
    expect(await closes(page)).toBe(0);
  });

  test('contact offers the mail app and Copy, and never opens anything itself', async ({ page }) => {
    await spyOnWindow(page);
    await open(page);
    await run(page, 'contact');
    const card = page.locator('[role="log"] .card').last();
    await expect(card.getByRole('link', { name: '✉ Open mail app' })).toBeVisible();
    await expect(card.getByRole('button', { name: '⧉ Copy address' })).toBeVisible();
    if (isInstagram()) {
      await expect(card).toContainText("If the mail app doesn't open");
      await expect(card).toContainText('••• → Open in browser');
      await expect(card.getByRole('button', { name: 'Open in Safari ↗' })).toBeVisible();
    } else {
      await expect(card).not.toContainText('Open in browser');
    }
    expect(await opens(page)).toEqual([]);
  });

  test('Copy copies, and says so', async ({ page, context, browserName }) => {
    if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await open(page);
    await run(page, 'contact');
    const copy = page.locator('[role="log"] .card').last().getByRole('button', { name: '⧉ Copy address' });
    if (isPhone()) await copy.tap();
    else await copy.click();
    if (browserName === 'chromium') {
      await expect(page.locator('[role="log"] .card').last().getByRole('button', { name: '✓ Copied' })).toBeVisible();
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('has@salvesen.app');
      await expect(page.locator('[role="log"] .card').last().getByRole('status')).toHaveText('Copied');
    } else {
      // WebKit may refuse the clipboard; then the address is selected to press and hold.
      await expect(page.locator('[role="log"] .card').last().getByText(/✓ Copied|Press and hold to copy/).first()).toBeVisible();
    }
  });
});

test.describe('poweroff', { tag: '@smoke' }, () => {
  test('shuts down to a screen with Power on, which brings the prompt back with the files kept', async ({ page }) => {
    await spyOnWindow(page);
    await open(page);
    await run(page, 'echo kept > keep.txt');
    await prompt(page).fill('poweroff');
    await prompt(page).press('Enter');

    await expect(page.getByText('Reached target System Power Off.')).toBeVisible();
    await expect(page.getByText('vesen is off')).toBeVisible();
    await expect(page.locator('.shell')).toHaveAttribute('inert', '');
    if (isInstagram()) await expect(page.getByText('Close this page with ✕')).toBeVisible();
    const power = page.getByRole('button', { name: /Power on/ });
    if (isPhone()) await power.tap();
    else await power.click();

    await expect(page.getByText('vesen is off')).toBeHidden();
    await expect(page.getByText('to see all available commands.')).toBeVisible();
    await expect(page.locator('.shell')).not.toHaveAttribute('inert', '');
    if (isPhone()) await prompt(page).tap();
    await run(page, 'cat keep.txt');
    await expect(page.locator('[role="log"] .entry').last()).toContainText('kept');
    expect(await closes(page)).toBe(0);
  });
});

test.describe('the session snapshot', { tag: '@smoke' }, () => {
  test('Back brings the screen, the line and the folder back; a reload starts fresh', async ({ page }) => {
    await open(page);
    await run(page, 'echo marker-4711');
    await run(page, 'cd documents');
    await prompt(page).fill('ls -l');

    await page.goto('/404.html');
    await expect(page.getByText('No such file or directory')).toBeVisible();
    await page.goBack();

    await expect(log(page)).toContainText('marker-4711');
    await expect(prompt(page)).toHaveValue('ls -l');
    await expect(page.locator('.prompt-line .edit-row')).toContainText('~/documents');

    await page.reload();
    await expect(page.getByText('to see all available commands.')).toBeVisible();
    await expect(log(page)).not.toContainText('marker-4711');
  });

  test('a link tapped inside Instagram opens in the same view, and Back returns to the cards', async ({ page, context }) => {
    test.skip(!isInstagram(), "Instagram's in-app browser");
    await context.route('https://www.linkedin.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>LinkedIn</title><p>profile</p>' }));
    await open(page);
    await run(page, 'whoami');
    await page.locator('[role="log"] .card').first().getByRole('link').tap();
    await expect(page).toHaveURL(/linkedin\.com/);
    await page.goBack();
    await expect(page.locator('[role="log"] .card')).toHaveCount(3);
    await expect(log(page)).toContainText('Has Salvesen');
  });
});
