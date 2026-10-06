// The current colour theme. Pure state: importing this module touches neither the DOM nor
// storage. app/bootstrap.ts restores the saved theme with persistTheme() and applies each value
// to the page (platform/head.ts).
import { writable } from 'svelte/store';
import themesJson from '../../themes.json';
import type { Theme } from '../interfaces/theme';
import { STORAGE_KEYS } from '../services/storage-keys';
import type { KV } from '../services/types';

export const themes: readonly Theme[] = themesJson;

export const DEFAULT_THEME_NAME = 'swamphen';

/** The theme with this name, ignoring case; undefined for anything else. */
export function findTheme(name: unknown): Theme | undefined {
  if (typeof name !== 'string') return undefined;
  const lower = name.trim().toLowerCase();
  return themes.find((t) => t.name.toLowerCase() === lower);
}

// themes.json always has the default; the first theme only guards against an edit removing it.
export const defaultTheme: Theme = findTheme(DEFAULT_THEME_NAME) ?? (themes[0] as Theme);

export const theme = writable<Theme>(defaultTheme);

/**
 * Restores the saved theme, then saves each later change by name only, so a returning visitor
 * picks up edits to themes.json (F002). A saved name that no longer exists falls back to the
 * default. Returns a function that stops saving.
 */
export function persistTheme(store: KV<'local'>): () => void {
  const saved = findTheme(store.get(STORAGE_KEYS.theme.key));
  if (saved) theme.set(saved);
  let restoring = true;
  const stop = theme.subscribe((value) => {
    if (!restoring) store.set(STORAGE_KEYS.theme.key, value.name);
  });
  restoring = false;
  return stop;
}
