import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { isBenignConsoleMessage } from './console';

interface HeaderRule {
  source: string;
  headers: { key: string; value: string }[];
}

/** The headers firebase.json sends on every path, the content security policy included. */
function firebaseHeaders(): Record<string, string> {
  const config = JSON.parse(readFileSync(new URL('../firebase.json', import.meta.url), 'utf8')) as {
    hosting: { headers: HeaderRule[] };
  };
  const all = config.hosting.headers.find((rule) => rule.source === '**');
  const headers: Record<string, string> = {};
  for (const { key, value } of all?.headers ?? []) headers[key.toLowerCase()] = value;
  return headers;
}

/**
 * Serves same-origin responses with the production headers, and records anything that
 * would fail in production: console errors (CSP violations land there), page errors and
 * requests to other origins.
 */
async function servedLikeFirebase(page: Page, origin: string) {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && !isBenignConsoleMessage(message.text())) problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith('data:')) problems.push(`request to ${url}`);
  });

  const headers = firebaseHeaders();
  await page.route(
    (url) => url.origin === origin,
    async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, headers: { ...response.headers(), ...headers } });
    },
  );
  return problems;
}

test.describe('production headers', { tag: '@smoke' }, () => {
  test('the app boots and runs help under the production CSP', async ({ page, baseURL }) => {
    const problems = await servedLikeFirebase(page, new URL(baseURL ?? '').origin);
    await page.goto('/');

    await expect(page.getByText('to see all available commands.')).toBeVisible();
    const prompt = page.locator('input.command-input');
    await prompt.fill('help');
    await prompt.press('Enter');
    await expect(page.locator('main')).toContainText('fastfetch');
    expect(problems).toEqual([]);
  });

  test('the device probe runs under the production CSP and reports the user agent', async ({ page, baseURL }) => {
    const problems = await servedLikeFirebase(page, new URL(baseURL ?? '').origin);
    // How a link tapped in Instagram arrives: with per-click tracking ids.
    await page.goto('/probe/?utm_source=ig&fbclid=PAZXh0bgNhZW0CLICKID&igsh=MTExYWJj');

    const out = page.locator('#out');
    await expect(out).toContainText('"userAgent"');
    const json = (await out.textContent()) ?? '{}';
    const results = JSON.parse(json) as {
      url?: string;
      queryKeys?: string[];
      csp?: unknown[];
      ua?: { userAgent?: string };
    };
    expect(results.ua?.userAgent).toBe(await page.evaluate(() => navigator.userAgent));
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');

    // The results are pasted into the public repo: parameter names only, never their values.
    expect(results.url).toBe(`${new URL(baseURL ?? '').origin}/probe/`);
    expect(results.queryKeys).toEqual(['utm_source', 'fbclid', 'igsh']);
    expect(json).not.toMatch(/CLICKID|MTExYWJj/);
    expect(results.csp).toEqual([]);

    expect(problems).toEqual([]);
  });

  test('the 404 page names the missing path under the production CSP', async ({ page, baseURL }) => {
    const problems = await servedLikeFirebase(page, new URL(baseURL ?? '').origin);
    await page.goto('/404.html');

    await expect(page.getByText('vesen: /404.html: No such file or directory')).toBeVisible();
    await expect(page.getByRole('link', { name: 'cd ~' })).toHaveAttribute('href', '/');
    expect(problems).toEqual([]);
  });
});
