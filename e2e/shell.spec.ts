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

/**
 * Holds `curl https://slow.example/` until released, then answers with some lines of text: a
 * command whose output lands a while after Enter. `hold` starts holding the next request.
 */
async function slowCurl(page: Page): Promise<{ hold(): void; release(): void; line: string }> {
  let release = () => {};
  let held = Promise.resolve();
  await page.route('https://slow.example/**', async (route) => {
    await held;
    const body = Array.from({ length: 40 }, (_, i) => `line ${i + 1} of a slow answer`).join('\n');
    await route
      .fulfill({ status: 200, contentType: 'text/plain', headers: { 'access-control-allow-origin': '*' }, body })
      .catch(() => {});
  });
  return {
    hold: () => {
      held = new Promise<void>((resolve) => (release = resolve));
    },
    release: () => release(),
    line: 'curl https://slow.example/',
  };
}

/**
 * Scrolls the transcript to the top as a visitor does, with a wheel turn and the scroll it makes.
 * The input matters: a scroll with none, in the frame new output arrives, is taken as the
 * engine's own (ui/actions/stickToBottom.ts).
 */
async function scrollToTop(page: Page): Promise<void> {
  await page.locator('main').evaluate((main) => {
    main.dispatchEvent(new WheelEvent('wheel', { deltaY: -main.scrollHeight, bubbles: true }));
    main.scrollTop = 0;
  });
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

  for (const width of [800, 1000, 1180]) {
    test(`at ${width}px help shows every column of commands`, async ({ page }) => {
      test.skip(isPhone(), 'desktop and tablet widths');
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/');
      await run(page, 'help');
      const grids = await page.locator('[role="log"] .output').last().evaluate((output) => {
        const main = document.querySelector('main') as HTMLElement;
        const edge = main.getBoundingClientRect().left + main.clientWidth - parseFloat(getComputedStyle(main).paddingRight);
        return Array.from(output.querySelectorAll<HTMLElement>('.grid'), (grid) => {
          const cells = Array.from(grid.querySelectorAll<HTMLElement>('.cell'));
          const lefts = new Set(cells.map((cell) => Math.round(cell.getBoundingClientRect().left)));
          return {
            text: grid.textContent ?? '',
            columns: lefts.size,
            // The rightmost cell's right edge, against the transcript's content edge.
            right: Math.max(...cells.map((cell) => cell.getBoundingClientRect().right)),
            edge,
            scrolls: grid.scrollWidth - grid.clientWidth,
          };
        });
      });
      expect(grids.map((grid) => grid.text).join(' ')).toContain('whoami');
      for (const grid of grids) {
        expect(grid.right, 'the last column is cut off').toBeLessThanOrEqual(grid.edge + 1);
        expect(grid.scrolls, 'the grid has to be scrolled').toBeLessThanOrEqual(0);
      }
      // Wide enough for more than one column of names and summaries.
      expect(Math.max(...grids.map((grid) => grid.columns))).toBeGreaterThanOrEqual(2);
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

    await page.locator('.prompt-area .prompt').first().tap();
    await expect(prompt(page)).toBeFocused();

    // A command keeps the keyboard open when it was open at submit.
    await prompt(page).fill('help');
    await prompt(page).press('Enter');
    await expect(page.locator('main')).toContainText('fastfetch');
    await expect(prompt(page)).toBeFocused();

    // With the keyboard put away, output stays something to read. (A tapped command name is
    // different: it goes to the prompt to be finished, so it opens the keyboard.)
    await prompt(page).evaluate((input) => input.blur());
    await page.locator('main').getByText('Portfolio', { exact: true }).first().tap();
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

  test('on touch, output that arrives after the transcript overflows is followed or anchored', async ({ page }) => {
    test.skip(!isPhone(), 'phones only');
    await page.goto('/');
    await focusPrompt(page);
    const overflows = () => page.locator('main').evaluate((main) => main.scrollHeight > main.clientHeight);
    for (const line of ['help', 'ls -a', 'theme ls', 'cathode ls', 'history']) {
      await run(page, line);
      if (await overflows()) break;
    }
    expect(await overflows(), 'the transcript scrolls').toBe(true);

    // Each output lands together with the running line and the cancel button going away. Typed
    // at a person's pace, as on a phone.
    for (const line of ['cat README.md', 'cat history.txt']) {
      const echoes = page.locator('[role="log"] .command-input-display');
      const before = await echoes.count();
      await prompt(page).pressSequentially(line, { delay: 40 });
      await prompt(page).press('Enter');
      await expect(echoes).toHaveCount(before + 1);
      await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');

      const view = () =>
        page.evaluate(() => {
          const main = document.querySelector('main') as HTMLElement;
          const all = document.querySelectorAll('[role="log"] .command-input-display');
          const echo = all[all.length - 1] as HTMLElement;
          return {
            echo: echo.getBoundingClientRect().top - main.getBoundingClientRect().top,
            toEnd: main.scrollHeight - main.scrollTop - main.clientHeight,
            pill: document.querySelector('.new-output') !== null,
          };
        });
      // Either the whole output shows, down to the prompt, or a long one shows from its echo line.
      await expect
        .poll(async () => {
          const { echo, toEnd, pill } = await view();
          return !pill && echo >= 0 && (toEnd <= 1 || echo <= 24);
        }, { message: `${line}: ${JSON.stringify(await view())}` })
        .toBe(true);
    }
  });

  test('on touch, a keyboard put away while a command runs stays away', async ({ page }) => {
    test.skip(!isPhone(), 'phones only');
    await page.goto('/');
    await focusPrompt(page);

    // The answer is held until released.
    const { hold, release, line } = await slowCurl(page);

    // The visitor puts the keyboard away to read, and the command finishes.
    hold();
    await prompt(page).fill(line);
    await prompt(page).press('Enter');
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'true');
    await prompt(page).evaluate((input) => input.blur());
    release();
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
    await expect(prompt(page)).not.toBeFocused();

    // Or the visitor taps the cancel line after putting the keyboard away.
    hold();
    await focusPrompt(page);
    await prompt(page).fill(line);
    await prompt(page).press('Enter');
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'true');
    await prompt(page).evaluate((input) => input.blur());
    await page.getByRole('button', { name: 'Cancel running command' }).tap();
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
    // Interrupted as in a terminal: ^C, and the prompt back at once.
    await expect(page.locator('[role="log"] .entry').last()).toContainText('^C');
    await expect(prompt(page)).not.toBeFocused();
    release();
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

  test('Escape then Tab leaves the terminal, so the keyboard is never trapped', async ({ page }) => {
    test.skip(isPhone(), 'desktop only');
    await page.clock.install();
    await page.goto('/');
    await expect(prompt(page)).toBeFocused();

    // Tab alone completes, and keeps focus in the prompt.
    await page.keyboard.type('he');
    await page.keyboard.press('Tab');
    await expect(prompt(page)).toHaveValue('help');
    await expect(prompt(page)).toBeFocused();

    // Tab leaves within a second of Escape. The clock stands still between the two presses, so a
    // slow test machine cannot stretch that second.
    await page.clock.pauseAt(Date.now() + 60_000);
    for (const key of ['Tab', 'Shift+Tab']) {
      await prompt(page).focus();
      await page.keyboard.press('Escape');
      await page.keyboard.press(key);
      await expect(prompt(page), key).not.toBeFocused();
    }
    await page.clock.resume();
  });
});

test.describe('keys on other controls', { tag: '@smoke' }, () => {
  test('Enter on the new-output pill scrolls, and runs nothing', async ({ page }) => {
    test.skip(isPhone(), 'a hardware keyboard');
    await page.goto('/');
    await fillTranscript(page);

    const slow = await slowCurl(page);
    slow.hold();
    await prompt(page).fill(slow.line);
    await prompt(page).press('Enter');
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'true');
    // A line typed ahead, which Enter on the pill must not run. Typing brings the view down, so
    // it comes before scrolling up.
    await prompt(page).fill('echo typed');
    await scrollToTop(page);
    slow.release();
    const pill = page.getByRole('button', { name: 'Scroll to new output' });
    await expect(pill).toBeVisible();

    const entries = await page.locator('[role="log"] .command-input-display').count();
    await pill.focus();
    await page.keyboard.press('Enter');
    await expect(pill).toBeHidden();
    await expect(page.locator('[role="log"] .command-input-display')).toHaveCount(entries);
    await expect(prompt(page)).toHaveValue('echo typed');
  });

  test('Enter on the cancel button cancels the running command', async ({ page }) => {
    test.skip(isPhone(), 'a hardware keyboard');
    await page.goto('/');
    await page.route('https://slow.example/**', () => new Promise(() => {}));
    await prompt(page).fill('curl https://slow.example/');
    await prompt(page).press('Enter');
    const cancel = page.getByRole('button', { name: 'Cancel running command' });
    await cancel.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('[role="log"] .entry').last()).toContainText('^C');
  });
});

test.describe('scrolling', { tag: '@smoke' }, () => {
  test('output that arrives while scrolled up offers a pill that goes to the bottom', async ({ page }) => {
    await page.goto('/');
    await focusPrompt(page);
    await fillTranscript(page);

    // Hold the answer while the visitor scrolls up.
    const slow = await slowCurl(page);
    slow.hold();
    await prompt(page).fill(slow.line);
    await prompt(page).press('Enter');
    await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'true');

    const main = page.locator('main');
    await scrollToTop(page);
    slow.release();
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
