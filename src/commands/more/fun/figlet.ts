// figlet: text in big block letters, in the one font drawn for vesen (commands/lib/block-font.ts),
// which loads with the body (figlet.run.ts).

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'figlet',
  category: 'fun',
  summary: 'write text in big block letters',
  synopsis: ['figlet [-c | -l | -r] [-w WIDTH] [TEXT]...'],
  featured: false,
  flags: [
    { short: 'w', long: 'width', description: "fit WIDTH columns (the screen's width, or 80 in a pipe)", value: { name: 'WIDTH', source: { kind: 'int' } } },
    { short: 'c', long: 'center', description: 'centre each line in the width' },
    { short: 'l', long: 'left', description: 'line up on the left (the default)' },
    { short: 'r', long: 'right', description: 'line up on the right' },
  ],
  args: [{ name: 'TEXT', source: { kind: 'free', placeholder: 'TEXT' }, optional: true, variadic: true }],
  examples: [
    { line: 'figlet vesen', note: 'big letters', offline: true },
    { line: 'figlet -c -w 40 hi there', note: 'centred in 40 columns', offline: true },
    { line: 'date +%H:%M | figlet', note: 'a big clock', offline: true },
    { line: 'figlet hello | lolcat', note: 'in colour', offline: true },
  ],
  seeAlso: ['banner', 'lolcat', 'cowsay'],
  load: () => import('./figlet.run'),
});
