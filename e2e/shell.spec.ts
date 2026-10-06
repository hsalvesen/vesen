import { expect, test, type Page } from '@playwright/test';

// The app shell, viewport, focus and scroll (docs/plan/04, slice "App shell, viewport, focus and
// scroll").

const PHONES = ['iphone-instagram', 'pixel-7'];
const isPhone = () => PHONES.includes(test.info().project.name);

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

/** Enough output that the transcript scrolls. */
async function fillTranscript(page: Page): Promise<void> {
  for (const line of ['help', 'ls -a', 'cat documents/linux.txt']) await run(page, line);
  const overflows = await page.locator('main').evaluate((main) => main.scrollHeight > main.clientHeight + 100);
  expect(overflows, 'the transcript scrolls').toBe(true);
}

declare global {
  interface Window {
    /** Moves the stand-in visualViewport installed by fakeVisualViewport. */
    __vv?: { set(next: { height?: number; offsetTop?: number }): void };
  }
}

/** Replaces window.visualViewport, before the app starts, with one the test moves by hand. */
async function fakeVisualViewport(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const events = new EventTarget();
    let height: number | null = null;
    let offsetTop = 0;
    const visual = {
      get height() {
        return height ?? window.innerHeight;
      },
      get width() {
        return window.innerWidth;
      },
      get offsetTop() {
        return offsetTop;
      },
      get pageTop() {
        return offsetTop;
      },
      offsetLeft: 0,
      pageLeft: 0,
      scale: 1,
      addEventListener: events.addEventListener.bind(events),
      removeEventListener: events.removeEventListener.bind(events),
      dispatchEvent: events.dispatchEvent.bind(events),
    };
    Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => visual });
    window.__vv = {
      set(next) {
        if (next.height !== undefined) height = next.height;
        if (next.offsetTop !== undefined) offsetTop = next.offsetTop;
        events.dispatchEvent(new Event('resize'));
      },
    };
  });
}

/** The prompt's input, top and bottom, in viewport coordinates. */
const promptBox = (page: Page) =>
  prompt(page).evaluate((input) => {
    const { top, bottom } = input.getBoundingClientRect();
    return { top, bottom };
  });

async function focusPrompt(page: Page): Promise<void> {
  if (isPhone()) await prompt(page).tap();
  else await prompt(page).click();
  await expect(prompt(page)).toBeFocused();
}

test.describe('the app shell', { tag: '@smoke' }, () => {
  for (const width of [320, 375]) {
    test(`at ${width}px nothing scrolls sideways after help, ls -a, fastfetch, history and theme ls`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await page.goto('/');
      for (const line of ['help', 'ls -a', 'fastfetch', 'history', 'theme ls']) {
        await run(page, line);
        const overflow = await page.evaluate(() => {
          const main = document.querySelector('main');
          const app = document.getElementById('app');
          return {
            page: document.documentElement.scrollWidth - window.innerWidth,
            body: document.body.scrollWidth - window.innerWidth,
            app: (app?.getBoundingClientRect().right ?? Infinity) - window.innerWidth,
            // Nothing is wider than the transcript, so nothing is cut off at its edge either.
            transcript: main ? main.scrollWidth - main.clientWidth : Infinity,
          };
        });
        expect(overflow.page, `${line}: the page scrolls sideways`).toBeLessThanOrEqual(0);
        expect(overflow.body, `${line}: the body scrolls sideways`).toBeLessThanOrEqual(0);
        expect(overflow.app, `${line}: the app is wider than the screen`).toBeLessThanOrEqual(0);
        expect(overflow.transcript, `${line}: output is wider than the transcript`).toBeLessThanOrEqual(0);
      }
    });
  }

  test('phones are edge to edge; the desktop keeps its frame', async ({ page }) => {
    await page.goto('/');
    const frame = await page.locator('.screen-frame').evaluate((element) => {
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: window.innerWidth - box.right,
        radius: style.borderTopLeftRadius,
        borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
      };
    });
    if (isPhone()) {
      expect(frame).toEqual({ left: 0, right: 0, radius: '0px', borders: ['1px', '0px', '0px', '0px'] });
    } else {
      expect(frame).toEqual({ left: 16, right: 16, radius: '6px', borders: ['2px', '2px', '2px', '2px'] });
    }
  });

  test('the page itself never scrolls; the transcript does', async ({ page }) => {
    await page.goto('/');
    await fillTranscript(page);
    const styles = await page.evaluate(() => ({
      html: getComputedStyle(document.documentElement).overflow,
      body: getComputedStyle(document.body).overflow,
      app: getComputedStyle(document.getElementById('app') as HTMLElement).position,
      main: getComputedStyle(document.querySelector('main') as HTMLElement).overscrollBehaviorY,
      pageScroll: document.documentElement.scrollHeight - window.innerHeight,
    }));
    expect(styles).toEqual({ html: 'hidden', body: 'hidden', app: 'fixed', main: 'contain', pageScroll: 0 });
  });

  test('the CRT overlay covers the screen frame only', async ({ page }) => {
    await page.goto('/');
    const boxes = await page.evaluate(() => {
      const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect().toJSON() as DOMRect;
      const overlay = document.querySelector('.crt-overlay');
      return {
        parent: overlay?.parentElement?.className,
        position: overlay ? getComputedStyle(overlay).position : null,
        overlay: box('.crt-overlay'),
        frame: box('.screen-frame'),
        dock: box('.dock-slot'),
      };
    });
    expect(boxes.parent).toBe('screen-frame');
    expect(boxes.position).toBe('absolute');
    expect(boxes.overlay.top).toBeGreaterThanOrEqual(boxes.frame.top);
    expect(boxes.overlay.bottom).toBeLessThanOrEqual(boxes.frame.bottom);
    expect(boxes.overlay.left).toBeGreaterThanOrEqual(boxes.frame.left);
    expect(boxes.overlay.right).toBeLessThanOrEqual(boxes.frame.right);
    // The dock slot comes after the screen, outside the overlay.
    expect(boxes.dock.top).toBeGreaterThanOrEqual(boxes.overlay.bottom);
  });
});

test.describe('the visible viewport', { tag: '@smoke' }, () => {
  test('the prompt stays in view when a keyboard shrinks the visual viewport', async ({ page }) => {
    await fakeVisualViewport(page);
    await page.goto('/');
    await fillTranscript(page);
    await focusPrompt(page);

    const full = await page.evaluate(() => window.innerHeight);
    const visible = Math.round(full * 0.45);
    await page.evaluate((height) => window.__vv?.set({ height }), visible);

    const root = () =>
      page.evaluate(() => ({
        height: getComputedStyle(document.documentElement).getPropertyValue('--app-h'),
        keyboard: document.documentElement.classList.contains('kb-open'),
      }));
    // Only a touch screen has a soft keyboard; on the desktop this is a shorter window.
    await expect.poll(root).toEqual({ height: `${visible}px`, keyboard: isPhone() });
    await expect.poll(async () => (await promptBox(page)).bottom).toBeLessThanOrEqual(visible);
    expect((await promptBox(page)).top).toBeGreaterThanOrEqual(0);

    // iOS pans the page up to the input: the shell moves with the visible area.
    await page.evaluate(() => window.__vv?.set({ offsetTop: 120 }));
    await expect.poll(async () => (await promptBox(page)).bottom).toBeLessThanOrEqual(120 + visible);
    expect((await promptBox(page)).top).toBeGreaterThanOrEqual(120);

    // The keyboard closes: back to the whole screen.
    await prompt(page).evaluate((input) => input.blur());
    await page.evaluate((height) => window.__vv?.set({ height, offsetTop: 0 }), full);
    await expect.poll(root).toEqual({ height: `${full}px`, keyboard: false });
  });

  test('the prompt stays in view when the layout viewport shrinks too', async ({ page }) => {
    test.skip(test.info().project.name !== 'iphone-instagram', 'resizes the WebKit page');
    await page.goto('/');
    await fillTranscript(page);
    await focusPrompt(page);

    const { width } = page.viewportSize() ?? { width: 390 };
    await page.setViewportSize({ width, height: 300 });
    await expect.poll(async () => (await promptBox(page)).bottom).toBeLessThanOrEqual(300);
    expect((await promptBox(page)).top).toBeGreaterThanOrEqual(0);
  });
});

test.describe('focus', { tag: '@smoke' }, () => {
  test('on touch, tapping output never opens the keyboard; tapping the prompt row does', async ({ page }) => {
    test.skip(test.info().project.name !== 'iphone-instagram', 'Instagram on an iPhone');
    await page.goto('/');
    const banner = page.getByText('to see all available commands.');
    await expect(banner).toBeVisible();
    // No keyboard over the page on arrival.
    await expect(prompt(page)).not.toBeFocused();

    await banner.tap();
    await expect(prompt(page)).not.toBeFocused();

    await page.locator('.prompt-area span.font-bold').first().tap();
    await expect(prompt(page)).toBeFocused();

    // A command keeps the keyboard open when it was open at submit.
    await prompt(page).fill('help');
    await prompt(page).press('Enter');
    await expect(page.locator('main')).toContainText('fastfetch');
    await expect(prompt(page)).toBeFocused();

    // With the keyboard put away, output stays something to read.
    await prompt(page).evaluate((input) => input.blur());
    await page.locator('main').getByText('fastfetch').first().tap();
    await expect(prompt(page)).not.toBeFocused();
  });

  test('on touch, a long output is shown from its first line', async ({ page }) => {
    test.skip(!isPhone(), 'phones only');
    await page.goto('/');
    await focusPrompt(page);
    await run(page, 'cat documents/linux.txt');

    const offset = await page.evaluate(() => {
      const main = document.querySelector('main') as HTMLElement;
      const echoes = document.querySelectorAll('[role="log"] .command-input-display');
      const echo = echoes[echoes.length - 1] as HTMLElement;
      return echo.getBoundingClientRect().top - main.getBoundingClientRect().top;
    });
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThanOrEqual(24);
  });

  test('a mouse click on empty space focuses the prompt without scrolling', async ({ page }) => {
    test.skip(isPhone(), 'desktop only');
    await page.goto('/');
    await expect(prompt(page)).toBeFocused();
    await fillTranscript(page);

    const main = page.locator('main');
    await main.evaluate((element) => {
      element.scrollTop = 0;
    });
    await prompt(page).evaluate((input) => input.blur());
    const box = await main.boundingBox();
    if (!box) throw new Error('no transcript');
    await page.mouse.click(box.x + box.width - 40, box.y + 40);

    await expect(prompt(page)).toBeFocused();
    expect(await main.evaluate((element) => element.scrollTop)).toBe(0);
  });

  test('a double click selects a word and leaves the prompt alone', async ({ page }) => {
    test.skip(isPhone(), 'desktop only');
    await page.goto('/');
    await prompt(page).evaluate((input) => input.blur());
    await page.getByText('to see all available commands.').dblclick();

    expect(await page.evaluate(() => window.getSelection()?.toString().trim())).not.toBe('');
    await expect(prompt(page)).not.toBeFocused();
  });

  test('a key typed with nothing focused goes to the prompt', async ({ page }) => {
    test.skip(isPhone(), 'desktop only');
    await page.goto('/');
    await prompt(page).evaluate((input) => input.blur());
    await page.keyboard.type('ls');
    await expect(prompt(page)).toBeFocused();
    await expect(prompt(page)).toHaveValue('ls');
  });
});

test.describe('scrolling', { tag: '@smoke' }, () => {
  test('output that arrives while scrolled up offers a pill that goes to the bottom', async ({ page }) => {
    await page.goto('/');
    await focusPrompt(page);
    await fillTranscript(page);

    // cat fetches the file; hold the response while the visitor scrolls up.
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/history.txt', async (route) => {
      await held;
      await route.continue();
    });
    await prompt(page).fill('cat history.txt');
    await prompt(page).press('Enter');
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'true');

    const main = page.locator('main');
    await main.evaluate((element) => {
      element.scrollTop = 0;
    });
    release();
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');

    const pill = page.getByRole('button', { name: 'Scroll to new output' });
    await expect(pill).toBeVisible();
    expect(await main.evaluate((element) => element.scrollTop)).toBe(0);

    if (isPhone()) await pill.tap();
    else await pill.click();
    await expect(pill).toBeHidden();
    await expect
      .poll(() => main.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight))
      .toBeLessThanOrEqual(1);
    await expect(prompt(page)).toBeFocused();
  });
});
