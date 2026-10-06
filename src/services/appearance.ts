// Theme and CRT state for commands (services/types.ts, Appearance), over the stores. Commands
// reach the look of the page only through this.

import { get, type Writable } from 'svelte/store';
import type { Appearance, CathodeInfo, ThemeInfo } from './types';

interface ThemeLike {
  readonly name: string;
  readonly background: string;
  readonly foreground: string;
}

export interface AppearanceStores<T extends ThemeLike, M extends string> {
  readonly theme: Writable<T>;
  readonly themes: readonly T[];
  readonly defaultTheme: T;
  readonly cathode: Writable<M>;
  readonly cathodeModes: readonly { readonly name: M; readonly summary: string }[];
}

export function createAppearance<T extends ThemeLike, M extends string>(stores: AppearanceStores<T, M>): Appearance {
  const findTheme = (name: string): T | undefined => {
    const lower = name.trim().toLowerCase();
    return stores.themes.find((theme) => theme.name.toLowerCase() === lower);
  };
  return {
    themes: (): readonly ThemeInfo[] =>
      stores.themes.map(({ name, background, foreground }) => ({ name, background, foreground })),
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
    // `reset` restores the default theme, as it always has; the CRT mode stays the visitor's choice.
    resetDefaults() {
      stores.theme.set(stores.defaultTheme);
    },
  };
}
