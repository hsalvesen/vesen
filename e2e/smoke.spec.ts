import { expect, test } from '@playwright/test';

test.describe('smoke', { tag: '@smoke' }, () => {
  test('boots, runs help, fits the viewport and logs no errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    page.on('pageerror', (error) => errors.push(error.message));

    await page.goto('/');

    // The banner greets every visitor with how to get started.
    await expect(page.getByText('to see all available commands.')).toBeVisible();

    const prompt = page.locator('input.command-input');
    await prompt.click();
    await prompt.fill('help');
    await prompt.press('Enter');

    // help lists the commands, including ones the banner never mentions.
    const transcript = page.locator('main');
    await expect(transcript).toContainText('fastfetch');
    await expect(transcript).toContainText('theme');
    await expect(prompt).toHaveValue('');

    const overflow = await page.evaluate(() => {
      const root = document.scrollingElement ?? document.documentElement;
      return root.scrollWidth - window.innerWidth;
    });
    expect(overflow, 'page scrolls horizontally').toBeLessThanOrEqual(0);

    expect(errors).toEqual([]);
  });

  test('a hung request is cancelled from the processing line, and the prompt stays usable', async ({ page, hasTouch }) => {
    // The stock proxy accepts the request and never answers.
    await page.route('https://api.allorigins.win/**', () => {});
    await page.goto('/');

    const prompt = page.locator('input.command-input');
    await prompt.click();
    await prompt.fill('stock AAPL');
    await prompt.press('Enter');

    const cancel = page.getByRole('button', { name: 'Cancel running command' });
    await expect(cancel).toBeVisible();
    await expect(prompt).toBeEnabled();
    // Phones tap. A mouse click would hide a tap that WebKit drops before it becomes a click.
    if (hasTouch) await cancel.tap();
    else await cancel.click();

    await expect(page.getByText('Stock request cancelled')).toBeVisible();
    await expect(cancel).toBeHidden();
    await expect(prompt).toBeFocused();
  });

  test('type-ahead stays visible under a long running command', async ({ page }) => {
    // httpbin accepts the request and never answers, so curl keeps running.
    await page.route('https://httpbin.org/**', () => {});
    await page.goto('/');

    const prompt = page.locator('input.command-input');
    await prompt.click();
    await prompt.fill('curl https://httpbin.org/get');
    await prompt.press('Enter');
    await expect(page.getByRole('button', { name: 'Cancel running command' })).toBeVisible();

    await prompt.pressSequentially('ls -a');
    await expect(prompt).toHaveValue('ls -a');
    // The input wraps under the running line rather than shrinking to nothing: it keeps at
    // least 8ch, which is more than four ems in a monospace font. Ems of the terminal's size: on
    // touch the input itself is 16px, drawn scaled down to that size.
    const width = (await prompt.boundingBox())?.width ?? 0;
    const fourEms = await prompt.evaluate((input) => 4 * parseFloat(getComputedStyle(input.parentElement ?? input).fontSize));
    expect(width, 'type-ahead input width in px').toBeGreaterThanOrEqual(fourEms);
  });
});
