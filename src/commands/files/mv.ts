// mv: move (rename) files, as GNU mv does: SOURCE to DEST, or SOURCEs into a folder; -n to keep
// what is there; silent unless -v. Moving the folder you are in leaves the prompt where it was,
// as on Linux, until you cd somewhere real.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'mv',
  category: 'files',
  summary: 'move or rename files',
  synopsis: ['mv [OPTION]... SOURCE DEST', 'mv [OPTION]... SOURCE... DIRECTORY'],
  description:
    'Renames SOURCE to DEST, or moves each SOURCE into DIRECTORY. A file at DEST is replaced, unless -n is given. It prints nothing when it works; -v says what moved.',
  flags: [
    { short: 'f', long: 'force', description: 'do not ask before overwriting (mv never asks here)' },
    { short: 'n', long: 'no-clobber', description: 'do not overwrite a file that exists' },
    { short: 'v', long: 'verbose', description: 'say what is being moved' },
  ],
  // SOURCE... DEST: the last word is the destination, so the one variadic argument covers both.
  args: [{ name: 'SOURCE', source: { kind: 'path', accept: 'any' }, variadic: true }],
  examples: [
    { line: 'mv history.txt documents/', note: 'into a folder', offline: true },
    { line: 'mv -v README.md readme.md', note: 'rename', offline: true },
  ],
  seeAlso: ['cp', 'rm', 'ln'],
  man: [{ heading: 'EXIT STATUS', body: '0 when everything was moved, 1 otherwise.' }],
  load: () => import('./mv.run'),
});
