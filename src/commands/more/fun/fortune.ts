// fortune: a short saying about computers, terminals or the themes' animals, chosen at random.
// The sayings are in commands/lib/fortunes.ts, loaded with the body (fortune.run.ts).

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'fortune',
  category: 'fun',
  summary: 'print a random saying',
  synopsis: ['fortune [-s]'],
  featured: false,
  flags: [{ short: 's', long: 'short', description: 'only short ones: a single line of 60 characters or fewer' }],
  examples: [
    { line: 'fortune', note: 'a saying', offline: true },
    { line: 'fortune -s', note: 'a short one', offline: true },
    { line: 'fortune | cowsay', note: 'said by a cow', offline: true },
  ],
  seeAlso: ['cowsay', 'lolcat'],
  next: ({ status }) => (status === 0 ? ['fortune'] : []),
  load: () => import('./fortune.run'),
});
