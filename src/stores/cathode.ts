// The CRT ("cathode") effect. Pure state: importing this module touches neither the DOM nor
// storage. app/bootstrap.ts restores the saved mode and quality with persistCathode(), decides the
// tier (platform/perf.ts) and reflects both onto <html> as classes (platform/crt.ts).
//
// The mode is the look the visitor picks. The tier is how much of it the device shows: full on a
// desktop, lite on phones and in-app browsers, off when the system asks for less motion or more
// contrast. The quality is the visitor's override of the tier; `auto` leaves it to the device.
import { get, writable } from 'svelte/store';
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

// Scanlines greet visitors who have not chosen, on every device; the tier tones them down on
// phones. A saved choice takes priority.
export const DEFAULT_CATHODE_MODE: CathodeMode = 'scanlines';

export function isCathodeMode(value: unknown): value is CathodeMode {
  return typeof value === 'string' && (cathodeModes as readonly string[]).includes(value);
}

export const cathode = writable<CathodeMode>(DEFAULT_CATHODE_MODE);

export const crtTiers = ['full', 'lite', 'off'] as const;
export type CrtTier = (typeof crtTiers)[number];

export const crtQualities = ['auto', ...crtTiers] as const;
export type CrtQuality = (typeof crtQualities)[number];

export function isCrtQuality(value: unknown): value is CrtQuality {
  return typeof value === 'string' && (crtQualities as readonly string[]).includes(value);
}

/** The tier in force, why, and the quality setting it came from. */
export interface TierDecision {
  readonly tier: CrtTier;
  /** In words, for `cathode ls`: "a touch screen", "set with cathode quality full". */
  readonly reason: string;
  readonly quality: CrtQuality;
}

/** The visitor's override of the tier. */
export const cathodeQuality = writable<CrtQuality>('auto');

/** The tier in force. bootstrap keeps it current as the quality and the device's settings change. */
export const crtTier = writable<TierDecision>({ tier: 'full', reason: 'not decided yet', quality: 'auto' });

/** The saved mode and quality in a `vesen:cathode:v1` value, each if it holds a known one. */
function saved(raw: unknown): { mode?: CathodeMode; quality?: CrtQuality } | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as Record<string, unknown>;
  return {
    ...(isCathodeMode(value.mode) ? { mode: value.mode } : {}),
    ...(isCrtQuality(value.quality) ? { quality: value.quality } : {}),
  };
}

/**
 * Restores the saved mode and quality, then saves each later change of either. Nothing is saved
 * until the visitor picks one. The quality is saved only when it is not `auto`, so a visitor who
 * never overrides it keeps following the device. Returns a function that stops saving.
 */
export function persistCathode(store: KV<'local'>): () => void {
  const restored = store.getJson(STORAGE_KEYS.cathode.key, saved);
  if (restored?.mode) cathode.set(restored.mode);
  if (restored?.quality) cathodeQuality.set(restored.quality);
  let restoring = true;
  const save = () => {
    if (restoring) return;
    const quality = get(cathodeQuality);
    const value: StoredCathode = quality === 'auto' ? { mode: get(cathode) } : { mode: get(cathode), quality };
    store.setJson(STORAGE_KEYS.cathode.key, value);
  };
  const stops = [cathode.subscribe(save), cathodeQuality.subscribe(save)];
  restoring = false;
  return () => {
    for (const stop of stops) stop();
  };
}
