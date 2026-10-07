// figlet's one font: block letters five rows high, drawn for vesen. A-Z (lower case is drawn as
// upper case), 0-9 and the common punctuation; anything else is drawn as `?`. Each glyph is five
// rows of the same width, `#` for ink; letters sit one column apart and words a space glyph
// apart. Loaded only with figlet's body.

import { textWidth } from '../../output/model';

/** The font's height in rows. */
export const FONT_HEIGHT = 5;

/** What the ink is drawn with. */
export const INK = '█';

/** The glyphs, by character: five rows each, every row the same width. */
const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: [' ## ', '#  #', '####', '#  #', '#  #'],
  B: ['### ', '#  #', '### ', '#  #', '### '],
  C: [' ###', '#   ', '#   ', '#   ', ' ###'],
  D: ['### ', '#  #', '#  #', '#  #', '### '],
  E: ['####', '#   ', '### ', '#   ', '####'],
  F: ['####', '#   ', '### ', '#   ', '#   '],
  G: [' ###', '#   ', '# ##', '#  #', ' ###'],
  H: ['#  #', '#  #', '####', '#  #', '#  #'],
  I: ['###', ' # ', ' # ', ' # ', '###'],
  J: ['  ##', '   #', '   #', '#  #', ' ## '],
  K: ['#  #', '# # ', '##  ', '# # ', '#  #'],
  L: ['#   ', '#   ', '#   ', '#   ', '####'],
  M: ['#   #', '## ##', '# # #', '#   #', '#   #'],
  N: ['#   #', '##  #', '# # #', '#  ##', '#   #'],
  O: [' ## ', '#  #', '#  #', '#  #', ' ## '],
  P: ['### ', '#  #', '### ', '#   ', '#   '],
  Q: [' ## ', '#  #', '#  #', '# ##', ' ###'],
  R: ['### ', '#  #', '### ', '# # ', '#  #'],
  S: [' ###', '#   ', ' ## ', '   #', '### '],
  T: ['#####', '  #  ', '  #  ', '  #  ', '  #  '],
  U: ['#  #', '#  #', '#  #', '#  #', ' ## '],
  V: ['#   #', '#   #', '#   #', ' # # ', '  #  '],
  W: ['#   #', '#   #', '# # #', '## ##', '#   #'],
  X: ['#   #', ' # # ', '  #  ', ' # # ', '#   #'],
  Y: ['#   #', ' # # ', '  #  ', '  #  ', '  #  '],
  Z: ['####', '   #', ' ## ', '#   ', '####'],

  0: [' ## ', '# ##', '#  #', '## #', ' ## '],
  1: [' # ', '## ', ' # ', ' # ', '###'],
  2: [' ## ', '#  #', '  # ', ' #  ', '####'],
  3: ['### ', '   #', ' ## ', '   #', '### '],
  4: ['#  #', '#  #', '####', '   #', '   #'],
  5: ['####', '#   ', '### ', '   #', '### '],
  6: [' ## ', '#   ', '### ', '#  #', ' ## '],
  7: ['####', '   #', '  # ', ' #  ', ' #  '],
  8: [' ## ', '#  #', ' ## ', '#  #', ' ## '],
  9: [' ## ', '#  #', ' ###', '   #', ' ## '],

  ' ': ['   ', '   ', '   ', '   ', '   '],
  '.': [' ', ' ', ' ', ' ', '#'],
  ',': ['  ', '  ', '  ', ' #', '# '],
  '!': ['#', '#', '#', ' ', '#'],
  '?': [' ## ', '#  #', '  # ', '    ', '  # '],
  "'": ['#', '#', ' ', ' ', ' '],
  '"': ['# #', '# #', '   ', '   ', '   '],
  '`': ['# ', ' #', '  ', '  ', '  '],
  '-': ['   ', '   ', '###', '   ', '   '],
  _: ['    ', '    ', '    ', '    ', '####'],
  ':': [' ', '#', ' ', '#', ' '],
  ';': ['  ', ' #', '  ', ' #', '# '],
  '/': ['    #', '   # ', '  #  ', ' #   ', '#    '],
  '\\': ['#    ', ' #   ', '  #  ', '   # ', '    #'],
  '|': ['#', '#', '#', '#', '#'],
  '(': [' #', '# ', '# ', '# ', ' #'],
  ')': ['# ', ' #', ' #', ' #', '# '],
  '[': ['##', '# ', '# ', '# ', '##'],
  ']': ['##', ' #', ' #', ' #', '##'],
  '{': [' ##', ' # ', '#  ', ' # ', ' ##'],
  '}': ['## ', ' # ', '  #', ' # ', '## '],
  '<': ['  #', ' # ', '#  ', ' # ', '  #'],
  '>': ['#  ', ' # ', '  #', ' # ', '#  '],
  '+': ['   ', ' # ', '###', ' # ', '   '],
  '=': ['   ', '###', '   ', '###', '   '],
  '*': ['   ', '# #', ' # ', '# #', '   '],
  '^': [' # ', '# #', '   ', '   ', '   '],
  '~': ['    ', ' # #', '# # ', '    ', '    '],
  '#': [' # # ', '#####', ' # # ', '#####', ' # # '],
  '@': [' ### ', '#   #', '# ###', '# ## ', ' ####'],
  '&': [' ##  ', '#  # ', ' ## #', '#  # ', ' ## #'],
  '%': ['##  #', '## # ', '  #  ', ' # ##', '#  ##'],
  $: [' ####', '# #  ', ' ### ', '  # #', '#### '],
};

/** The characters the font draws, for its tests and its manual. */
export const FONT_CHARACTERS: readonly string[] = Object.keys(GLYPHS);

/** The glyph for `ch`: lower case as upper case, an accented letter as its plain one, else `?`. */
export function glyph(ch: string): readonly string[] {
  const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  return GLYPHS[plain] ?? GLYPHS[ch] ?? GLYPHS['?'] ?? [];
}

/** How wide a glyph is, in columns. */
function glyphWidth(rows: readonly string[]): number {
  return rows[0]?.length ?? 0;
}

/** Glyphs side by side, one column apart, as FONT_HEIGHT rows. */
function joinGlyphs(glyphs: readonly (readonly string[])[]): string[] {
  const rows: string[] = [];
  for (let r = 0; r < FONT_HEIGHT; r += 1) rows.push(glyphs.map((g) => g[r] ?? '').join(' '));
  return rows;
}

/** The width of `text` drawn in the font, in columns. */
export function drawnWidth(text: string): number {
  const chars = Array.from(text);
  if (chars.length === 0) return 0;
  return chars.reduce((sum, ch) => sum + glyphWidth(glyph(ch)), 0) + chars.length - 1;
}

/**
 * The characters of one line of text in bands that fit `width` columns: whole words where they
 * fit, and a word wider than the width cut between letters. Spaces between words that start a
 * new band are dropped.
 */
export function bands(text: string, width: number): string[] {
  const words = text.split(/ +/).filter((word) => word !== '');
  const result: string[] = [];
  let band = '';
  for (const word of words) {
    const joined = band === '' ? word : `${band} ${word}`;
    if (drawnWidth(joined) <= width) {
      band = joined;
      continue;
    }
    if (band !== '') result.push(band);
    band = '';
    // A word too wide on its own is cut where it must be.
    let piece = '';
    for (const ch of word) {
      if (piece !== '' && drawnWidth(piece + ch) > width) {
        result.push(piece);
        piece = '';
      }
      piece += ch;
    }
    band = piece;
  }
  if (band !== '' || result.length === 0) result.push(band);
  return result;
}

export interface FigletOptions {
  /** The width to fit, in columns. */
  readonly width: number;
  readonly align: 'left' | 'center' | 'right';
}

/** One band drawn: FONT_HEIGHT rows, aligned in the width, trailing spaces trimmed. */
function drawBand(band: string, options: FigletOptions): string[] {
  const rows = joinGlyphs(Array.from(band).map(glyph));
  const width = Math.max(0, ...rows.map((row) => row.length));
  const room = Math.max(0, options.width - width);
  const pad = ' '.repeat(options.align === 'center' ? Math.floor(room / 2) : options.align === 'right' ? room : 0);
  return rows.map((row) => `${pad}${row}`.replace(/#/g, INK).trimEnd());
}

/**
 * `text` in the font, as figlet draws it: each line of the text, and each band a line needs to
 * fit the width, as FONT_HEIGHT rows, with a blank row between bands.
 */
export function figlet(text: string, options: FigletOptions): string {
  const width = Math.max(1, options.width);
  const drawn: string[][] = [];
  for (const line of text.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n')) {
    const clean = line.replace(/\t/g, ' ').replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
    for (const band of bands(clean, width)) drawn.push(drawBand(band, { ...options, width }));
  }
  return drawn.map((rows) => rows.join('\n')).join('\n\n');
}

/** The widest row of some drawn text, in cells. */
export function artWidth(text: string): number {
  return Math.max(0, ...text.split('\n').map((row) => textWidth(row)));
}
