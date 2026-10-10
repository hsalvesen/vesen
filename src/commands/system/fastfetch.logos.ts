// fastfetch's logos: art for the visitor's system, loaded only when fastfetch draws one, so they
// stay out of every other chunk. Each is one colour, as the art block draws it, in block and
// quadrant characters for line height 1 (ui/art-class.ts), where the rows touch: every cell is
// two pixels by two of a bitmap, and the shades ░ and ▒ are the lighter tones of the one colour.
// Each is drawn for vesen from simple shapes, about 20 columns by 11 to 13 rows.

import type { Colour } from '../../output/model';

export interface Logo {
  readonly art: string;
  /** What a screen reader hears instead of the art. */
  readonly alt: string;
  readonly colour: Colour;
}

const art = (rows: readonly string[]): string => rows.join('\n');

/** An apple: its leaf above the dent, a bite out of the right side, two bumps at the foot. */
const APPLE = art([
  '            ▄▖',
  '          ▗██▘',
  '         ▗█▛',
  '   ▗▄▄▄▄▄  ▄▄▄▄▄▖',
  '  ▟█████████████▛',
  ' ▟██████████████',
  ' ███████████████',
  ' ███████████████▙',
  ' █████████████████▙',
  ' ▜████████████████▛',
  '  ▀██████████████▀',
  '    ▀▜████████▛▀',
  '        ▀  ▀',
]);

/** A bugdroid's head: the dome, two antennae and two eyes. */
const ANDROID = art([
  '   ▖            ▗',
  '   ▜▖          ▗▛',
  '    ▙          ▟',
  '    ▝▌▗▄████▄▖▐▘',
  '    ▗██████████▖',
  '   ▗████████████▖',
  '  ▗██▛▀██████▀▜██▖',
  '  ▟██▙▄██████▄▟██▙',
  ' ▗████████████████▖',
  ' ▐████████████████▌',
]);

/** Four window panes seen in perspective, the left edge nearer and shorter, with a gap between them. */
const WINDOWS = art([
  '             ▄▄▄▄▟██',
  '    ▄▄▄▄▖▐██████████',
  '████████▌▐██████████',
  '████████▌▐██████████',
  '████████▌▐██████████',
  '▄▄▄▄▄▄▄▄▖▗▄▄▄▄▄▄▄▄▄▄',
  '████████▌▐██████████',
  '████████▌▐██████████',
  '████████▌▐██████████',
  '    ▀▀▀▀▘▐██████████',
  '             ▀▀▀▀▜██',
]);

/** A penguin: a round body with a light belly, two eyes, a mid-toned beak and feet. */
const LINUX = art([
  '      ▗▄▟██▙▄▖',
  '     ▟██▀██▀██▙',
  '    ▐██▙ ▟▙ ▟██▌',
  '    ▝███▒▒▒▒███▘',
  '    ▟████▒▒████▙',
  ' ▗█████▛▀▀▀▀▜█████▖',
  '▐████▛░░░░░░░░▜████▌',
  '█████░░░░░░░░░░█████',
  '████▌░░░░░░░░░░▐████',
  '████▙░░░░░░░░░░▟████',
  '▀▀ ▜█▙░░░░░░░░▟█▛ ▀▀',
  '    ▝▀▀░░░░░░▀▀▘',
  '   ▒▒▒▒▒    ▒▒▒▒▒',
]);

/** The logo for an OS as SysSnapshot names it; Linux's for anything else. */
export function logoFor(os: string): Logo {
  switch (os) {
    case 'macOS':
    case 'iOS':
    case 'iPadOS':
      return { art: APPLE, alt: `${os} logo`, colour: 'green' };
    case 'Android':
      return { art: ANDROID, alt: 'Android logo', colour: 'green' };
    case 'Windows':
      return { art: WINDOWS, alt: 'Windows logo', colour: 'blue' };
    default:
      return { art: LINUX, alt: 'Linux logo', colour: 'yellow' };
  }
}
