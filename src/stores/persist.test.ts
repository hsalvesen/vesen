import { get } from 'svelte/store';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStorage, type StorageHost } from '../services/storage';
import { STORAGE_KEYS } from '../services/storage-keys';
import type { StorageService } from '../services/types';

/** Storage over plain maps, or over areas that throw on every access. */
function storageWith(items: Record<string, string>, blocked = false): { storage: StorageService; items: Map<string, string> } {
  const map = new Map(Object.entries(items));
  const area = {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  } as unknown as Storage;
  const host: StorageHost = {
    get localStorage(): Storage {
      if (blocked) throw new DOMException('The operation is insecure.', 'SecurityError');
      return area;
    },
    get sessionStorage(): Storage {
      if (blocked) throw new DOMException('The operation is insecure.', 'SecurityError');
      return area;
    },
  };
  return { storage: createStorage(host), items: map };
}

const THEME = STORAGE_KEYS.theme.key;
const CATHODE = STORAGE_KEYS.cathode.key;

// The stores are module singletons; each test gets fresh ones.
beforeEach(() => {
  vi.resetModules();
});

describe('persistTheme', () => {
  it('restores the saved theme by name', async () => {
    const { theme, persistTheme } = await import('./theme');
    const { storage } = storageWith({ [THEME]: 'cockatoo' });
    persistTheme(storage.local);
    expect(get(theme)).toMatchObject({ name: 'cockatoo', background: '#e8ddd0' });
  });

  it.each([
    ['a theme that no longer exists', 'pinkRobin'],
    ['a whole colour object', '{"name":"cockatoo","background":"#000"}'],
    ['an inherited key', 'constructor'],
    ['an empty value', ''],
  ])('falls back to swamphen for %s', async (_, value) => {
    const { theme, persistTheme } = await import('./theme');
    const { storage } = storageWith({ [THEME]: value });
    persistTheme(storage.local);
    expect(get(theme).name).toBe('swamphen');
  });

  it('saves nothing until the theme changes, then only its name', async () => {
    const { theme, persistTheme, findTheme } = await import('./theme');
    const { storage, items } = storageWith({});
    const stop = persistTheme(storage.local);
    expect(items.size).toBe(0);

    theme.set(findTheme('Wombat') ?? get(theme));
    expect(items.get(THEME)).toBe('wombat');

    stop();
    theme.set(findTheme('cockatoo') ?? get(theme));
    expect(items.get(THEME)).toBe('wombat');
  });

  it('keeps working in memory when storage is blocked', async () => {
    const { theme, persistTheme, findTheme } = await import('./theme');
    const { storage } = storageWith({}, true);
    expect(() => persistTheme(storage.local)).not.toThrow();
    theme.set(findTheme('kangaroo') ?? get(theme));
    expect(get(theme).name).toBe('kangaroo');
    expect(storage.local.get(THEME)).toBe('kangaroo');
  });
});

describe('findTheme', () => {
  it('matches names regardless of case and surrounding space, and nothing else', async () => {
    const { findTheme } = await import('./theme');
    expect(findTheme(' Cockatoo ')?.name).toBe('cockatoo');
    expect(findTheme('toString')).toBeUndefined();
    expect(findTheme(null)).toBeUndefined();
    expect(findTheme({ name: 'cockatoo' })).toBeUndefined();
  });
});

describe('persistCathode', () => {
  it('restores the saved mode', async () => {
    const { cathode, persistCathode } = await import('./cathode');
    const { storage } = storageWith({ [CATHODE]: '{"mode":"vintage"}' });
    persistCathode(storage.local);
    expect(get(cathode)).toBe('vintage');
  });

  it.each([
    ['corrupt JSON', '{"mode":'],
    ['an unknown mode', '{"mode":"hologram"}'],
    ['the legacy bare value', 'vintage'],
    ['the wrong shape', '[]'],
  ])('falls back to scanlines for %s', async (_, value) => {
    const { cathode, persistCathode } = await import('./cathode');
    const { storage } = storageWith({ [CATHODE]: value });
    persistCathode(storage.local);
    expect(get(cathode)).toBe('scanlines');
  });

  it('saves nothing until the mode changes, so the default can follow the device', async () => {
    const { cathode, persistCathode } = await import('./cathode');
    const { storage, items } = storageWith({});
    persistCathode(storage.local);
    expect(items.size).toBe(0);

    cathode.set('off');
    expect(items.get(CATHODE)).toBe('{"mode":"off"}');
  });

  it('restores and saves the quality beside the mode, leaving auto out', async () => {
    const { cathode, cathodeQuality, persistCathode } = await import('./cathode');
    const { storage, items } = storageWith({ [CATHODE]: '{"mode":"phosphor","quality":"lite"}' });
    persistCathode(storage.local);
    expect(get(cathode)).toBe('phosphor');
    expect(get(cathodeQuality)).toBe('lite');

    cathodeQuality.set('full');
    expect(items.get(CATHODE)).toBe('{"mode":"phosphor","quality":"full"}');
    cathodeQuality.set('auto');
    expect(items.get(CATHODE)).toBe('{"mode":"phosphor"}');
  });

  it('keeps a known mode when the saved quality is unknown, and the reverse', async () => {
    const { cathode, cathodeQuality, persistCathode } = await import('./cathode');
    persistCathode(storageWith({ [CATHODE]: '{"mode":"vintage","quality":"ultra"}' }).storage.local);
    expect([get(cathode), get(cathodeQuality)]).toEqual(['vintage', 'auto']);

    vi.resetModules();
    const fresh = await import('./cathode');
    fresh.persistCathode(storageWith({ [CATHODE]: '{"mode":"hologram","quality":"off"}' }).storage.local);
    expect([get(fresh.cathode), get(fresh.cathodeQuality)]).toEqual(['scanlines', 'off']);
  });
});

describe('persistPrefs', () => {
  const PREFS = STORAGE_KEYS.prefs.key;

  it('restores the key bar setting, and saves a change beside the other preferences', async () => {
    const { keyBar, persistPrefs } = await import('./prefs');
    const { storage, items } = storageWith({ [PREFS]: JSON.stringify({ keys: 'off', bell: 'visual' }) });
    const stop = persistPrefs(storage.local);
    expect(get(keyBar)).toBe('off');
    // Restoring writes nothing.
    expect(JSON.parse(items.get(PREFS) ?? '{}')).toEqual({ keys: 'off', bell: 'visual' });
    keyBar.set('on');
    expect(JSON.parse(items.get(PREFS) ?? '{}')).toEqual({ keys: 'on', bell: 'visual' });
    stop();
    keyBar.set('auto');
    expect(JSON.parse(items.get(PREFS) ?? '{}').keys).toBe('on');
  });

  it('keeps auto for anything unreadable, and nothing is saved until the visitor chooses', async () => {
    const { keyBar, persistPrefs } = await import('./prefs');
    for (const raw of ['not json', '[1]', JSON.stringify({ keys: 'sometimes' })]) {
      const { storage, items } = storageWith({ [PREFS]: raw });
      persistPrefs(storage.local)();
      expect(get(keyBar), raw).toBe('auto');
      expect(items.get(PREFS)).toBe(raw);
    }
  });

  it('works with storage blocked, in memory', async () => {
    const { keyBar, persistPrefs } = await import('./prefs');
    const { storage } = storageWith({}, true);
    const stop = persistPrefs(storage.local);
    keyBar.set('off');
    expect(get(keyBar)).toBe('off');
    stop();
  });

  it('shows the key bar unless it is off, or auto after a hardware keyboard', async () => {
    const { keyBarShown } = await import('./prefs');
    expect([keyBarShown('auto', false), keyBarShown('auto', true), keyBarShown('on', true), keyBarShown('off', false)]).toEqual([true, false, true, false]);
  });
});
