// The one way into localStorage and sessionStorage (docs/plan/02-architecture-and-contracts.md,
// section 8). Browsers and in-app WebViews that block site data throw on any access, touching
// the `localStorage` property included, so every access is guarded and a session falls back to
// memory rather than failing to boot (F001).
import { LEGACY_KEYS, STORAGE_KEYS, type LegacyKey, type StorageArea, type StorageKey } from './storage-keys';
import type { KV, StorageService } from './types';

/** Where the browser keeps its two storage areas. Reading either property may throw. */
export interface StorageHost {
  readonly localStorage: Storage;
  readonly sessionStorage: Storage;
}

const PROPERTY = { local: 'localStorage', session: 'sessionStorage' } as const;

/** One area, plus raw access by any name for the legacy keys. */
interface SafeArea<A extends StorageArea> extends KV<A> {
  getRaw(key: string): string | null;
  removeRaw(key: string): void;
}

function safeArea<A extends StorageArea>(host: StorageHost | null, area: A): SafeArea<A> {
  /** Values that could not be written to the browser; they win over it for this session. */
  const memory = new Map<string, string>();
  /** The browser's area: undefined until first used, null once it has failed. */
  let backing: Storage | null | undefined;
  let persistent = true;

  const storage = (): Storage | null => {
    if (backing === undefined) {
      try {
        backing = host?.[PROPERTY[area]] ?? null;
      } catch {
        backing = null;
      }
      if (backing === null) persistent = false;
    }
    return backing;
  };

  /** Stops using a browser area that has thrown on a read. */
  const lose = (): void => {
    backing = null;
    persistent = false;
  };

  const getRaw = (key: string): string | null => {
    const kept = memory.get(key);
    if (kept !== undefined) return kept;
    const browser = storage();
    if (browser === null) return null;
    try {
      return browser.getItem(key);
    } catch {
      lose();
      return null;
    }
  };

  const removeRaw = (key: string): void => {
    memory.delete(key);
    const browser = storage();
    if (browser === null) return;
    try {
      browser.removeItem(key);
    } catch {
      lose();
    }
  };

  const set = (key: StorageKey<A>, value: string): boolean => {
    const browser = storage();
    if (browser !== null) {
      try {
        browser.setItem(key, value);
        memory.delete(key);
        return true;
      } catch {
        // Over quota, or blocked after all: keep the value for this session only. The area
        // stays in use: one value too big says nothing about the next, smaller one.
      }
    }
    memory.set(key, value);
    return false;
  };

  return {
    get persistent() {
      return persistent;
    },
    get: getRaw,
    set,
    remove: removeRaw,
    getJson<T>(key: StorageKey<A>, parse: (raw: unknown) => T | undefined): T | undefined {
      const raw = getRaw(key);
      if (raw === null) return undefined;
      try {
        return parse(JSON.parse(raw));
      } catch {
        return undefined;
      }
    },
    setJson(key: StorageKey<A>, value: unknown): boolean {
      let raw: string | undefined;
      try {
        raw = JSON.stringify(value);
      } catch {
        return false;
      }
      return raw === undefined ? false : set(key, raw);
    },
    getRaw,
    removeRaw,
  };
}

/**
 * The storage service over a window's two areas. Pass null for a session that lives in memory
 * only, as tests and a missing `window` do.
 */
export function createStorage(host: StorageHost | null): StorageService {
  const local = safeArea(host, 'local');
  const session = safeArea(host, 'session');
  return {
    local,
    session,
    readLegacy: (key: LegacyKey) => local.getRaw(key),
    removeLegacy: (key: LegacyKey) => local.removeRaw(key),
  };
}

/** The names and defaults the legacy values are checked against. */
export interface MigrationCatalogue {
  /** Theme names, from themes.json. */
  readonly themes: readonly string[];
  readonly defaultTheme: string;
  readonly cathodeModes: readonly string[];
  readonly defaultCathode: string;
}

/** The shape of `vesen:cathode:v1`: the CRT mode, and the quality when it is not `auto`. */
export interface StoredCathode {
  readonly mode: string;
  readonly quality?: string;
}

/**
 * Converts the pre-overhaul keys, then removes them:
 * - `colorscheme`, the whole theme object as JSON, becomes the theme's name in `vesen:theme:v1`;
 * - `cathode`, a bare mode name, becomes `{ mode }` in `vesen:cathode:v1`;
 * - `history` and `commandHistory`, a visitor's last session, are dropped.
 *
 * The old stores saved their value on every page load whether or not the visitor chose it, so a
 * value equal to the default is not carried over: the visitor keeps whichever default applies to
 * their device. A value that names no known theme or mode is dropped, which leaves the default.
 * A value already saved under the new key wins. Never throws.
 */
export function runMigrations(storage: StorageService, catalogue: MigrationCatalogue): void {
  const theme = chosen(legacyThemeName(storage.readLegacy('colorscheme')), catalogue.themes, catalogue.defaultTheme);
  if (theme !== undefined && storage.local.get(STORAGE_KEYS.theme.key) === null) {
    storage.local.set(STORAGE_KEYS.theme.key, theme);
  }

  const mode = chosen(storage.readLegacy('cathode'), catalogue.cathodeModes, catalogue.defaultCathode);
  if (mode !== undefined && storage.local.get(STORAGE_KEYS.cathode.key) === null) {
    const value: StoredCathode = { mode };
    storage.local.setJson(STORAGE_KEYS.cathode.key, value);
  }

  for (const key of LEGACY_KEYS) storage.removeLegacy(key);
}

/** The theme name inside a legacy `colorscheme` value, if it has one. */
function legacyThemeName(raw: string | null): string | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value === 'string') return value;
    if (typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string') {
      return value.name;
    }
  } catch {
    // Not JSON: nothing to keep.
  }
  return null;
}

/** The canonical spelling of `name` among `names`, unless it is missing, unknown or the default. */
function chosen(name: string | null, names: readonly string[], fallback: string): string | undefined {
  if (name === null) return undefined;
  const lower = name.trim().toLowerCase();
  const match = names.find((candidate) => candidate.toLowerCase() === lower);
  return match === undefined || match.toLowerCase() === fallback.toLowerCase() ? undefined : match;
}
