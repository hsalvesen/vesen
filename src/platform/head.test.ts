// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import themes from '../../themes.json';
import type { Theme } from '../interfaces/theme';
import { applyCathode } from './crt';
import { applyTheme, themeIconHref } from './head';

const theme = (name: string): Theme => {
  const found = themes.find((t) => t.name === name);
  if (!found) throw new Error(`no theme ${name}`);
  return found;
};

const STATIC_HEAD = `
  <meta name="theme-color" content="#222235" />
  <link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png" />
  <link rel="icon" href="/icons/theme/swamphen.svg" sizes="any" type="image/svg+xml" />`;

afterEach(() => {
  document.head.innerHTML = '';
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('class');
});

describe('applyTheme', () => {
  it('sets the palette variables, with names in kebab case', () => {
    applyTheme(document, theme('swamphen'));
    const style = document.documentElement.style;
    expect(style.getPropertyValue('--theme-background')).toBe('#222235');
    expect(style.getPropertyValue('--theme-bright-black')).toBe('#959DCB');
    expect(style.getPropertyValue('--theme-cursor-color')).toBe('#ffffff');
    expect(style.getPropertyValue('--theme-name')).toBe('');
  });

  it('paints the page and tints the browser bars in the theme', () => {
    document.head.innerHTML = STATIC_HEAD;
    applyTheme(document, theme('cockatoo'));
    const root = document.documentElement;
    expect(root.style.backgroundColor).toMatch(/^(#e8ddd0|rgb\(232, 221, 208\))$/);
    expect(root.style.colorScheme).toBe('light');
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#e8ddd0');

    applyTheme(document, theme('kangaroo'));
    expect(root.style.colorScheme).toBe('dark');
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1);
  });

  it('swaps only the SVG favicon, with no cache-busting query', () => {
    document.head.innerHTML = STATIC_HEAD;
    applyTheme(document, theme('treefrog'));
    expect(document.querySelector('link[type="image/svg+xml"]')?.getAttribute('href')).toBe('/icons/theme/treefrog.svg');
    expect(document.querySelector('link[type="image/png"]')?.getAttribute('href')).toBe('/icons/favicon-32.png');
    expect(document.querySelectorAll('link[rel="icon"]')).toHaveLength(2);
  });

  it('adds the theme-color meta and the icon link when the page has none', () => {
    applyTheme(document, theme('wombat'));
    expect(document.head.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#1c1814');
    const icon = document.head.querySelector('link[rel="icon"]');
    expect(icon?.getAttribute('href')).toBe('/icons/theme/wombat.svg');
    expect(icon?.getAttribute('type')).toBe('image/svg+xml');
    expect(icon?.getAttribute('sizes')).toBe('any');
  });

  it('names one icon file per theme', () => {
    expect(themeIconHref('Swamphen')).toBe('/icons/theme/swamphen.svg');
  });
});

describe('applyCathode', () => {
  it('sets one crt-<mode> class plus crt-on, and none when off', () => {
    const root = document.documentElement;
    applyCathode(root, 'vintage');
    expect([...root.classList].sort()).toEqual(['crt-on', 'crt-vintage']);
    applyCathode(root, 'scanlines');
    expect([...root.classList].sort()).toEqual(['crt-on', 'crt-scanlines']);
    applyCathode(root, 'off');
    expect([...root.classList]).toEqual([]);
  });

  it('leaves other classes alone', () => {
    const root = document.documentElement;
    root.classList.add('touch');
    applyCathode(root, 'phosphor');
    applyCathode(root, 'off');
    expect([...root.classList]).toEqual(['touch']);
  });
});
