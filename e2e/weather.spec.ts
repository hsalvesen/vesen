import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { isBenignConsoleMessage } from './console';

// The weather card (docs/plan/05-weather.md, "Acceptance checks"; F060, F026, F016, F005): a
// curated place with no place search, the layout the card's own width picks, switched again on
// rotation without running anything, no sideways scroll, a unit chip that runs again, and
// hostile input printed as text. Every request is answered from tests/fixtures/weather.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'weather');
const body = (name: string): string => readFileSync(join(FIXTURES, name), 'utf8');

/** Days start on the day the fixtures were recorded, as they would have then. */
const RECORDED = new Date('2026-10-06T03:20:00Z');

test.use({ locale: 'en-AU' });

/** The weather hosts, answered from the fixtures; what each was asked. */
async function weatherNetwork(page: Page): Promise<{ forecasts: string[]; searches: string[] }> {
  const forecasts: string[] = [];
  const searches: string[] = [];
  await page.route('https://api.open-meteo.com/**', (route) => {
    forecasts.push(route.request().url());
    return route.fulfill({ contentType: 'application/json', body: body('forecast-sydney.json'), headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('https://geocoding-api.open-meteo.com/**', (route) => {
    searches.push(route.request().url());
    return route.fulfill({ contentType: 'application/json', body: body('geocode-gadigal.json'), headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('https://nominatim.openstreetmap.org/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/reverse') {
      return route.fulfill({ contentType: 'application/json', body: body('nominatim-reverse-sydney.json'), headers: { 'access-control-allow-origin': '*' } });
    }
    searches.push(url.href);
    return route.fulfill({ contentType: 'application/json', body: '[]', headers: { 'access-control-allow-origin': '*' } });
  });
  await page.route('https://get.geojs.io/**', (route) =>
    route.fulfill({ contentType: 'application/json', body: body('geojs.json'), headers: { 'access-control-allow-origin': '*' } }),
  );
  await page.clock.setFixedTime(RECORDED);
  return { forecasts, searches };
}

const prompt = (page: Page) => page.getByRole('combobox', { name: 'Terminal command' });

/** Loads the page and waits until the card's chunk has been fetched, as it is once the page is idle. */
async function loadIdle(page: Page): Promise<void> {
  const card = page.waitForResponse((response) => /\/assets\/WeatherCard-[\w-]+\.js$/.test(response.url()));
  await page.goto('/');
  await card;
}

/** Runs a line at the prompt and waits until it has finished. */
async function run(page: Page, line: string): Promise<void> {
  const echoes = page.locator('[role="log"] .command-input-display');
  const before = await echoes.count();
  await prompt(page).fill(line);
  await prompt(page).press('Enter');
  await expect(echoes).toHaveCount(before + 1);
  await expect(page.getByRole('log')).toHaveAttribute('aria-busy', 'false');
}

/** How far the page, and the transcript, are wider than the screen. */
const sideways = (page: Page) =>
  page.evaluate(() => {
    const main = document.querySelector('main');
    return Math.max(0, document.documentElement.scrollWidth - window.innerWidth, main ? main.scrollWidth - main.clientWidth : 0);
  });

const ONLY = ['desktop-chrome', 'iphone-instagram'];

test.describe('weather', () => {
  test.beforeEach(() => {
    test.skip(!ONLY.includes(test.info().project.name), 'desktop Chrome and Instagram on an iPhone');
  });

  for (const width of [320, 375, 1280]) {
    test(`weather Gadigal at ${width} px: no place search, the layout that fits, no sideways scroll`, async ({ page }) => {
      const errors: string[] = [];
      page.on('console', (message) => {
        if (message.type() === 'error' && !isBenignConsoleMessage(message.text())) errors.push(message.text());
      });
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setViewportSize({ width, height: width > 800 ? 800 : 700 });
      const network = await weatherNetwork(page);
      await loadIdle(page);
      await run(page, 'weather Gadigal');

      const card = page.locator('[data-weather-card]').last();
      await expect(card).toBeVisible();
      const shown = card.locator(width > 800 ? '.wx-wide' : '.wx-compact');
      const hidden = card.locator(width > 800 ? '.wx-compact' : '.wx-wide');
      await expect(shown).toBeVisible();
      await expect(hidden).toBeHidden();
      await expect(shown).toContainText('Gadigal Country · Sydney');
      await expect(shown).toContainText('Weather data by Open-Meteo.com');
      expect(network.searches).toEqual([]);
      expect(network.forecasts).toHaveLength(1);
      expect(await sideways(page)).toBe(0);
      // Screen readers hear the summary, not the art.
      await expect(card.locator('.sr-only')).toContainText('Weather for Gadigal Country · Sydney, New South Wales, Australia: Clear sky');
      expect(errors).toEqual([]);
    });
  }

  test('turning the screen lays the card out again, without running it again', async ({ page }) => {
    const network = await weatherNetwork(page);
    await page.setViewportSize({ width: 375, height: 700 });
    await page.goto('/');
    await run(page, 'weather Gadigal');
    const card = page.locator('[data-weather-card]').last();
    await expect(card.locator('.wx-compact')).toBeVisible();
    const entries = await page.locator('[role="log"] .entry').count();

    await page.setViewportSize({ width: 1024, height: 375 });
    await expect(card.locator('.wx-wide')).toBeVisible();
    await expect(card.locator('.wx-compact')).toBeHidden();
    await page.setViewportSize({ width: 375, height: 700 });
    await expect(card.locator('.wx-compact')).toBeVisible();
    expect(network.forecasts).toHaveLength(1);
    await expect(page.locator('[role="log"] .entry')).toHaveCount(entries);
    expect(await sideways(page)).toBe(0);
  });

  test('the °F chip runs the card again in imperial units', async ({ page }) => {
    await weatherNetwork(page);
    await page.goto('/');
    await run(page, 'weather Gadigal');
    const card = page.locator('[data-weather-card]').last();
    await expect(card).toContainText('24°C');

    const echoes = page.locator('[role="log"] .command-input-display');
    const before = await echoes.count();
    const chip = card.getByRole('button', { name: '°F' });
    if (test.info().project.use.hasTouch) await chip.tap();
    else await chip.click();
    await expect(echoes).toHaveCount(before + 1);
    await expect(echoes.last()).toHaveText('weather -u Gadigal Country');
    const imperial = page.locator('[data-weather-card]').last();
    await expect(imperial).toContainText('76°F');
    await expect(imperial.getByRole('button', { name: '°C' })).toBeVisible();
  });

  test('--here uses the device once allowed, rounded to about a kilometre', async ({ page, context }) => {
    await context.grantPermissions(['geolocation']);
    await context.setGeolocation({ latitude: -33.86882, longitude: 151.20929 });
    const network = await weatherNetwork(page);
    await page.goto('/');
    await run(page, 'weather --here');
    const card = page.locator('[data-weather-card]').last();
    await expect(card.locator('.sr-only')).toContainText('Weather for Sydney, New South Wales, Australia');
    expect(network.forecasts.map((url) => new URL(url).searchParams.get('latitude'))).toEqual(['-33.8700']);
    await expect(card.getByRole('button', { name: 'my location' })).toHaveCount(0);
  });

  test('--here without permission explains, and uses the network location', async ({ page }) => {
    await weatherNetwork(page);
    await page.goto('/');
    await run(page, 'weather --here');
    const card = page.locator('[data-weather-card]').last();
    const inApp = test.info().project.name === 'iphone-instagram';
    await expect(card.locator('.sr-only')).toContainText(
      inApp
        ? "Instagram didn't share your location, so this uses an approximate network location. Open vesen.app in Safari or Chrome for a precise fix."
        : 'so this uses an approximate network location.',
    );
    await expect(card.locator('.sr-only')).toContainText('≈ Sydney, New South Wales, AU (approximate, from your network)');
    await expect(card.getByRole('button', { name: 'use precise location' })).toBeVisible();
  });

  test('hostile input is printed as text, never as markup', async ({ page }) => {
    await weatherNetwork(page);
    let dialogs = 0;
    page.on('dialog', (dialog) => {
      dialogs += 1;
      void dialog.dismiss();
    });
    await page.goto('/');
    await run(page, "weather '<img src=x onerror=alert(1)>'");
    const log = page.getByRole('log');
    await expect(log).toContainText('weather: no place called "<img src=x onerror=alert(1)>".');
    // Unquoted, the shell reads < and ( as its own, and says so, as text.
    await run(page, 'weather <img src=x onerror=alert(1)>');
    await expect(log.locator('.entry').last()).toContainText('vesen:');
    await expect(page.locator('main img')).toHaveCount(0);
    expect(dialogs).toBe(0);
  });
});
