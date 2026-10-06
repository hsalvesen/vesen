// ctx.fmt: SGR helpers for commands that write text. On the screen the escapes become styles
// (output/sgr.ts); in a pipe or a file the helpers return their input unchanged, so `ls | cat`
// is plain text as on Linux.

import { PALETTE, isRole, safeHref, type Colour } from '../output/model';
import type { Fmt } from './types';

const ESC = '\u001b';

/** SGR foreground codes for the 16 palette colours: 30-37, then 90-97. */
function paletteCode(index: number): number {
  return index < 8 ? 30 + index : 90 + index - 8;
}

/**
 * SGR has no roles, so a role is drawn in the palette colour closest to its meaning: errors in
 * red, success in green, and so on. Roles with no such colour draw in the default colour.
 */
const ROLE_SGR: Readonly<Partial<Record<string, string>>> = {
  error: '31',
  ok: '32',
  warn: '33',
  accent: '36',
  link: '34',
  muted: '2',
  'fg-strong': '1',
  'prompt-user': '33',
  'prompt-host': '32',
  'prompt-path': '34',
  hot: '31',
  cold: '36',
  sun: '33',
  rain: '34',
};

function colourCode(colour: Colour): string | null {
  if (isRole(colour)) return ROLE_SGR[colour] ?? null;
  const index = PALETTE.indexOf(colour);
  return index >= 0 && index < 16 ? String(paletteCode(index)) : null;
}

export function createFmt(enabled: boolean): Fmt {
  const wrap = (open: string, close: string, text: string): string =>
    enabled && text !== '' ? `${ESC}[${open}m${text}${ESC}[${close}m` : text;
  return {
    enabled,
    fg: (colour, text) => {
      const code = colourCode(colour);
      if (code === null) return text;
      // Bold and dim stand in for some roles; they are turned off with 22, colours with 39.
      return wrap(code, code === '1' || code === '2' ? '22' : '39', text);
    },
    bold: (text) => wrap('1', '22', text),
    dim: (text) => wrap('2', '22', text),
    underline: (text) => wrap('4', '24', text),
    link: (href, text = href) => {
      const checked = safeHref(href);
      if (!enabled || checked === null) return text;
      return `${ESC}]8;;${checked}${ESC}\\${text}${ESC}]8;;${ESC}\\`;
    },
  };
}
