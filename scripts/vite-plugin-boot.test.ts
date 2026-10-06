import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
import themes from '../themes.json';
import { colorSchemeFor } from '../src/lib/colour';
import { themeIconHref } from '../src/platform/head';
import { DEFAULT_THEME_NAME } from '../src/stores/theme';
import { BOOT_SCRIPT_FILE, DEFAULT_THEME, bootPaints, bootScript, bootScriptPlugin, themeIconPath } from './vite-plugin-boot';

interface Painted {
  style: Record<string, string>;
  themeColor: string | null;
  icon: string | null;
}

/** Runs the boot script against a minimal page whose saved theme is `saved`. */
function boot(saved: string | null | (() => never)): Painted {
  const style: Record<string, string> = {};
  const attributes = { meta: '#222235', icon: '/icons/theme/swamphen.svg' };
  const element = (key: keyof typeof attributes) => ({
    setAttribute: (_name: string, value: string) => {
      attributes[key] = value;
    },
  });
  const document = {
    documentElement: {
      style: Object.assign(style, {
        setProperty(name: string, value: string) {
          style[name] = value;
        },
      }),
    },
    querySelector: (selector: string) =>
      selector.startsWith('meta') ? element('meta') : selector.includes('svg') ? element('icon') : null,
  };
  const localStorage = {
    getItem: (key: string) => {
      if (typeof saved === 'function') return saved();
      return key === 'vesen:theme:v1' ? saved : null;
    },
  };
  runInNewContext(bootScript(), { window: { localStorage }, document });
  const { setProperty: _, ...painted } = style as Record<string, unknown>;
  return { style: painted as Record<string, string>, themeColor: attributes.meta, icon: attributes.icon };
}

const swamphen = {
  style: {
    backgroundColor: '#222235',
    color: '#ffffff',
    colorScheme: 'dark',
    '--theme-background': '#222235',
    '--theme-foreground': '#ffffff',
    '--theme-green': '#06c993',
  },
  themeColor: '#222235',
  icon: '/icons/theme/swamphen.svg',
};

describe('boot script', () => {
  it('paints the default theme for a first visit', () => {
    expect(boot(null)).toEqual(swamphen);
  });

  it('paints the saved theme, light ones with a light color-scheme', () => {
    expect(boot('cockatoo')).toEqual({
      style: {
        backgroundColor: '#e8ddd0',
        color: '#45373c',
        colorScheme: 'light',
        '--theme-background': '#e8ddd0',
        '--theme-foreground': '#45373c',
        '--theme-green': '#5f5c46',
      },
      themeColor: '#e8ddd0',
      icon: '/icons/theme/cockatoo.svg',
    });
  });

  it.each([
    ['an unknown name', 'pinkRobin'],
    ['an inherited key', 'constructor'],
    ['__proto__', '__proto__'],
    ['the legacy JSON object', '{"name":"cockatoo"}'],
  ])('falls back to the default for %s', (_, saved) => {
    expect(boot(saved)).toEqual(swamphen);
  });

  it('falls back to the default when storage throws', () => {
    expect(
      boot(() => {
        throw new Error('SecurityError');
      }),
    ).toEqual(swamphen);
  });

  it('is plain ES5, for any WebView that can show the page', () => {
    expect(bootScript()).not.toMatch(/=>|\blet\b|\bconst\b|`|\?\.|\?\?/);
  });
});

describe('boot paints', () => {
  it('agree with themes.json, the app’s default, its favicon paths and its color-scheme rule', () => {
    expect(DEFAULT_THEME).toBe(DEFAULT_THEME_NAME);
    const paints = bootPaints();
    expect(Object.keys(paints)).toEqual(themes.map((t) => t.name));
    for (const t of themes) {
      expect(themeIconPath(t.name)).toBe(themeIconHref(t.name));
      expect(paints[t.name]).toEqual({
        background: t.background,
        foreground: t.foreground,
        green: t.green,
        scheme: colorSchemeFor(t.background),
        icon: themeIconHref(t.name),
      });
    }
  });
});

describe('bootScriptPlugin', () => {
  it('emits boot.js at the root of the build', () => {
    const emitFile = vi.fn();
    const plugin = bootScriptPlugin();
    const generateBundle = plugin.generateBundle as unknown as (this: { emitFile: typeof emitFile }) => void;
    generateBundle.call({ emitFile });
    expect(emitFile).toHaveBeenCalledWith({ type: 'asset', fileName: BOOT_SCRIPT_FILE, source: bootScript() });
    expect(BOOT_SCRIPT_FILE).toBe('boot.js');
  });

  it('serves boot.js in development, uncached, and passes everything else on', () => {
    let middleware: ((req: { url?: string }, res: unknown, next: () => void) => void) | undefined;
    const server = { middlewares: { use: (fn: typeof middleware) => (middleware = fn) } };
    const configureServer = bootScriptPlugin().configureServer as unknown as (server: unknown) => void;
    configureServer(server);

    const headers: Record<string, string> = {};
    let body = '';
    const res = { setHeader: (k: string, v: string) => (headers[k] = v), end: (b: string) => (body = b) };
    const next = vi.fn();
    middleware?.({ url: '/boot.js?t=1' }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(headers).toEqual({ 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-cache' });
    expect(body).toBe(bootScript());

    middleware?.({ url: '/src/main.ts' }, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
