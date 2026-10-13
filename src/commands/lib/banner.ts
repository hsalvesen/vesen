// The welcome banner: the vesen logo as art (screen readers hear "Vesen logo") with its version,
// what this is, and how to start: type help and press Enter, then tree or the
// README, each a tap away. `banner` prints it, the app shows it at boot
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
}

const MUTED: SpanStyle = { fg: 'muted' };
const STRONG: SpanStyle = { fg: 'fg-strong' };
const ACCENT: SpanStyle = { fg: 'accent' };

/**
 * The banner's blocks: the logo with the version, a blank line, what this is, how to start (type
 * help and press Enter, the same on every keyboard: a phone's names its key go, send, return or
 * an arrow), and where to go next.
 */
export function bannerBlocks({ version }: BannerOptions): Block[] {
  const lines: Line[] = [
    // A blank line between the logo and the words.
    [],
    [out.span('A virtual Linux terminal, with its own file system to explore.', MUTED)],
    [],
    [out.span('Type ', STRONG), out.run('help', 'help', ACCENT), out.span(' and press Enter to see all available commands.', STRONG)],
    [
      out.span('Then try ', STRONG),
      out.run('tree', 'tree', ACCENT),
      out.span(' to explore the file system, or ', STRONG),
      // From home, so the link works from whatever folder it is tapped in.
      out.run('cat README.md', 'cat ~/README.md', ACCENT),
      out.span(' for the story behind it.', STRONG),
    ],
  ];
  // The version after the logo's last row, muted like the line under it.
  return [out.art(BANNER_ART, `Vesen logo, version ${version}`, 'scale', undefined, out.span(`  v${version}`, MUTED)), out.lines(lines)];
}
