// whatis: the one-line summary of each command named, as man-db prints it.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'whatis',
  category: 'shell',
  summary: 'display one-line command summaries',
  description: 'Prints the NAME line of the manual page of each COMMAND.',
  args: [{ name: 'COMMAND', source: { kind: 'command' }, variadic: true }],
  examples: [
    { line: 'whatis ls', offline: true },
    { line: 'whatis cd pwd theme', offline: true },
  ],
  seeAlso: ['apropos', 'man', 'help'],
  load: () => import('./man.run').then(({ whatis }) => ({ run: whatis })),
});
