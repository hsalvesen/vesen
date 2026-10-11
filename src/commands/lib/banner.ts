// The welcome banner: the VESEN logo as art (screen readers hear "Vesen logo"), the version and
// author, how to start (the keys on a keyboard, the chips on touch), and three tappable first
// steps (F074): help, the README and the file system. `banner` prints it, the app shows it at boot
// before the shell has loaded, and `reset` and `login` put it back, so it lives here, small and
// DOM-free, for the initial chunk to import.

import { out, type Block, type Line, type SpanStyle } from '../../output/model';

/**
 * The VESEN logo: a bold italic wordmark in six rows of block and quadrant characters, 43
 * columns wide. Each cell is two pixels by two of a bitmap whose letters have four-pixel stems
 * and lean one pixel to the right every two rows, so the diagonals step by half a cell and read
 * as smooth slants. scripts/og.mjs reads it from this file for the link preview, so it stays a
 * plain template literal. Drawn at line height 1 (ui/art-class.ts), where the rows touch.
 */
export const BANNER_ART = `▐█▌   ▐█▌▐██████▌ ▟█████▌▐██████▌▐█▙▖   ▐█▌
▐█▌  ▐█▌ ██      ██      ██      ██▜▙   ██
▐█▌ ▐█▌ ▐█████▌  ▜█████▖▐█████▌ ▐█▌▝█▖ ▐█▌
▐█▌▐█▌  ██           ██ ██      ██  ▜▙ ██
▐███▌  ▐█▌          ▐█▌▐█▌     ▐█▌  ▝█▟█▌
▝██▘   ███████ ██████▀ ███████ ██    ▀██`;

/**
 * The same wordmark at half the size, three rows and 26 columns, with the same lean, for a
 * terminal under COMPACT_BELOW columns (a phone).
 */
export const BANNER_ART_COMPACT = `█   █ █▀▀▀ ▟▀▀▀ █▀▀▀ █▖  █
█ ▗▛ ▐▛▀▀ ▝▀▀▜▖▐▛▀▀ ▐▛▙ ▐▌
█▟▘  █▄▄▄ ▄▄▄▛ █▄▄▄ █ ▜▄█`;

/** Below this many columns, the banner is the compact one. */
export const COMPACT_BELOW = 50;

export interface BannerOptions {
  readonly version: string;
  /** The terminal's width in columns. */
  readonly columns: number;
  /** A touch screen has no Tab or arrow keys to mention; it has the chips in the dock. */
  readonly touch: boolean;
}

/** Under the first steps on a keyboard: the keys a terminal has. */
export const KEYS_HINT = 'Tab completes a command, ↑ brings the last one back, and help <cmd> explains any of them.';
/** Under the first steps on touch, where the dock's chips run commands. */
export const TOUCH_HINT = 'Tap a chip below to run it, or type a command.';

/** The owner's name, never split across lines. */
const OWNER = 'Has\u00a0Salvesen';

const MUTED: SpanStyle = { fg: 'muted' };
const STRONG: SpanStyle = { fg: 'fg-strong' };
const ACCENT: SpanStyle = { fg: 'accent' };

/**
 * The logo with the version after its last row of letters, on the same line (the last row that
 * holds a block character, so a shadow row drawn with other marks under the letters is skipped).
 */
export function withVersion(art: string, version: string): string {
  const rows = art.split('\n');
  let last = rows.length - 1;
  while (last > 0 && !/[\u2580-\u259F]/u.test(rows[last] ?? '')) last -= 1;
  rows[last] = `${rows[last]}  v${version}`;
  return rows.join('\n');
}

/**
 * The banner's blocks: the logo with the version, then who made it, the first steps for someone
 * new (help, then tree and the README), and the keys, or the chips on touch.
 */
export function bannerBlocks({ version, columns, touch }: BannerOptions): Block[] {
  const compact = columns < COMPACT_BELOW;
  const lines: Line[] = [
    // No-break spaces keep the name whole when the line wraps on a 320px screen.
    [out.span(`A terminal in your browser, by ${OWNER}.`, MUTED)],
    [],
    [out.span('New here? Type ', STRONG), out.run('help', 'help', ACCENT), out.span(' to see all available commands.', STRONG)],
    [
      out.span('Then try ', STRONG),
      out.run('tree', 'tree', ACCENT),
      out.span(' to look around the virtual file system, or ', STRONG),
      // From home, so the link works from whatever folder it is tapped in.
      out.run('cat README.md', 'cat ~/README.md', ACCENT),
      out.span(' for the story behind it.', STRONG),
    ],
    [out.span(touch ? TOUCH_HINT : KEYS_HINT, MUTED)],
  ];
  return [out.art(withVersion(compact ? BANNER_ART_COMPACT : BANNER_ART, version), `Vesen logo, version ${version}`), out.lines(lines)];
}
