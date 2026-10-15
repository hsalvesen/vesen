// nyancat: Nyan Cat flies across the screen, its rainbow behind it, to a chiptune, until q, Esc,
// ^C, Back or a tap. The animation is K. Lange's nyancat (lib/nyancat.ts), drawn in ASCII in the
// cat's own colours; the track is the owner's (commands/lib/nyancat.ts); the show runs in the Nyan
// app (src/ui/apps/Nyan.svelte). The track is readied inside the Enter or tap that runs the line,
// so a browser that lets sound start only from a gesture plays it. The body is nyancat.run.ts.

import { defineCommand } from '../../../shell/types';
import { NYAN_TRACK } from '../../lib/nyancat';

export default defineCommand({
  name: 'nyancat',
  category: 'fun',
  summary: 'Nyan Cat flies across the screen, to a chiptune',
  synopsis: ['nyancat [-n] [-f FRAMES]'],
  featured: false,
  flags: [
    { short: 'n', long: 'no-counter', description: 'leave out the line that counts how long you have nyaned' },
    { short: 'f', long: 'frames', description: 'stop after FRAMES frames (14 a second)', value: { name: 'FRAMES', source: { kind: 'int' } } },
  ],
  examples: [
    { line: 'nyancat', note: 'q, Esc or a tap ends it' },
    { line: 'nyancat -n', note: 'without the counter' },
    { line: 'nyancat | cat', note: 'in a pipe, the cat standing still', offline: true },
  ],
  seeAlso: ['cmatrix', 'figlet'],
  plays: () => NYAN_TRACK,
  load: () => import('./nyancat.run'),
});
