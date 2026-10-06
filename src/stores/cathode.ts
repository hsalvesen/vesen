// The CRT ("cathode") effect. Pure state: importing this module touches neither the DOM nor
// storage. app/bootstrap.ts restores the saved mode with persistCathode() and reflects each mode
// onto <html> as classes (platform/crt.ts).
import { writable } from 'svelte/store';
import { STORAGE_KEYS } from '../services/storage-keys';
import type { StoredCathode } from '../services/storage';
import type { KV } from '../services/types';

export const cathodeModes = ['off', 'scanlines', 'phosphor', 'vintage'] as const;
export type CathodeMode = (typeof cathodeModes)[number];

export interface CathodeModeInfo {
  name: CathodeMode;
  summary: string;
}

// Ordered list used by the `cathode` command for listing/help output.
export const cathodeModeInfo: CathodeModeInfo[] = [
  { name: 'off', summary: 'No effect. A clean, modern flat display.' },
  { name: 'scanlines', summary: 'Subtle horizontal scanlines with a slow refresh sweep.' },
  { name: 'phosphor', summary: 'Glowing phosphor text, scanlines and a gentle flicker.' },
  { name: 'vintage', summary: 'The full retro set: glow, flicker, RGB fringing and a heavy vignette.' },
];

// Scanlines greet visitors who have not chosen; a saved choice takes priority.
export const DEFAULT_CATHODE_MODE: CathodeMode = 'scanlines';

export function isCathodeMode(value: unknown): value is CathodeMode {
  return typeof value === 'string' && (cathodeModes as readonly string[]).includes(value);
}

export const cathode = writable<CathodeMode>(DEFAULT_CATHODE_MODE);

/** The saved mode in a `vesen:cathode:v1` value, if it holds a known one. */
function savedMode(raw: unknown): CathodeMode | undefined {
  if (typeof raw !== 'object' || raw === null || !('mode' in raw)) return undefined;
  return isCathodeMode(raw.mode) ? raw.mode : undefined;
}

/**
 * Restores the saved mode, then saves each later change. Nothing is saved until the visitor
 * picks a mode, so the default can differ by device. Returns a function that stops saving.
 */
export function persistCathode(store: KV<'local'>): () => void {
  const saved = store.getJson(STORAGE_KEYS.cathode.key, savedMode);
  if (saved) cathode.set(saved);
  let restoring = true;
  const stop = cathode.subscribe((mode) => {
    const value: StoredCathode = { mode };
    if (!restoring) store.setJson(STORAGE_KEYS.cathode.key, value);
  });
  restoring = false;
  return stop;
}
