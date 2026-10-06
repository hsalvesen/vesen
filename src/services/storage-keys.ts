// Every key vesen stores in the browser, in one place (docs/plan/02-architecture-and-contracts.md,
// section 8). All access goes through services/storage.ts, which takes only these keys.
// Keys follow `vesen:<name>:v<n>`; a new shape gets a new version rather than a migration in place.
// Secret input (the sudo prompt) is never written under any key.

export type StorageArea = 'local' | 'session';

export interface StorageKeySpec {
  readonly key: `vesen:${string}:v${number}`;
  readonly area: StorageArea;
  /** What the value holds, for readers of this table. */
  readonly holds: string;
  /** Legacy keys read once at boot, converted into this key, then removed. */
  readonly migrateFrom?: readonly LegacyKey[];
}

/** Keys written before the overhaul. Each is read at most once, then removed. */
export const LEGACY_KEYS = ['colorscheme', 'cathode', 'history', 'commandHistory'] as const;
export type LegacyKey = (typeof LEGACY_KEYS)[number];

export const STORAGE_KEYS = {
  theme: {
    key: 'vesen:theme:v1',
    area: 'local',
    holds: 'The theme name only',
    // `colorscheme` stored the whole colour object; only its name is kept.
    migrateFrom: ['colorscheme'],
  },
  cathode: {
    key: 'vesen:cathode:v1',
    area: 'local',
    holds: 'CRT mode and quality',
    migrateFrom: ['cathode'],
  },
  prefs: {
    key: 'vesen:prefs:v1',
    area: 'local',
    holds: 'Bell, keys on or off, and text size',
  },
  history: {
    key: 'vesen:history:v1',
    area: 'local',
    holds: 'Command history; lines starting with a space are skipped',
  },
  fs: {
    key: 'vesen:fs:v1',
    area: 'local',
    holds: 'The overlay of changes under ~, with its seed version',
  },
  weather: {
    key: 'vesen:weather:v1',
    area: 'local',
    holds: 'Geocode cache and recent places',
  },
  stock: {
    key: 'vesen:stock:v1',
    area: 'local',
    holds: 'Last good quotes and recent tickers',
  },
  session: {
    key: 'vesen:session:v1',
    area: 'session',
    holds: 'The terminal snapshot restored on Back navigation',
  },
  chunkReload: {
    key: 'vesen:chunk-reload:v1',
    area: 'session',
    holds: 'The build that last reloaded because of a stale lazy chunk',
  },
} as const satisfies Record<string, StorageKeySpec>;

export type StorageKeyName = keyof typeof STORAGE_KEYS;

/** A registered key, optionally narrowed to one storage area. */
export type StorageKey<A extends StorageArea = StorageArea> = Extract<
  (typeof STORAGE_KEYS)[StorageKeyName],
  { readonly area: A }
>['key'];

/** Legacy keys with no successor; they are simply removed. */
export const DROPPED_LEGACY_KEYS: readonly LegacyKey[] = ['history', 'commandHistory'];

/** Limits that belong with the keys they bound. */
export const STORAGE_LIMITS = {
  /** Lines kept in `vesen:history:v1`. */
  historyLines: 500,
  /** Transcript entries kept in `vesen:session:v1`. */
  sessionEntries: 50,
  /** A snapshot older than this is not restored. */
  sessionMaxAgeMs: 30 * 60 * 1000,
} as const;
