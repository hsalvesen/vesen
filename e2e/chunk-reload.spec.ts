import { expect, test, type Page, type Request, type Route } from '@playwright/test';
import { isBenignConsoleMessage, isBenignPageError } from './console';

// A chunk that fails to load (src/platform/chunkReload.ts). After a deploy the old build's
// chunks are gone, and the tab reloads once to pick up the new build. Any other failure leaves
// the page as it is: a chunk cut off because the visitor pressed Back (WebKit cancels the page's
// loads as soon as Back starts), or one the connection dropped, while the build is still there.
// A reload then would undo the visitor's Back and bring vesen back.

const PHONES = ['iphone-instagram', 'pixel-7'];
const isPhone = () => PHONES.includes(test.info().project.name);

/** The page the visitor came from, as in e2e/apps-back.spec.ts. */
const BEFORE = '/404.html';
/** A command body the idle prefetch asks for (src/commands/system/date.run.ts). */
const CHUNK = /\/assets\/date\.run-[\w-]+\.js$/;
/** The build's entry chunk, whose URL names the build (src/main.ts). */
const ENTRY = /\/assets\/index-[\w-]+\.js$/;

const prompt = (page: Page) => page.locator('input.command-input');
const log = (page: Page) => page.getByRole('log');

/** Problems the page reports, but not those of the requests a test fails on purpose. */
function watchErrors(page: Page, expected: RegExp[] = []): string[] {
  const errors: string[] = [];
  const wanted = (text: string, url = '') => expected.some((pattern) => pattern.test(url) || pattern.test(text));
  page.on('console', (message) => {
    const url = message.location().url;
    if (message.type() === 'error' && !isBenignConsoleMessage(message.text(), url) && !wanted(message.text(), url)) errors.push(message.text());
  });
  page.on('pageerror', (error) => {
    if (!isBenignPageError(error.message)) errors.push(error.message);
  });
  return errors;
}

/** vesen, with the kernel and completion loaded and the prompt focused. A first load may be slow. */
async function ready(page: Page): Promise<void> {
  await expect(page.locator('[data-completion="ready"]')).toHaveCount(1, { timeout: 15_000 });
  if (isPhone()) await prompt(page).tap();
  else await prompt(page).click();
}

/** Runs a line and waits until it has finished. */
async function run(page: Page, line: string): Promise<void> {
  const echoes = log(page).locator('.command-input-display');
  const before = await echoes.count();
  await prompt(page).fill(line);
  await prompt(page).press('Enter');
  await expect(echoes).toHaveCount(before + 1);
  await expect(log(page)).toHaveAttribute('aria-busy', 'false');
}

/** Marks this document, so a reload shows as the mark gone. */
const mark = (page: Page) => page.evaluate(() => void ((window as { vesenMark?: true }).vesenMark = true));
const marked = (page: Page) => page.evaluate(() => (window as { vesenMark?: true }).vesenMark === true);

/** The HEAD requests that ask whether the build is still there. */
function buildChecks(page: Page): Request[] {
  const checks: Request[] = [];
  page.on('request', (request) => {
    if (request.method() === 'HEAD' && ENTRY.test(new URL(request.url()).pathname)) checks.push(request);
  });
  return checks;
}

/** Answers a request as a server does for a file it does not have. */
const notFound = (route: Route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not Found' });

/** Requests held unanswered, so a load stays in flight until a test lets it end. */
class HeldRequests {
  private readonly routes: Route[] = [];
  private resolveAsked: () => void = () => {};
  /** Settles once the first request has arrived. */
  readonly asked = new Promise<void>((resolve) => {
    this.resolveAsked = resolve;
  });

  take(route: Route): void {
    this.routes.push(route);
    this.resolveAsked();
  }

  async release(answer: (route: Route) => Promise<void>): Promise<void> {
    for (const route of this.routes.splice(0)) await answer(route);
  }
}

test.describe('a chunk that fails to load', { tag: '@smoke' }, () => {
  test('Back while a chunk is loading leaves vesen for the page before it', async ({ page }) => {
    const errors = watchErrors(page);
    // The idle prefetch's request for one body is held, so it is still loading when Back starts.
    const chunk = new HeldRequests();
    await page.route(CHUNK, (route) => chunk.take(route));
    await page.goto(BEFORE);
    await page.goto('/');
    await ready(page);
    await chunk.asked;
    const documents: string[] = [];
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) documents.push(new URL(frame.url()).pathname);
    });

    await page.evaluate(() => void setTimeout(() => history.back(), 0));
    await expect(page).toHaveURL(/\/404\.html$/, { timeout: 15_000 });
    await expect(page.getByText('No such file or directory')).toBeVisible();
    // Straight there: vesen never loaded again on the way.
    expect(documents).toEqual(['/404.html']);
    // Nor did it set out to: its build's one reload is unspent. A reload that starts as Back
    // begins races Back itself, and in WebKit wins about half the time, so its claim is the
    // sure sign.
    expect(await page.evaluate(() => sessionStorage.getItem('vesen:chunk-reload:v1'))).toBeNull();
    expect(errors).toEqual([]);
  });

  test('a chunk that fails while the build is still there leaves the page as it is', async ({ page }) => {
    const errors = watchErrors(page, [CHUNK]);
    await page.route(CHUNK, (route) => route.abort('failed'));
    const checks = buildChecks(page);
    await page.goto('/');
    await ready(page);
    await mark(page);

    await run(page, 'date');
    const entry = log(page).locator('.entry').last();
    await expect(entry).toContainText('date: could not load the command. Check the connection and try again.');
    // The tab asked, and the server still has the build.
    await expect.poll(() => checks.length).toBeGreaterThan(0);
    expect((await checks[0]?.response())?.status()).toBe(200);
    // A line run after the answer is in: by then a reload would have happened.
    await run(page, 'echo still here');
    await expect(log(page).locator('.entry').last()).toContainText('still here');
    expect(await marked(page)).toBe(true);
    await expect(log(page)).not.toContainText('vesen was updated');
    expect(errors).toEqual([]);
  });

  test('after a deploy the tab says so and reloads, once', async ({ page }) => {
    const errors = watchErrors(page, [CHUNK, ENTRY]);
    // The deploy takes this build away while it runs: from then on its chunks are 404s, and so
    // is its entry chunk when the tab asks after it (the page itself loaded it before).
    let deployed = false;
    const chunk = new HeldRequests();
    await page.route(CHUNK, (route) => (deployed ? notFound(route) : chunk.take(route)));
    await page.route(ENTRY, (route) => (deployed && route.request().method() === 'HEAD' ? notFound(route) : route.continue()));
    const checks = buildChecks(page);
    let loads = 0;
    page.on('load', () => (loads += 1));
    await page.goto('/');
    await ready(page);
    await chunk.asked;
    await mark(page);
    const reloaded = page.waitForEvent('load');

    deployed = true;
    await chunk.release(notFound);
    await reloaded;
    expect(await marked(page)).toBe(false);
    expect((await checks[0]?.response())?.status()).toBe(404);
    expect(await page.evaluate(() => sessionStorage.getItem('vesen:chunk-reload:v1'))).toMatch(ENTRY);

    // The same build in the same tab, whose chunks still fail: it has reloaded once already, so
    // the failure is the command's alone.
    await ready(page);
    await mark(page);
    await run(page, 'date');
    await expect(log(page).locator('.entry').last()).toContainText('date: could not load the command.');
    await expect.poll(() => checks.length).toBeGreaterThan(1);
    expect((await checks.at(-1)?.response())?.status()).toBe(404);
    await run(page, 'echo still here');
    expect(await marked(page)).toBe(true);
    expect(loads).toBe(2);
    await expect(log(page)).not.toContainText('vesen was updated');
    expect(errors).toEqual([]);
  });
});
