// The welcome banner: the VESEN logo as art (screen readers hear "Vesen logo"), the version and
// author, the keys, and two tappable first steps. `banner` prints it, the app shows it at boot
// before the shell has loaded, and `reset` and `login` put it back, so it lives here, small and
// DOM-free, for the initial chunk to import.

import { out, type Block, type Line, type SpanStyle } from '../../output/model';

/**
 * The VESEN logo, six rows of block letters. scripts/og.mjs reads it from this file for the link
 * preview, so it stays a plain template literal.
 */
export const BANNER_ART = `██╗   ██╗███████╗███████╗███████╗███╗   ██╗
██║   ██║██╔════╝██╔════╝██╔════╝████╗  ██║
██║   ██║█████╗  ███████╗█████╗  ██╔██╗ ██║
╚██╗ ██╔╝██╔══╝  ╚════██║██╔══╝  ██║╚██╗██║
 ╚████╔╝ ███████╗███████║███████╗██║ ╚████║
  ╚═══╝  ╚══════╝╚══════╝╚══════╝╚═╝  ╚═══╝`;

/** The logo in three rows of half blocks, for a terminal under COMPACT_BELOW columns. */
export const BANNER_ART_COMPACT = `█   █ █▀▀▀ █▀▀▀ █▀▀▀ █▄  █
▀▄ ▄▀ █▀▀  ▀▀▀█ █▀▀  █ ▀▄█
  ▀   ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀   ▀`;

/** Below this many columns, the banner is the compact one. */
export const COMPACT_BELOW = 50;

export interface BannerOptions {
  readonly version: string;
  /** The terminal's width in columns. */
  readonly columns: number;
  /** A touch screen has no Tab or arrow keys to mention. */
  readonly touch: boolean;
}

const MUTED: SpanStyle = { fg: 'muted' };
const STRONG: SpanStyle = { fg: 'fg-strong' };
const ACCENT: SpanStyle = { fg: 'accent' };

/** The banner's blocks: the logo, then its lines. */
export function bannerBlocks({ version, columns, touch }: BannerOptions): Block[] {
  const compact = columns < COMPACT_BELOW;
  const lines: Line[] = [
    [out.span(compact ? `vesen v${version} · by Has Salvesen` : `vesen v${version} · a terminal by Has Salvesen`, MUTED)],
    [out.span(touch ? 'help <cmd> for details' : 'Tab completes · ↑ history · help <cmd> for details', MUTED)],
    [],
    [out.span('Type ', STRONG), out.run('help', 'help', ACCENT), out.span(' to see all available commands.', STRONG)],
    [out.span('Type ', STRONG), out.run('cat README.md', 'cat README.md', ACCENT), out.span(' to learn more about this terminal.', STRONG)],
  ];
  return [out.art(compact ? BANNER_ART_COMPACT : BANNER_ART, 'Vesen logo'), out.lines(lines)];
}
