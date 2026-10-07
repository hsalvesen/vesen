import { defineConfig, devices } from '@playwright/test';

// PW_PORT lets parallel checkouts run e2e suites side by side.
const PORT = Number(process.env.PW_PORT ?? 4173);
const CI = Boolean(process.env.CI);

// Instagram's in-app browser on iOS: WKWebView with the app's token appended to the UA,
// and a shorter viewport because the app's own toolbars take space top and bottom.
const INSTAGRAM_IOS_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
  'Mobile/15E148 Instagram 300.0.0.0.0 (iPhone14,5; iOS 17_5; en_US; en; scale=3.00; 1170x2532; 0)';

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 1 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-chrome',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
    {
      name: 'iphone-instagram',
      use: {
        ...devices['iPhone 13'],
        browserName: 'webkit',
        viewport: { width: 390, height: 664 },
        hasTouch: true,
        userAgent: INSTAGRAM_IOS_UA,
      },
    },
    {
      name: 'pixel-7',
      use: { ...devices['Pixel 7'] },
    },
  ],
  // Tests run against the production build, served the way Firebase serves it.
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 120_000,
  },
});
