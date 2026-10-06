// Theme, CRT and key bar state for commands (services/types.ts, Appearance), over the stores.
// Commands reach the look of the page only through this.

import { get, type Readable, type Writable } from 'svelte/store';
import { SWATCH_SLOTS, type Appearance, type CathodeInfo, type CathodeTier, type KeyBarState, type ThemeInfo } from './types';

type ThemeLike = { readonly name: string; readonly background: string; readonly foreground: string } & Readonly<
  Record<(typeof SWATCH_SLOTS)[number], string>
>;

export interface AppearanceStores<T extends ThemeLike, M extends string, Q extends string, K extends string = string> {
  readonly theme: Writable<T>;
  readonly themes: readonly T[];
  readonly defaultTheme: T;
  readonly cathode: Writable<M>;
  readonly cathodeModes: readonly { readonly name: M; readonly summary: string }[];
  /** The quality setting, and the settings there are; without them, quality is always auto. */
  readonly cathodeQuality?: Writable<Q>;
  readonly cathodeQualities?: readonly Q[];
  /** The tier in force; bootstrap keeps it in step with the quality and the device. */
  readonly crtTier?: Readable<CathodeTier>;
  /** The key bar setting and its choices; without them, the bar is always auto. */
  readonly keyBar?: Writable<K>;
  readonly keyBarModes?: readonly K[];
  /** A hardware keyboard has been used on this touch screen. */
  readonly hardwareKeyboard?: Readable<boolean>;
}

export function createAppearance<T extends ThemeLike, M extends string, Q extends string = string, K extends string = string>(
  stores: AppearanceStores<T, M, Q, K>,
): Appearance {
  const findTheme = (name: string): T | undefined => {
    const lower = name.trim().toLowerCase();
    return stores.themes.find((theme) => theme.name.toLowerCase() === lower);
  };
  const qualities = stores.cathodeQualities ?? [];
  const keyModes = stores.keyBarModes ?? [];
  return {
    themes: (): readonly ThemeInfo[] =>
      stores.themes.map((theme) => ({
        name: theme.name,
        background: theme.background,
        foreground: theme.foreground,
        swatches: SWATCH_SLOTS.map((slot) => theme[slot]),
      })),
    currentTheme: () => get(stores.theme).name,
    setTheme(name) {
      const found = findTheme(name);
      if (found === undefined) return false;
      stores.theme.set(found);
      return true;
    },
    cathodeModes: (): readonly CathodeInfo[] => stores.cathodeModes.map(({ name, summary }) => ({ name, summary })),
    currentCathode: () => get(stores.cathode),
    setCathode(mode) {
      const found = stores.cathodeModes.find((info) => info.name === mode.trim().toLowerCase());
      if (found === undefined) return false;
      stores.cathode.set(found.name);
      return true;
    },
    cathodeQualities: () => qualities,
    setCathodeQuality(quality) {
      const found = qualities.find((name) => name === quality.trim().toLowerCase());
      if (found === undefined || stores.cathodeQuality === undefined) return false;
      stores.cathodeQuality.set(found);
      return true;
    },
    cathodeTier: (): CathodeTier =>
      stores.crtTier === undefined ? { tier: 'full', reason: 'the default', quality: 'auto' } : get(stores.crtTier),
    keyBar(): KeyBarState {
      const mode: string = stores.keyBar === undefined ? 'auto' : get(stores.keyBar);
      const hardware = stores.hardwareKeyboard === undefined ? false : get(stores.hardwareKeyboard);
      return { mode, hardware, shown: mode === 'on' || (mode === 'auto' && !hardware) };
    },
    keyBarModes: () => keyModes,
    setKeyBar(mode) {
      const found = keyModes.find((name) => name === mode.trim().toLowerCase());
      if (found === undefined || stores.keyBar === undefined) return false;
      stores.keyBar.set(found);
      return true;
    },
    // `reset` restores the default theme, as it always has; the CRT mode stays the visitor's choice.
    resetDefaults() {
      stores.theme.set(stores.defaultTheme);
    },
  };
}
