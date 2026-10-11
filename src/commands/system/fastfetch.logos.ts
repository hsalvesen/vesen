// fastfetch's logos: art for the visitor's system, loaded only when fastfetch draws one, so they
// stay out of every other chunk. Each is one colour, as the art block draws it, and is traced in
// ASCII letters and punctuation (ui/art-class.ts draws it at the terminal's line height) from a
// silhouette drawn for vesen with scripts/art/logos.py: one fill glyph for the inside (M for the
// apple and the bugdroid, # for the panes, W for the penguin with a . belly) and, at the edges,
// whichever glyph's ink best matches the cell. 25 to 28 columns by 13 or 14 rows.

import type { Colour } from '../../output/model';

export interface Logo {
  readonly art: string;
  /** What a screen reader hears instead of the art. */
  readonly alt: string;
  readonly colour: Colour;
}

const art = (rows: readonly string[]): string => rows.join('\n');

/** An apple: two lobes with a dip between them, a leaf leaning right above it, a bite out of the upper right, a notch between two feet. */
const APPLE = art([
  '               -g@.',
  '              gMM\\',
  '             g@M-',
  '    -gggggg- .-gggggg-',
  '  -gMMMMMMMMggMMMMMMMM.',
  '  @MMMMMMMMMMMMMMMM@-',
  '  $MMMMMMMMMMMMMMMM@',
  ' .gMMMMMMMMMMMMMMMM@_',
  '.@MMMMMMMMMMMMMMMMMMMg,.',
  'JMMMMMMMMMMMMMMMMMMMMMMM@L',
  ' $MMMMMMMMMMMMMMMMMMMMMMM',
  '  -M@MMMMMMMMMMMMMMMM@M\\',
  '     M@MMMM@MM@MMMM@M',
  '       -]7M-  -MM[-',
]);

/** A bugdroid: the dome with two antennae and two eyes, a body, two arms beside it and two legs. */
const ANDROID = art([
  '       \\          /',
  '        \\ -,__,- /',
  '       gg@MMMMMM@gg',
  '     _@MMMMMMMMMMMM@_',
  '     @MMM MMMMMM MMM@',
  '     ----------------',
  ' @M@ MMMMMMMMMMMMMMMM @M@',
  ' MMM MMMMMMMMMMMMMMMM MMM',
  ' MMM MMMMMMMMMMMMMMMM MMM',
  ' ]M[ MMMMMMMMMMMMMMMM ]M[',
  '     %MMMMMMMMMMMMMM@',
  '        ]MM@  ]MM@',
  '        ]MM@  ]MM@',
  '        JWW%  JWW%',
]);

/** Four window panes in perspective, the left edge nearer the vanishing point, so the upper-left pane is the smallest, with a gap between them. */
const WINDOWS = art([
  '                 -,__]######',
  '     .-,__J  ###############',
  '###########  ###############',
  '###########  ###############',
  '###########  ###############',
  '###########  ###############',
  '',
  '###########  ###############',
  '###########  ###############',
  '###########  ###############',
  '7##########  ###############',
  '      --]T7  ###############',
  '                 --[]777####',
]);

/** A penguin: a black head with a lighter face, two eyes and a beak; a body with a lighter belly; flippers out past it; two flat feet. */
const LINUX = art([
  '         -g@WWW@g-',
  '        .@@[-.-]$@.',
  '        .@-O...O-@.',
  '       .ggg..V..ggg',
  '      g@@$-.....-7%@g',
  '    -g@\\.........../$g_',
  '   gW@-.............-@Wy',
  '  qWWF...............qWW-',
  '  4WW@...............gWWF',
  '  JMWWp.............qWW%L',
  '    $WWg-.........-gWWM',
  '     ]%WWggg_,_gg@WW@[',
  '       -]MMW@@@WMM[-',
  ' .=========     =========.',
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
