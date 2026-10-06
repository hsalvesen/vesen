// The page head, the web app manifest and the images they point at: what a link preview, a
// home screen and a phone's browser bars show before the app runs.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const html = read('index.html');
const head = /<head>([\s\S]*)<\/head>/.exec(html)?.[1] ?? '';

/** The width and height in a PNG's header. */
function pngSize(path: string): { width: number; height: number } {
  const bytes = readFileSync(join(ROOT, path));
  expect(bytes.subarray(1, 4).toString('latin1'), `${path} is a PNG`).toBe('PNG');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

/** The content of the meta tag with this name or property. */
function meta(key: string): string | undefined {
  const tag = [...head.matchAll(/<meta\b[^>]*>/g)].map(([t]) => t).find((t) => t.includes(`"${key}"`));
  return tag ? /content="([^"]*)"/.exec(tag)?.[1] : undefined;
}

/** The public file a root-relative URL is served from. */
const publicFile = (url: string) => join('public', url.replace(/^\//, ''));

describe('index.html head', () => {
  it('names the page and describes it for search and link previews', () => {
    expect(head).toContain('<title>Vesen · a terminal in your browser</title>');
    expect(meta('description')).toMatch(/^A terminal in your browser/);
    expect(meta('og:title')).toBe('Vesen · a terminal in your browser');
    expect(meta('og:description')).toBeTruthy();
    expect(meta('og:type')).toBe('website');
    expect(meta('og:url')).toBe('https://www.vesen.app/');
    expect(meta('og:image')).toBe('https://www.vesen.app/og.png');
    expect(meta('og:image:width')).toBe('1200');
    expect(meta('og:image:height')).toBe('630');
    expect(meta('og:image:alt')).toBeTruthy();
    expect(meta('twitter:card')).toBe('summary_large_image');
    expect(meta('format-detection')).toBe('telephone=no');
  });

  it('tints the browser bars in the default theme until the boot script knows better', () => {
    expect(meta('theme-color')).toBe('#222235');
    // The boot script and platform/head.ts set color-scheme from the theme.
    expect(html).not.toMatch(/<html[^>]*\b(?:class|style)=/);
  });

  it('links the icons and the manifest, and every one exists', () => {
    expect(head).toContain('<link rel="icon" href="/icons/theme/swamphen.svg" sizes="any" type="image/svg+xml" />');
    expect(head).toContain('<link rel="icon" href="/icons/favicon-32.png" sizes="32x32" type="image/png" />');
    expect(head).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
    expect(head).toContain('<link rel="manifest" href="/manifest.webmanifest" />');
    for (const [, href = ''] of head.matchAll(/<link\b[^>]*\brel="(?:icon|apple-touch-icon|manifest)"[^>]*\bhref="([^"]+)"/g)) {
      expect(existsSync(join(ROOT, publicFile(href))), href).toBe(true);
    }
  });

  it('runs the boot script from a file, before the app, and no inline script at all', () => {
    const scripts = [...html.matchAll(/<script\b[^>]*>/g)].map(([tag]) => tag);
    expect(scripts).toEqual(['<script vite-ignore src="/boot.js">', '<script type="module" src="/src/main.ts">']);
    expect(html).not.toMatch(/<script\b[^>]*>[^<\s]/);
    expect(head.indexOf('/boot.js')).toBeGreaterThan(head.indexOf('name="theme-color"'));
    expect(head.indexOf('/boot.js')).toBeGreaterThan(head.indexOf('type="image/svg+xml"'));
  });
});

describe('web app manifest', () => {
  const manifest = JSON.parse(read('public/manifest.webmanifest')) as {
    name: string;
    short_name: string;
    start_url: string;
    display: string;
    background_color: string;
    theme_color: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };

  it('installs as Vesen, standalone, in the default theme', () => {
    expect(manifest).toMatchObject({
      name: 'Vesen Terminal',
      short_name: 'Vesen',
      start_url: '/',
      display: 'standalone',
      background_color: '#222235',
      theme_color: '#222235',
    });
  });

  it('lists PNG icons of the sizes it claims, including a maskable one', () => {
    for (const icon of manifest.icons) {
      const { width, height } = pngSize(publicFile(icon.src));
      expect(`${width}x${height}`, icon.src).toBe(icon.sizes);
      expect(icon.type).toBe('image/png');
    }
    expect(manifest.icons.map((icon) => icon.sizes)).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(manifest.icons.some((icon) => icon.purpose === 'maskable')).toBe(true);
  });
});

describe('icons and link preview', () => {
  const themes = (JSON.parse(read('themes.json')) as { name: string }[]).map((t) => t.name);

  it('has a small SVG favicon for every theme', () => {
    for (const name of themes) {
      const path = `public/icons/theme/${name}.svg`;
      expect(existsSync(join(ROOT, path)), path).toBe(true);
      expect(statSync(join(ROOT, path)).size, path).toBeLessThan(1000);
      expect(read(path)).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 180 180">/);
    }
    expect(readdirSync(join(ROOT, 'public/icons/theme')).sort()).toEqual(themes.map((name) => `${name}.svg`).sort());
  });

  it('has the PNG fallback and touch icon at their sizes', () => {
    expect(pngSize('public/icons/favicon-32.png')).toEqual({ width: 32, height: 32 });
    expect(pngSize('public/icons/apple-touch-icon.png')).toEqual({ width: 180, height: 180 });
  });

  it('keeps no legacy .ico favicons', () => {
    const walk = (dir: string): string[] =>
      readdirSync(join(ROOT, dir)).flatMap((name) =>
        statSync(join(ROOT, dir, name)).isDirectory() ? walk(`${dir}/${name}`) : [`${dir}/${name}`],
      );
    expect(walk('public').filter((path) => path.endsWith('.ico'))).toEqual([]);
  });

  it('has a 1200x630 preview image under 150 kB', () => {
    expect(pngSize('public/og.png')).toEqual({ width: 1200, height: 630 });
    expect(statSync(join(ROOT, 'public/og.png')).size).toBeLessThan(150_000);
  });
});
