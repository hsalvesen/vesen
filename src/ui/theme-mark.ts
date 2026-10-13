// The mark on a colour theme's chip, in the dock and in the Tab list: a small circle, filled for
// the theme in use and hollow for the rest, so the current one shows without its colour too. The
// chips draw it bold in the current theme's accent, and follow the theme store, so the mark moves
// the moment the theme changes.

/** Beside the theme in use. */
export const CURRENT_THEME_MARK = '•';

/** Beside every other theme. */
export const THEME_MARK = '◦';

/** A theme chip names the theme in use: names match in any case. */
export function isCurrentTheme(label: string, current: string): boolean {
  return label.toLowerCase() === current.toLowerCase();
}

/** What a screen reader hears for the theme in use: the chip's own name, and that it is current. */
export function currentThemeName(name: string): string {
  return `${name}, the current theme`;
}
