import { expect, test, type Page } from '@playwright/test';
import { OVERLAY_PAYLOADS, xssCorpus } from '../tests/support/xss';

// Served without the production CSP on purpose: the CSP would block inline handlers by itself,
// and these tests are about the renderer never creating them.
test.describe('safe output', { tag: '@smoke' }, () => {
  test.beforeEach(() => {
    test.skip(test.info().project.name === 'pixel-7', 'desktop Chrome and iPhone Instagram cover this');
  });

  /** Types a line, runs it, and waits for its transcript entry. */
  async function run(page: Page, line: string): Promise<void> {
    const prompt = page.getByRole('textbox', { name: 'Terminal command' });
    await prompt.fill(line);
    await prompt.press('Enter');
    await expect(page.locator('.command-input-display').last()).toHaveText(line);
  }

  test('cat shows source code with its angle brackets', async ({ page }) => {
    await page.goto('/');
    await run(page, 'cat /home/user/src/main.c');
    const log = page.getByRole('log');
    await expect(log).toContainText('#include <stdio.h>');
    await expect(log).toContainText('printf("Hello, World!\\n");');
  });

  /** Collects dialogs, which any payload that runs would open. */
  function watchDialogs(page: Page): string[] {
    const dialogs: string[] = [];
    page.on('dialog', async (dialog) => {
      dialogs.push(dialog.message());
      await dialog.dismiss();
    });
    return dialogs;
  }

  /** Active elements and event-handler attributes anywhere in the terminal. */
  async function planted(page: Page): Promise<string[]> {
    return page.evaluate(() => {
      const main = document.querySelector('main');
      if (!main) return ['no main'];
      const found = Array.from(
        main.querySelectorAll('img, svg, math, iframe, script, object, embed, style, form, input:not(.command-input), template'),
        (el) => el.localName,
      );
      for (const element of Array.from(main.querySelectorAll('*'))) {
        for (const { name, value } of Array.from(element.attributes)) {
          if (name.startsWith('on')) found.push(name);
          if (name === 'href' && !/^(?:https?|mailto):/i.test(value)) found.push(`href=${value}`);
          if (name === 'style' && /url\(|expression|position\s*:|inset\s*:/i.test(value)) found.push(`style=${value}`);
        }
      }
      return found;
    });
  }

  test('XSS payloads typed at the prompt open no dialog and plant nothing', async ({ page }) => {
    const dialogs = watchDialogs(page);
    await page.goto('/');

    // A spread of the corpus through echo, quoted echo, and as an unknown command, whose error
    // repeats it; the unit tests run all of it.
    const payloads = xssCorpus('alert(1)').filter((_, i) => i % 4 === 0);
    const lines = [
      ...payloads.map((payload, i) => (i % 3 === 0 ? `echo ${payload}` : i % 3 === 1 ? `echo "${payload}"` : payload)),
      'echo <img src=x onerror=alert(1) > planted.html',
      'echo > >> planted.html',
      'cat planted.html',
      'touch <b>planted',
      'ls',
      'history',
    ];
    for (const line of lines) await run(page, line);

    const log = page.getByRole('log');
    await expect(log).toContainText('<img src=x onerror=alert(1)');
    await expect(log).toContainText('<b>planted');
    // Time for any image error or load handler that slipped through to fire.
    await page.waitForTimeout(500);

    expect(dialogs).toEqual([]);
    expect(await planted(page)).toEqual([]);
  });

  /**
   * Puts text in ~/README.md before the page loads, as a saved file would arrive: the overlay
   * under vesen:fs:v1 is the visitor's own browser storage, which anything could have written.
   */
  async function saveReadme(page: Page, content: string): Promise<void> {
    const saved = {
      v: 1,
      seedVersion: 'planted',
      savedAt: 0,
      overlay: { '/home/guest/README.md': { type: 'file', mode: 0o644, mtime: 0, content } },
    };
    await page.addInitScript((value) => localStorage.setItem('vesen:fs:v1', value), JSON.stringify(saved));
  }

  test('a saved file full of payloads prints as text, which the browser never parses as markup', async ({ page }) => {
    // The owner's documents were HTML once; every file is now text, written into text nodes.
    await saveReadme(page, xssCorpus('alert(1)').join('\n'));
    const dialogs = watchDialogs(page);
    await page.goto('/');

    await run(page, 'cat README.md');
    const log = page.getByRole('log');
    await expect(log).toContainText('<img src=x onerror=alert(1)');
    await expect(log).toContainText('ok');
    await page.waitForTimeout(500);

    expect(dialogs).toEqual([]);
    expect(await planted(page)).toEqual([]);
    // Not even the safe link in the corpus becomes one.
    await expect(page.locator('main a[href="https://ok.example/"]')).toHaveCount(0);
  });

  test('no output can lay a link over the prompt', async ({ page }) => {
    await saveReadme(page, `before\n${OVERLAY_PAYLOADS.join('\n')}\nafter`);
    await page.goto('/');
    await run(page, 'cat README.md');
    const log = page.getByRole('log');
    await expect(log).toContainText('after');
    await expect(page.locator('main a[href="https://evil.example/"]')).toHaveCount(0);
    expect(await planted(page)).toEqual([]);

    // A tap anywhere on the prompt still reaches the input.
    const hit = await page.getByRole('textbox', { name: 'Terminal command' }).evaluate((input) => {
      input.scrollIntoView({ block: 'nearest' });
      const box = input.getBoundingClientRect();
      const points = [0.1, 0.5, 0.9].map((x) => [box.left + box.width * x, box.top + box.height / 2] as const);
      return points.map(([x, y]) => {
        const element = document.elementFromPoint(x, y);
        return element === input ? 'input' : (element?.closest('a')?.getAttribute('href') ?? element?.localName ?? null);
      });
    });
    expect(hit).toEqual(['input', 'input', 'input']);
  });
});
