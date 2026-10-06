import { expect, test, type Page } from '@playwright/test';

// The accessibility checklist (docs/plan/09-visual-and-accessibility.md, deliverable 6) for what
// the terminal has today, plus the CRT tiers and the role colours behind it. No axe dependency:
// the page is audited for the rules that matter here by a small script, and the rest by name.

const prompt = (page: Page) => page.getByRole('textbox', { name: 'Terminal command' });

/** Runs a line at the prompt and waits until its output is in the transcript. */
async function run(page: Page, line: string): Promise<void> {
  const echoes = page.locator('[role="log"] .command-input-display');
  const before = await echoes.count();
  await prompt(page).fill(line);
  await prompt(page).press('Enter');
  await expect(echoes).toHaveCount(before + 1);
  await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
}

/**
 * The axe-style rules this page could break, checked in the page: a language, a title, one h1,
 * names for every control, no duplicate ids, no positive tabindex, and nothing focusable hidden
 * from screen readers.
 */
function audit(): string[] {
  const problems: string[] = [];
  if (!document.documentElement.lang) problems.push('html has no lang');
  if (!document.title.trim()) problems.push('the page has no title');
  const headings = document.querySelectorAll('h1');
  if (headings.length !== 1) problems.push(`${headings.length} h1 elements`);

  const nameOf = (el: Element): string => {
    const labelledBy = el.getAttribute('aria-labelledby');
    const byId = labelledBy ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ') : '';
    const label = el.id ? document.querySelector(`label[for="${el.id}"]`)?.textContent ?? '' : '';
    return [el.getAttribute('aria-label') ?? '', byId, label, el.localName === 'input' ? '' : el.textContent ?? '']
      .join(' ')
      .trim();
  };
  for (const control of document.querySelectorAll('button, input, select, textarea, a[href], [role="button"]')) {
    if (!nameOf(control)) problems.push(`${control.outerHTML.slice(0, 80)} has no accessible name`);
  }

  const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
  for (const id of new Set(ids)) if (ids.filter((other) => other === id).length > 1) problems.push(`duplicate id ${id}`);

  for (const el of document.querySelectorAll('[tabindex]')) {
    if (Number(el.getAttribute('tabindex')) > 0) problems.push(`${el.localName} has a positive tabindex`);
  }
  const focusable = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
  for (const hidden of document.querySelectorAll('[aria-hidden="true"]')) {
    if (hidden.matches(focusable) || hidden.querySelector(focusable)) problems.push(`focusable content inside aria-hidden ${hidden.className}`);
  }
  return problems;
}

test.describe('accessibility', { tag: '@smoke' }, () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name !== 'desktop-chrome', 'the audit runs once, on desktop Chrome');
  });

  test('the page passes the audit after a few commands', async ({ page }) => {
    await page.route('https://api.ipify.org/**', (route) => route.fulfill({ json: { ip: '203.0.113.7' } }));
    await page.goto('/');
    for (const line of ['help', 'theme ls', 'lss', 'fastfetch']) await run(page, line);
    expect(await page.evaluate(audit)).toEqual([]);
  });

  test('landmarks: one hidden h1, a polite log that is busy while a command runs, a named input', async ({ page }) => {
    await page.route('https://httpbin.org/**', () => {});
    await page.goto('/');

    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveCount(1);
    await expect(heading).toHaveText('Vesen terminal');
    await expect(heading).toHaveClass(/\bsr-only\b/);

    const log = page.getByRole('log', { name: 'Terminal output' });
    await expect(log).toHaveAttribute('aria-live', 'polite');
    await expect(log).toHaveAttribute('aria-relevant', 'additions');
    await expect(log).toHaveAttribute('aria-busy', 'false');

    const input = prompt(page);
    await expect(input).toHaveAttribute('enterkeyhint', 'go');
    await expect(input).toHaveAttribute('autocomplete', 'off');

    await input.fill('curl https://httpbin.org/get');
    await input.press('Enter');
    await expect(log).toHaveAttribute('aria-busy', 'true');
    await page.getByRole('button', { name: 'Cancel running command' }).click();
    await expect(log).toHaveAttribute('aria-busy', 'false');
    // Prompts are spans, so the h1 stays the only heading however long the transcript gets.
    await expect(page.getByRole('heading')).toHaveCount(1);
  });

  test('art is hidden from screen readers, which hear a description instead', async ({ page }) => {
    await page.route('https://api.ipify.org/**', (route) => route.fulfill({ json: { ip: '203.0.113.7' } }));
    await page.goto('/');

    const banner = page.locator('.art-fit').first();
    await expect(banner).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('.sr-only', { hasText: 'Vesen logo' })).toHaveCount(1);
    await expect(page.getByText('vesen v', { exact: false }).first()).toBeVisible();

    await run(page, 'fastfetch');
    const logo = page.locator('[role="log"] .art[aria-hidden="true"]').nth(1);
    await expect(logo).toBeAttached();
    await expect(page.locator('.sr-only', { hasText: / logo$/ })).toHaveCount(2);
    await expect(page.locator('.sr-only', { hasText: "The theme's sixteen colours" })).toHaveCount(1);

    await run(page, 'theme ls');
    const swatches = page.locator('.swatches');
    await expect(swatches).toHaveCount(10);
    for (const row of await swatches.all()) await expect(row).toHaveAttribute('aria-hidden', 'true');
  });

  test('errors, hints and the prompt take their colours from the roles', async ({ page }) => {
    await page.goto('/');
    await run(page, 'lss');
    const colours = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const colourOf = (el: Element | null) => (el ? getComputedStyle(el).color : null);
      // Resolves a CSS colour to rgb() the way the browser paints it.
      const probe = document.createElement('span');
      document.body.append(probe);
      const resolve = (value: string) => {
        probe.style.color = value;
        return getComputedStyle(probe).color;
      };
      const span = (text: string) =>
        Array.from(document.querySelectorAll('[role="log"] span')).find((el) => el.textContent === text) ?? null;
      const result = {
        error: [colourOf(span('vesen: lss: command not found')), resolve(root.getPropertyValue('--role-error'))],
        hint: [colourOf(span('Did you mean ')), resolve(root.getPropertyValue('--role-muted'))],
        user: [colourOf(document.querySelector('.prompt-area .prompt span')), resolve(root.getPropertyValue('--role-prompt-user'))],
      };
      probe.remove();
      return result;
    });
    for (const [role, [painted, expected]] of Object.entries(colours)) expect(painted, role).toBe(expected);
  });
});

test.describe('theming', { tag: '@smoke' }, () => {
  test('earlier output follows a theme change: no hex colours outside the theme swatches', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-chrome', 'checked once, on desktop Chrome');
    await page.route('https://httpbin.org/**', (route) => route.fulfill({ json: { ok: true } }));
    await page.goto('/');
    for (const line of ['ls -a', 'history', 'lss', 'curl https://httpbin.org/get', 'echo hi > a.txt', 'theme ls']) await run(page, line);

    const baked = await page.locator('[role="log"]').evaluate((log) =>
      [...log.querySelectorAll<HTMLElement>('[style]')]
        .filter((el) => /#[0-9a-f]{3,8}\b|rgb/i.test(el.getAttribute('style') ?? '') && !el.closest('.swatches'))
        .map((el) => el.outerHTML.slice(0, 120)),
    );
    expect(baked).toEqual([]);

    // ls draws files in the strong text role, so the colour follows the theme.
    const fileColour = () =>
      page.locator('[role="log"] .grid span', { hasText: /^README\.md$/ }).first().evaluate((el) => getComputedStyle(el).color);
    const before = await fileColour();
    await run(page, 'theme set cockatoo');
    const after = await fileColour();
    expect(after).not.toBe(before);
    // Cockatoo's strong text is its near-black ink.
    expect(after).toBe('rgb(32, 17, 27)');
  });
});

test.describe('CRT tiers', { tag: '@smoke' }, () => {
  test('desktop gets the full effect, phones and Instagram the lite one', async ({ page }) => {
    await page.goto('/');
    const tier = test.info().project.name === 'desktop-chrome' ? 'full' : 'lite';
    await expect(page.locator('html')).toHaveClass(new RegExp(`\\bcrt-tier-${tier}\\b`));
    await expect(page.locator('html')).toHaveClass(/\bcrt-scanlines\b/);
    if (tier === 'lite') {
      // No animation and no filter on phones.
      const sweep = await page.locator('.crt-layer-sweep').evaluate((el) => getComputedStyle(el).display);
      expect(sweep).toBe('none');
    }

    await run(page, 'cathode ls');
    const reason = test.info().project.name === 'iphone-instagram' ? "in Instagram's in-app browser" : tier === 'lite' ? 'a touch screen' : 'a desktop';
    await expect(page.locator('[role="log"]')).toContainText(`Quality: ${tier} (auto: ${reason}`);
  });

  for (const [setting, emulate] of [
    ['reduced motion', { reducedMotion: 'reduce' }],
    ['increased contrast', { contrast: 'more' }],
    ['forced colours', { forcedColors: 'active' }],
  ] as const) {
    test(`${setting} turns the effect off, and cathode quality can bring it back`, async ({ page }) => {
      test.skip(test.info().project.name !== 'desktop-chrome', 'emulated once, on desktop Chrome');
      await page.emulateMedia(emulate);
      await page.goto('/');
      const html = page.locator('html');
      await expect(html).toHaveClass(/\bcrt-tier-off\b/);
      await expect(html).not.toHaveClass(/\bcrt-on\b/);
      await expect(page.locator('.crt-overlay')).toBeHidden();

      await run(page, 'cathode quality full');
      await expect(html).toHaveClass(/\bcrt-tier-full\b/);
      if (setting === 'forced colours') await expect(page.locator('.crt-overlay')).toBeHidden();
      else await expect(page.locator('.crt-overlay')).toBeVisible();
      if (setting === 'reduced motion') {
        expect(await page.locator('.crt-layer-sweep').evaluate((el) => getComputedStyle(el).display)).toBe('none');
      }
    });
  }

  test('the setting follows the system while the page is open', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-chrome', 'emulated once, on desktop Chrome');
    await page.goto('/');
    await expect(page.locator('html')).toHaveClass(/\bcrt-tier-full\b/);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('html')).toHaveClass(/\bcrt-tier-off\b/);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(page.locator('html')).toHaveClass(/\bcrt-tier-full\b/);
  });
});
