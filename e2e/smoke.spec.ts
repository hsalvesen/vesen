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

  test('a hung request is cancelled from the processing line, and the prompt stays usable', async ({ page }) => {
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
    await cancel.click();

    await expect(page.getByText('Stock request cancelled')).toBeVisible();
    await expect(cancel).toBeHidden();
    await expect(prompt).toBeFocused();
  });
});
