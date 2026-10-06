// @vitest-environment happy-dom
// F001: a browser that blocks site data throws on any storage access, and a store that touched
// storage at import time took the whole page down before mount. Stores must be pure.
import { afterEach, describe, expect, it, vi } from 'vitest';

const AREAS = ['localStorage', 'sessionStorage'] as const;
const saved = AREAS.map((name) => [name, Object.getOwnPropertyDescriptor(window, name)] as const);

afterEach(() => {
  for (const [name, descriptor] of saved) {
    if (descriptor) Object.defineProperty(window, name, descriptor);
    else Reflect.deleteProperty(window, name);
  }
});

/** Makes both storage properties throw, as Safari and some WebViews do, and records each touch. */
function blockStorage(): string[] {
  const touched: string[] = [];
  for (const name of AREAS) {
    Object.defineProperty(window, name, {
      configurable: true,
      get() {
        touched.push(name);
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });
  }
  return touched;
}

describe('stores', () => {
  it('import without touching storage or the page, even when storage throws', async () => {
    const touched = blockStorage();
    expect(() => window.localStorage).toThrow();
    touched.length = 0;
    const page = document.documentElement.outerHTML;

    vi.resetModules();
    const stores = import.meta.glob(['./*.ts', '!./*.test.ts']);
    expect(Object.keys(stores).sort()).toEqual(['./cathode.ts', './prefs.ts', './screen.ts', './term.ts', './theme.ts', './viewport.ts']);
    for (const load of Object.values(stores)) await expect(load()).resolves.toBeTypeOf('object');

    expect(touched).toEqual([]);
    expect(document.documentElement.outerHTML).toBe(page);
  });

  it('start from the defaults when storage throws', async () => {
    blockStorage();
    vi.resetModules();
    const { get } = await import('svelte/store');
    const { theme } = await import('./theme');
    const { cathode } = await import('./cathode');
    const { screen } = await import('./screen');

    expect(get(theme).name).toBe('swamphen');
    expect(get(cathode)).toBe('scanlines');
    expect(get(screen)).toEqual([]);
  });
});
