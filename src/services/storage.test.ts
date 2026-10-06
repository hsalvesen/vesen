import { describe, expect, it } from 'vitest';
import { cathodeModes, DEFAULT_CATHODE_MODE } from '../stores/cathode';
import { DEFAULT_THEME_NAME, themes } from '../stores/theme';
import { createStorage, runMigrations, type MigrationCatalogue, type StorageHost } from './storage';
import { STORAGE_KEYS } from './storage-keys';

/** Just enough of the Web Storage API, with switches to make each call throw. */
class FakeStorage {
  readonly items = new Map<string, string>();
  failGet = false;
  failSet = false;
  getItem(key: string): string | null {
    if (this.failGet) throw new DOMException('The operation is insecure.', 'SecurityError');
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failSet) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

/** A window whose storage properties return these areas, or throw when given null. */
function host(local: FakeStorage | null, session: FakeStorage | null = new FakeStorage()): StorageHost {
  const area = (storage: FakeStorage | null) => {
    if (storage === null) throw new DOMException('The operation is insecure.', 'SecurityError');
    return storage as unknown as Storage;
  };
  return {
    get localStorage() {
      return area(local);
    },
    get sessionStorage() {
      return area(session);
    },
  };
}

const THEME = STORAGE_KEYS.theme.key;
const CATHODE = STORAGE_KEYS.cathode.key;

const catalogue: MigrationCatalogue = {
  themes: themes.map((t) => t.name),
  defaultTheme: DEFAULT_THEME_NAME,
  cathodeModes,
  defaultCathode: DEFAULT_CATHODE_MODE,
};

describe('createStorage', () => {
  it('reads and writes through to the browser', () => {
    const local = new FakeStorage();
    const storage = createStorage(host(local));

    expect(storage.local.set(THEME, 'cockatoo')).toBe(true);
    expect(local.items.get(THEME)).toBe('cockatoo');
    expect(storage.local.get(THEME)).toBe('cockatoo');
    storage.local.remove(THEME);
    expect(local.items.has(THEME)).toBe(false);
    expect(storage.local.persistent).toBe(true);
  });

  it('keeps the two areas apart', () => {
    const local = new FakeStorage();
    const session = new FakeStorage();
    const storage = createStorage(host(local, session));
    storage.session.set(STORAGE_KEYS.chunkReload.key, 'build');

    expect(session.items.get(STORAGE_KEYS.chunkReload.key)).toBe('build');
    expect(local.items.size).toBe(0);
  });

  it('falls back to memory when touching the storage property throws', () => {
    const storage = createStorage(host(null, null));

    expect(storage.local.get(THEME)).toBeNull();
    expect(storage.local.set(THEME, 'cockatoo')).toBe(false);
    expect(storage.local.get(THEME)).toBe('cockatoo');
    expect(storage.local.persistent).toBe(false);
    storage.local.remove(THEME);
    expect(storage.local.get(THEME)).toBeNull();
    expect(storage.readLegacy('colorscheme')).toBeNull();
    expect(() => storage.removeLegacy('history')).not.toThrow();
    expect(storage.session.set(STORAGE_KEYS.session.key, '{}')).toBe(false);
  });

  it('stops using an area whose reads throw', () => {
    const local = new FakeStorage();
    local.items.set(THEME, 'wombat');
    local.failGet = true;
    const storage = createStorage(host(local));

    expect(storage.local.get(THEME)).toBeNull();
    expect(storage.local.persistent).toBe(false);
    local.failGet = false;
    expect(storage.local.set(THEME, 'cockatoo')).toBe(false);
    expect(local.items.get(THEME)).toBe('wombat');
    expect(storage.local.get(THEME)).toBe('cockatoo');
  });

  it('keeps a value it could not write in memory for this session, and still reads the rest', () => {
    const local = new FakeStorage();
    local.items.set(CATHODE, '{"mode":"vintage"}');
    local.failSet = true;
    const storage = createStorage(host(local));

    expect(storage.local.set(THEME, 'cockatoo')).toBe(false);
    expect(storage.local.get(THEME)).toBe('cockatoo');
    expect(storage.local.get(CATHODE)).toBe('{"mode":"vintage"}');
    // One failed write (over quota) does not give up on the area: the next may fit.
    expect(storage.local.persistent).toBe(true);

    // Once a write succeeds again, the browser holds the value.
    local.failSet = false;
    expect(storage.local.set(THEME, 'wombat')).toBe(true);
    expect(local.items.get(THEME)).toBe('wombat');
  });

  it('keeps everything in memory without a window', () => {
    const storage = createStorage(null);
    expect(storage.local.set(THEME, 'kangaroo')).toBe(false);
    expect(storage.local.get(THEME)).toBe('kangaroo');
    expect(storage.local.persistent).toBe(false);
  });

  describe('JSON', () => {
    const mode = (raw: unknown) =>
      typeof raw === 'object' && raw !== null && 'mode' in raw && typeof raw.mode === 'string' ? raw.mode : undefined;

    it('round-trips a value through the parse check', () => {
      const storage = createStorage(host(new FakeStorage()));
      expect(storage.local.setJson(CATHODE, { mode: 'phosphor' })).toBe(true);
      expect(storage.local.getJson(CATHODE, mode)).toBe('phosphor');
    });

    it.each([
      ['corrupt JSON', '{"mode":'],
      ['the wrong shape', '["phosphor"]'],
      ['a bare string', 'phosphor'],
      ['null', 'null'],
    ])('reads %s as undefined', (_, raw) => {
      const local = new FakeStorage();
      local.items.set(CATHODE, raw);
      expect(createStorage(host(local)).local.getJson(CATHODE, mode)).toBeUndefined();
    });

    it('reads a value whose check throws as undefined', () => {
      const local = new FakeStorage();
      local.items.set(CATHODE, '{}');
      const storage = createStorage(host(local));
      expect(
        storage.local.getJson(CATHODE, () => {
          throw new Error('bad shape');
        }),
      ).toBeUndefined();
    });

    it('refuses values JSON cannot hold', () => {
      const storage = createStorage(host(new FakeStorage()));
      const cyclic: { self?: unknown } = {};
      cyclic.self = cyclic;
      expect(storage.local.setJson(CATHODE, cyclic)).toBe(false);
      expect(storage.local.setJson(CATHODE, undefined)).toBe(false);
      expect(storage.local.get(CATHODE)).toBeNull();
    });
  });
});

describe('runMigrations', () => {
  /** Migrates a localStorage holding `items` and returns what it holds afterwards. */
  function migrate(items: Record<string, string>): Record<string, string> {
    const local = new FakeStorage();
    for (const [key, value] of Object.entries(items)) local.items.set(key, value);
    runMigrations(createStorage(host(local)), catalogue);
    return Object.fromEntries(local.items);
  }

  const swamphen = themes.find((t) => t.name === 'swamphen');
  const cockatoo = themes.find((t) => t.name === 'cockatoo');

  it('keeps only the name of a saved colour object', () => {
    expect(migrate({ colorscheme: JSON.stringify(cockatoo) })).toEqual({ [THEME]: 'cockatoo' });
  });

  it('matches the name regardless of case, and ignores stale colours', () => {
    const stale = { ...cockatoo, name: 'Cockatoo', background: '#ffffff' };
    expect(migrate({ colorscheme: JSON.stringify(stale) })).toEqual({ [THEME]: 'cockatoo' });
  });

  it.each([
    ['the default, which the old store saved on every load', JSON.stringify(swamphen)],
    ['a theme that no longer exists', JSON.stringify({ ...swamphen, name: 'pinkRobin' })],
    ['corrupt JSON', '{"name":"cock'],
    ['an object without a name', '{"background":"#000000"}'],
    ['a prototype key', JSON.stringify({ name: '__proto__' })],
  ])('drops %s, leaving the default', (_, colorscheme) => {
    expect(migrate({ colorscheme })).toEqual({});
  });

  it('turns a chosen CRT mode into the new shape', () => {
    expect(migrate({ cathode: 'vintage' })).toEqual({ [CATHODE]: '{"mode":"vintage"}' });
    expect(migrate({ cathode: 'off' })).toEqual({ [CATHODE]: '{"mode":"off"}' });
  });

  it.each([
    ['the default, which the old store saved on every load', 'scanlines'],
    ['an unknown mode', 'hologram'],
  ])('drops %s', (_, cathode) => {
    expect(migrate({ cathode })).toEqual({});
  });

  it("removes the old session keys, which held a visitor's typed lines", () => {
    const after = migrate({
      history: JSON.stringify([{ command: 'echo my secret note', outputs: [] }]),
      commandHistory: JSON.stringify(['echo my secret note']),
    });
    expect(after).toEqual({});
  });

  it('never overwrites a value already saved under the new key, and leaves other keys alone', () => {
    const after = migrate({
      [THEME]: 'wombat',
      [CATHODE]: '{"mode":"phosphor"}',
      [STORAGE_KEYS.prefs.key]: '{}',
      colorscheme: JSON.stringify(cockatoo),
      cathode: 'vintage',
    });
    expect(after).toEqual({ [THEME]: 'wombat', [CATHODE]: '{"mode":"phosphor"}', [STORAGE_KEYS.prefs.key]: '{}' });
  });

  it('migrates everything at once, and a second run changes nothing', () => {
    const local = new FakeStorage();
    local.items.set('colorscheme', JSON.stringify(cockatoo));
    local.items.set('cathode', 'phosphor');
    local.items.set('history', '[]');
    local.items.set('commandHistory', '[]');
    const storage = createStorage(host(local));

    runMigrations(storage, catalogue);
    const once = Object.fromEntries(local.items);
    runMigrations(storage, catalogue);

    expect(once).toEqual({ [THEME]: 'cockatoo', [CATHODE]: '{"mode":"phosphor"}' });
    expect(Object.fromEntries(local.items)).toEqual(once);
  });

  it('does nothing, and does not throw, when storage is blocked', () => {
    expect(() => runMigrations(createStorage(host(null, null)), catalogue)).not.toThrow();
  });
});
