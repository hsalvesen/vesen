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
});
