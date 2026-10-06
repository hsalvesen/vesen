// How a span's style tokens become CSS. Palette names read var(--theme-*). Role names read
// var(--role-*), which platform/theme-apply.ts writes, with a palette fallback for the moment
// before it has.

import { TEXT_ROLE_SOURCES } from '../lib/roles';
import { colourVar, isRole, type Colour, type Palette, type Role, type SpanStyle } from '../output/model';

/** The palette colour each role falls back to: the slot it is computed from (lib/roles.ts). */
export const ROLE_FALLBACK: Readonly<Record<Role, Palette>> = {
  ...TEXT_ROLE_SOURCES,
  'chip-bg': 'black',
  'chip-fg': 'foreground',
  ghost: 'brightBlack',
  selection: 'brightBlack',
  cursor: 'foreground',
  'qr-ink': 'foreground',
  'qr-paper': 'background',
};

/** A colour token as a CSS value: `var(--theme-cyan)`, or `var(--role-error, var(--theme-red))`. */
export function cssColour(colour: Colour): string {
  if (!isRole(colour)) return colourVar(colour);
  return `var(--role-${colour}, ${colourVar(ROLE_FALLBACK[colour])})`;
}

/** The class names for a span's text attributes; colours go through `spanCss`. */
export function spanClasses(style: SpanStyle | undefined): string {
  if (style === undefined) return '';
  const classes: string[] = [];
  if (style.bold) classes.push('b');
  if (style.dim) classes.push('dim');
  if (style.italic) classes.push('i');
  if (style.underline) classes.push('u');
  if (style.strike) classes.push('s');
  return classes.join(' ');
}

/** Inline colour declarations for a span, swapping foreground and background when inverse. */
export function spanCss(style: SpanStyle | undefined): string | undefined {
  if (style === undefined) return undefined;
  let fg = style.fg === undefined ? undefined : cssColour(style.fg);
  let bg = style.bg === undefined ? undefined : cssColour(style.bg);
  if (style.inverse) {
    [fg, bg] = [bg ?? 'var(--theme-background)', fg ?? 'var(--theme-foreground)'];
  }
  const declarations = [
    ...(fg === undefined ? [] : [`color: ${fg}`]),
    ...(bg === undefined ? [] : [`background-color: ${bg}`]),
  ];
  return declarations.length === 0 ? undefined : declarations.join('; ');
}
