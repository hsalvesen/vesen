// The welcome banner: the VESEN logo as art (screen readers hear "Vesen logo"), the version and
// author, how to start (the keys on a keyboard, the chips on touch), and three tappable first
// steps (F074): help, the README and the file system. `banner` prints it, the app shows it at boot
// before the shell has loaded, and `reset` and `login` put it back, so it lives here, small and
// DOM-free, for the initial chunk to import.

import { out, type Block, type Line, type SpanStyle } from '../../output/model';

/**
 * The VESEN logo, one row to a string: lower-case letters in the style of figlet's Roman, with
 * `o` serifs, `888` stems and bowls of `d...b` and `Y...P`, drawn narrower than the font draws
 * them (the counters of v, e, s and n closed up a column or two, the arch of n down to one), five
 * rows of 46 columns. Letters and punctuation, so it is drawn at the terminal's line height
 * (ui/art-class.ts), and the same on every screen: the art block scales it down where the
 * terminal is narrower. scripts/og.mjs reads these rows for the link preview.
 */
export const BANNER_ROWS: readonly string[] = [
  'oooo  ooo  .oooo.  .oooo.o  .oooo.  ooo. .oo.',
  ' `88..8\'  d88\' `8b d88( "8 d88\' `8b `888P"Y8b',
  '  `88.8\'  888ooo88 `"Y8b.  888ooo88  888  888',
  '   `88\'   888   .o o. )88b 888   .o  888  888',
  '    `8\'   `Y8bodP\' 8""88P\' `Y8bodP\' o888  888o',
];

/** The logo as the art block draws it. */
export const BANNER_ART = BANNER_ROWS.join('\n');

export interface BannerOptions {
  readonly version: string;
  /** A touch screen has no Tab or arrow keys to mention; it has the chips in the dock. */
  readonly touch: boolean;
}

/** Under the first steps on a keyboard: the keys a terminal has. */
export const KEYS_HINT = 'Tab completes a command, the up arrow brings the last one back, and help <cmd> explains any of them.';
/** Under the first steps on touch, where the dock's chips run commands. */
export const TOUCH_HINT = 'Tap a chip below to run it, or type a command.';

/** The owner's name, never split across lines. */
const OWNER = 'Has\u00a0Salvesen';

const MUTED: SpanStyle = { fg: 'muted' };
const STRONG: SpanStyle = { fg: 'fg-strong' };
const ACCENT: SpanStyle = { fg: 'accent' };

/**
 * The logo with the version after its last row of letters, on the same line (the last row with
 * anything but spaces and colons, so a shadow row drawn under the letters would be skipped).
 */
export function withVersion(art: string, version: string): string {
  const rows = art.split('\n');
  let last = rows.length - 1;
  while (last > 0 && !/[^ :]/u.test(rows[last] ?? '')) last -= 1;
  rows[last] = `${rows[last]}  v${version}`;
  return rows.join('\n');
}

/**
 * The banner's blocks: the logo with the version, then who made it, the first steps for someone
 * new (help, then tree and the README), and the keys, or the chips on touch.
 */
export function bannerBlocks({ version, touch }: BannerOptions): Block[] {
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
  return [out.art(withVersion(BANNER_ART, version), `Vesen logo, version ${version}`), out.lines(lines)];
}
