// lolcat's colouring: each character takes a colour from the theme's palette, stepping round the
// rainbow along the line and a little further on each line, so the bands run diagonally. Pure,
// so a test can draw a line without a terminal.

import { out, type Line, type Palette } from '../../output/model';

/** The palette colours lolcat steps through, in rainbow order, each hue then its bright twin. */
export const RAINBOW: readonly Palette[] = [
  'red',
  'brightRed',
  'yellow',
  'brightYellow',
  'green',
  'brightGreen',
  'cyan',
  'brightCyan',
  'blue',
  'brightBlue',
  'purple',
  'brightPurple',
];

export interface RainbowOptions {
  /** Characters per step along a line: bigger is wider bands. */
  readonly spread: number;
  /** How far round the rainbow one step goes, in radians: bigger changes colour faster. */
  readonly freq: number;
  /** Where the first line starts, in steps. */
  readonly seed: number;
}

export const DEFAULT_SPREAD = 3;
export const DEFAULT_FREQ = 0.3;

/** The palette colour of the character at `column` on line `row`. */
export function colourAt(row: number, column: number, options: RainbowOptions): Palette {
  const angle = options.freq * (options.seed + row + column / options.spread);
  const turn = angle / (2 * Math.PI);
  const index = Math.floor((turn - Math.floor(turn)) * RAINBOW.length) % RAINBOW.length;
  return RAINBOW[index] ?? 'red';
}

/** One line of text in colour: runs of characters of one colour share a span. */
export function rainbowLine(text: string, row: number, options: RainbowOptions): Line {
  const spans: { text: string; fg: Palette }[] = [];
  let column = 0;
  for (const ch of text) {
    const fg = colourAt(row, column, options);
    const last = spans[spans.length - 1];
    if (last !== undefined && last.fg === fg) last.text += ch;
    else spans.push({ text: ch, fg });
    column += 1;
  }
  return spans.map((span) => out.span(span.text, { fg: span.fg }));
}
