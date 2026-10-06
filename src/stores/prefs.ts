// The visitor's preferences that are not the theme or the CRT, saved together under
// `vesen:prefs:v1`. Pure state: importing this module touches neither the DOM nor storage;
// app/bootstrap.ts restores and saves them with persistPrefs().
//
// The key bar (docs/plan/04-phone-and-instagram.md, "Dock, chips and key bar"): `auto` shows it
// on a touch screen until a hardware keyboard is used there, `on` always shows it, `off` never.
import { writable } from 'svelte/store';
import { STORAGE_KEYS } from '../services/storage-keys';
import type { KV } from '../services/types';

export const keyBarModes = ['auto', 'on', 'off'] as const;
export type KeyBarMode = (typeof keyBarModes)[number];

export function isKeyBarMode(value: unknown): value is KeyBarMode {
  return typeof value === 'string' && (keyBarModes as readonly string[]).includes(value);
}

/** Whether the phone dock shows its key bar: `keys on|off|auto`. */
export const keyBar = writable<KeyBarMode>('auto');

/** A hardware keyboard has been used on this touch screen, in this visit. Never saved. */
export const hardwareKeyboard = writable(false);

/** Whether the key bar shows, for a setting and what has been seen of the keyboard. */
export function keyBarShown(mode: KeyBarMode, hardware: boolean): boolean {
  return mode === 'on' || (mode === 'auto' && !hardware);
}

/** The stored value: an object, so the other preferences can join it without a new key. */
type StoredPrefs = Readonly<Record<string, unknown>>;

function readPrefs(raw: unknown): StoredPrefs | undefined {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as StoredPrefs) : undefined;
}

/**
 * Restores the saved preferences, then saves each later change. Fields this version does not
 * know are kept as they were. Returns a function that stops saving.
 */
export function persistPrefs(store: KV<'local'>): () => void {
  const key = STORAGE_KEYS.prefs.key;
  const saved = store.getJson(key, readPrefs)?.keys;
  if (isKeyBarMode(saved)) keyBar.set(saved);
  let restoring = true;
  const stop = keyBar.subscribe((mode) => {
    if (restoring) return;
    const current = store.getJson(key, readPrefs) ?? {};
    if (current.keys === mode) return;
    store.setJson(key, { ...current, keys: mode });
  });
  restoring = false;
  return stop;
}
