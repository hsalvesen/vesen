// lolcat: copies text to the terminal in the colours of the rainbow, from the theme's palette. In a
// pipe or a file it copies the text unchanged. The body is in lolcat.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'lolcat',
  category: 'fun',
  summary: 'colour text with the rainbow',
  synopsis: ['lolcat [-p SPREAD] [-F FREQ] [-S SEED] [FILE]...'],
  featured: false,
  flags: [
    { short: 'p', long: 'spread', description: 'characters per step of colour (3 unless given)', value: { name: 'SPREAD', source: { kind: 'free', placeholder: '3' } } },
    { short: 'F', long: 'freq', description: 'how fast the colours change (0.3 unless given)', value: { name: 'FREQ', source: { kind: 'free', placeholder: '0.3' } } },
    { short: 'S', long: 'seed', description: 'where in the rainbow to start (at random unless given)', value: { name: 'SEED', source: { kind: 'int' } } },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true }],
  examples: [
    { line: 'fortune | lolcat', note: 'a saying in colour', offline: true },
    { line: 'figlet vesen | lolcat', note: 'big letters in colour', offline: true },
    { line: 'lolcat -p 1 -F 0.6 .bashrc', note: 'a file, in narrow bands', offline: true },
  ],
  seeAlso: ['cat', 'figlet', 'cowsay'],
  load: () => import('./lolcat.run'),
});
