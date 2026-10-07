// man: a command's manual, generated from its spec: NAME, SYNOPSIS, DESCRIPTION, OPTIONS,
// EXAMPLES and SEE ALSO, laid out to the terminal's width (at most 80 columns), as man-db lays a
// page out. On the terminal it opens in the pager, as man does; in a pipe, or where the pager
// cannot open, it prints. `man vesen` is the about page, and -k and -f are apropos and whatis.
// The bodies of man, apropos and whatis are in man.run.ts.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'man',
  category: 'shell',
  summary: 'show the manual page of a command',
  helpRank: 2,
  synopsis: ['man [SECTION] PAGE...', 'man -k KEYWORD...', 'man -f PAGE...'],
  flags: [
    { short: 'k', long: 'apropos', description: 'search the commands for KEYWORD, as apropos does' },
    { short: 'f', long: 'whatis', description: 'print the one-line summary of PAGE, as whatis does' },
  ],
  args: [{ name: 'PAGE', source: { kind: 'command' }, variadic: true }],
  examples: [
    { line: 'man ls', offline: true },
    { line: 'man vesen', note: 'about this terminal', offline: true },
    { line: 'man -k file', note: 'commands about files', offline: true },
  ],
  seeAlso: ['help', 'whatis', 'apropos'],
  load: () => import('./man.run'),
});
