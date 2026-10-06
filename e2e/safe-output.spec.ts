import { expect, test, type Page } from '@playwright/test';
import { xssCorpus } from '../tests/support/xss';

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
          if (name === 'style' && /url\(|expression/i.test(value)) found.push(`style=${value}`);
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

  test("the browser's own parser cannot smuggle markup past the legacy sanitiser", async ({ page }) => {
    // README.md is one of the owner's styled documents, so cat renders it as HTML through the
    // sanitiser. Serving the corpus in its place runs every payload through the real parser.
    await page.route('**/README.md', (route) =>
      route.fulfill({ contentType: 'text/markdown', body: xssCorpus('alert(1)').join('\n') }),
    );
    const dialogs = watchDialogs(page);
    await page.goto('/');

    await run(page, 'cat README.md');
    await expect(page.getByRole('log')).toContainText('ok');
    await page.waitForTimeout(500);

    expect(dialogs).toEqual([]);
    expect(await planted(page)).toEqual([]);
    // The safe link in the corpus survives, opening in a new tab without an opener.
    const link = page.locator('main a[href="https://ok.example/"]');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
});
