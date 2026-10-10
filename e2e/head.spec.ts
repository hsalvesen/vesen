import { expect, test, type Page } from '@playwright/test';

const themeColor = (page: Page) => page.locator('meta[name="theme-color"]');
const svgIcon = (page: Page) => page.locator('link[rel="icon"][type="image/svg+xml"]');
const pageColours = (page: Page) =>
  page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return { background: style.backgroundColor, scheme: style.colorScheme };
  });

async function run(page: Page, line: string) {
  const prompt = page.locator('input.command-input');
  await prompt.fill(line);
  await prompt.press('Enter');
}

test.describe('head, icons and manifest', { tag: '@smoke' }, () => {
  test('the manifest parses and every icon it lists is a PNG', async ({ request }) => {
    const response = await request.get('/manifest.webmanifest');
    expect(response.ok()).toBe(true);
    const manifest = (await response.json()) as { name: string; short_name: string; icons: { src: string }[] };
    expect(manifest.name).toBe('Vesen Terminal');
    expect(manifest.short_name).toBe('Vesen');
    expect(manifest.icons.length).toBeGreaterThanOrEqual(3);
    for (const { src } of manifest.icons) {
      const icon = await request.get(src);
      expect(icon.status(), src).toBe(200);
      expect(icon.headers()['content-type'], src).toBe('image/png');
    }
  });

  test('the link preview, touch icon, theme favicons and boot script are served with their types', async ({ request }) => {
    for (const [path, type] of [
      ['/og.png', /^image\/png$/],
      ['/icons/apple-touch-icon.png', /^image\/png$/],
      ['/icons/favicon-32.png', /^image\/png$/],
      ['/icons/theme/cockatoo.svg', /^image\/svg\+xml/],
      ['/boot.js', /^(?:text|application)\/javascript/],
    ] as const) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(200);
      expect(response.headers()['content-type'], path).toMatch(type);
    }
  });

  test('theme cockatoo retints the browser bars, the page and the favicon, and the boot script restores them', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByText('to see all available commands.')).toBeVisible();
    await expect(themeColor(page)).toHaveAttribute('content', '#222235');
    expect(await pageColours(page)).toEqual({ background: 'rgb(34, 34, 53)', scheme: 'dark' });

    await run(page, 'theme cockatoo');

    await expect(themeColor(page)).toHaveAttribute('content', '#e8ddd0');
    await expect(svgIcon(page)).toHaveAttribute('href', '/icons/theme/cockatoo.svg');
    expect(await pageColours(page)).toEqual({ background: 'rgb(232, 221, 208)', scheme: 'light' });

    // Without the app at all, the boot script alone paints the saved theme before first paint.
    await page.route(/\/assets\/index-[^/]+\.js$/, (route) => route.abort());
    await page.reload();
    await expect(themeColor(page)).toHaveAttribute('content', '#e8ddd0');
    await expect(svgIcon(page)).toHaveAttribute('href', '/icons/theme/cockatoo.svg');
    expect(await pageColours(page)).toEqual({ background: 'rgb(232, 221, 208)', scheme: 'light' });
    await expect(page.locator('#app')).toBeEmpty();
  });

  test('boots and switches themes when the browser blocks storage', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      for (const name of ['localStorage', 'sessionStorage']) {
        Object.defineProperty(window, name, {
          configurable: true,
          get() {
            throw new DOMException('The operation is insecure.', 'SecurityError');
          },
        });
      }
    });
    await page.goto('/');
    const blocked = await page.evaluate(() => {
      try {
        return typeof window.localStorage === 'undefined';
      } catch {
        return true;
      }
    });
    expect(blocked, 'storage is blocked in this engine').toBe(true);

    await expect(page.getByText('to see all available commands.')).toBeVisible();
    await run(page, 'theme cockatoo');
    await expect(themeColor(page)).toHaveAttribute('content', '#e8ddd0');
    expect(errors).toEqual([]);
  });
});
