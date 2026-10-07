// apropos: search the commands' names and summaries, as man-db's apropos searches the manual.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'apropos',
  category: 'shell',
  summary: 'search the command summaries',
  description: 'Prints the summary of every command whose name or summary contains a KEYWORD, ignoring case.',
  args: [{ name: 'KEYWORD', source: { kind: 'free', placeholder: 'word' }, variadic: true }],
  examples: [
    { line: 'apropos file', offline: true },
    { line: 'apropos theme', offline: true },
  ],
  seeAlso: ['whatis', 'man', 'help'],
  load: () => import('./man.run').then(({ apropos }) => ({ run: apropos })),
});
