import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';

// Zoom, the command input and the terminal's type (docs/plan/04, slice "Zoom, input and type").

const PHONES = ['iphone-instagram', 'pixel-7'];

/** The Cache-Control firebase.json sends for /fonts/**. vite preview sends no-cache instead. */
function fontCacheControl(): string {
  const config = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8')) as {
    hosting: { headers: { source: string; headers: { key: string; value: string }[] }[] };
  };
  const rule = config.hosting.headers.find((r) => r.source === '/fonts/**');
  const value = rule?.headers.find((h) => h.key === 'Cache-Control')?.value;
  if (!value) throw new Error('firebase.json sets no Cache-Control for /fonts/**');
  return value;
}

const prompt = (page: Page) => page.getByRole('textbox', { name: 'Terminal command' });

/** Waits until the self-hosted font has loaded and is the one the terminal draws with. */
async function fontLoaded(page: Page): Promise<void> {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const face = [...document.fonts].find((f) => f.family.replace(/["']/g, '') === 'Vesen Mono');
          return face?.status === 'loaded' && document.fonts.check('13px "Vesen Mono"');
        }),
      // Loading can be slow on a busy test machine.
      { timeout: 15_000 },
    )
    .toBe(true);
}

test.describe('the terminal font', { tag: '@smoke' }, () => {
  test('Vesen Mono is preloaded, loads once, and is the first choice everywhere', async ({ page }) => {
    // Served as Firebase serves it: WebKit fetches a font again when it may not reuse the preload.
    const cacheControl = fontCacheControl();
    const fonts: string[] = [];
    await page.route('**/*.woff2', async (route) => {
      fonts.push(new URL(route.request().url()).pathname);
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), 'cache-control': cacheControl } });
    });
    await page.goto('/');
    await fontLoaded(page);
    expect(fonts).toEqual(['/fonts/VesenMono.woff2']);

    const families = await page.evaluate(() =>
      ['body', 'main', 'input.command-input', '.command-output'].map((selector) => {
        const element = document.querySelector(selector);
        return element ? getComputedStyle(element).fontFamily.split(',')[0]?.replace(/["']/g, '').trim() : null;
      }),
    );
    expect(families).toEqual(['Vesen Mono', 'Vesen Mono', 'Vesen Mono', 'Vesen Mono']);
  });

  test('the prompt names the brand as the host', async ({ page }) => {
    await page.goto('/');
    const ps1 = page.locator('.prompt-area span.font-bold').first();
    await expect(ps1).toHaveText(/^guest\s*@\s*vesen\s*:\s*~\s*\$$/);
  });

  test('a fine pointer keeps the input at the terminal size, unscaled', async ({ page }) => {
    test.skip(PHONES.includes(test.info().project.name), 'phones are checked below');
    await page.goto('/');
    const styles = await prompt(page).evaluate((input) => {
      const style = getComputedStyle(input);
      return {
        size: style.fontSize,
        body: getComputedStyle(document.body).fontSize,
        transform: style.transform,
        caret: style.caretColor,
      };
    });
    // The caret is the theme's cursor colour: white on the default theme.
    expect(styles).toEqual({ size: '16px', body: '16px', transform: 'none', caret: 'rgb(255, 255, 255)' });
  });
});

test.describe('zoom and the touch input', { tag: '@smoke' }, () => {
  test.beforeEach(() => {
    test.skip(!PHONES.includes(test.info().project.name), 'phone projects only');
  });

  test('pinch zoom is allowed', async ({ page }) => {
    await page.goto('/');
    const viewport = await page.locator('meta[name="viewport"]').getAttribute('content');
    expect(viewport).toBe('width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content');
    expect(viewport).not.toMatch(/user-scalable|maximum-scale|minimum-scale/);
  });

  test('the input is really 16px, drawn at the 13px terminal size', async ({ page }) => {
    await page.goto('/');
    const input = prompt(page);
    const measured = await input.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        fontSize: style.fontSize,
        termSize: getComputedStyle(document.body).fontSize,
        scale: getComputedStyle(document.documentElement).getPropertyValue('--input-scale').trim(),
        height: element.getBoundingClientRect().height,
        boxWidth: element.parentElement?.getBoundingClientRect().width ?? 0,
        width: element.getBoundingClientRect().width,
      };
    });
    expect(measured.fontSize).toBe('16px');
    expect(measured.termSize).toBe('13px');
    expect(measured.scale).toBe('0.8125');
    // One terminal line: 16px x 1.35 x 0.8125 on screen.
    expect(measured.height).toBeCloseTo(13 * 1.35, 0);
    expect(Math.abs(measured.width - measured.boxWidth)).toBeLessThanOrEqual(1);
  });

  test('focusing the input does not zoom the page', async ({ page }) => {
    await page.goto('/');
    const scale = () => page.evaluate(() => window.visualViewport?.scale ?? 1);
    expect(await scale()).toBe(1);

    await prompt(page).tap();
    await expect(prompt(page)).toBeFocused();
    await prompt(page).pressSequentially('ls');
    // Long enough for an iOS focus zoom to have started.
    await page.waitForTimeout(400);
    expect(await scale()).toBe(1);
  });

  test('?input=plain keeps a plain, unscaled 16px input', async ({ page }) => {
    await page.goto('/?input=plain');
    const measured = await prompt(page).evaluate((element) => ({
      fontSize: getComputedStyle(element).fontSize,
      scale: getComputedStyle(document.documentElement).getPropertyValue('--input-scale').trim(),
      plain: document.documentElement.classList.contains('input-plain'),
      height: element.getBoundingClientRect().height,
    }));
    expect(measured).toEqual({ fontSize: '16px', scale: '1', plain: true, height: expect.closeTo(16 * 1.35, 0) });
  });

  for (const width of [320, 375]) {
    test(`the banner fits at ${width}px, and the page never scrolls sideways`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await page.goto('/');
      await fontLoaded(page);

      const banner = page.locator('.art-fit').first();
      await expect(banner).toContainText('██╗   ██╗');
      const fit = await banner.evaluate((art) => {
        const style = getComputedStyle(art);
        return {
          rows: art.getBoundingClientRect().height / parseFloat(style.fontSize),
          overflow: art.scrollWidth - art.clientWidth,
          whiteSpace: style.whiteSpace,
          pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      // Six rows of art, none wrapped, none cut off, and no sideways scroll anywhere.
      expect(fit.rows).toBeCloseTo(6, 0);
      expect(fit.whiteSpace).toBe('pre');
      expect(fit.overflow, 'banner scrolls inside itself').toBeLessThanOrEqual(0);
      expect(fit.pageOverflow, 'page scrolls sideways').toBeLessThanOrEqual(0);

      // The prompt row fits too: typing a long line wraps nothing out of view.
      await prompt(page).fill('cat README.md && echo a much longer line than the screen is wide');
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    });
  }
});
