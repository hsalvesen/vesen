import { describe, expect, it } from 'vitest';
import { DROPPED_LEGACY_KEYS, LEGACY_KEYS, STORAGE_KEYS, type StorageKey } from './storage-keys';

const specs = Object.values(STORAGE_KEYS);

describe('storage key registry', () => {
  it('names every key vesen:<name>:v<n>, once', () => {
    for (const { key } of specs) expect(key).toMatch(/^vesen:[a-z][a-z-]*:v[1-9][0-9]*$/);
    expect(new Set(specs.map((s) => s.key)).size).toBe(specs.length);
  });

  it('keeps the Back-navigation snapshot, the chunk reload marker and the boot marker in sessionStorage only', () => {
    const session = specs.filter((s) => s.area === 'session').map((s) => s.key);
    expect(session.sort()).toEqual(['vesen:boot:v1', 'vesen:chunk-reload:v1', 'vesen:session:v1']);
  });

  it('accounts for every legacy key exactly once: migrated or dropped', () => {
    const migrated = specs.flatMap((s) => ('migrateFrom' in s ? [...s.migrateFrom] : []));
    expect([...migrated, ...DROPPED_LEGACY_KEYS].sort()).toEqual([...LEGACY_KEYS].sort());
    expect(STORAGE_KEYS.theme.migrateFrom).toEqual(['colorscheme']);
    expect(STORAGE_KEYS.cathode.migrateFrom).toEqual(['cathode']);
  });

  it('types keys by area', () => {
    const local: StorageKey<'local'> = 'vesen:theme:v1';
    const session: StorageKey<'session'> = 'vesen:session:v1';
    // @ts-expect-error the snapshot is not a localStorage key
    const wrongArea: StorageKey<'local'> = 'vesen:session:v1';
    // @ts-expect-error unregistered keys are refused
    const unknown: StorageKey = 'vesen:other:v1';
    expect([local, session, wrongArea, unknown]).toHaveLength(4);
  });
});
