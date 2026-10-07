// cp: copy files and directories, as GNU cp does: SOURCE to DEST, or SOURCEs into a folder; -r
// for folders, merged into one that is there; -n to keep what is there; silent unless -v.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'cp',
  category: 'files',
  summary: 'copy files and directories',
  synopsis: ['cp [OPTION]... SOURCE DEST', 'cp [OPTION]... SOURCE... DIRECTORY'],
  flags: [
    { short: 'n', long: 'no-clobber', description: 'do not overwrite a file that exists' },
    { short: 'r', long: 'recursive', description: 'copy folders and everything in them' },
    { short: 'R', key: 'recursive', description: 'the same as -r' },
    { short: 'v', long: 'verbose', description: 'say what is being copied' },
  ],
  // SOURCE... DEST: the last word is the destination, so the one variadic argument covers both.
  args: [{ name: 'SOURCE', source: { kind: 'path', accept: 'any' }, variadic: true }],
  examples: [
    { line: 'cp README.md readme-copy.md', offline: true },
    { line: 'cp -r documents backup', note: 'a folder and what is in it', offline: true },
    { line: 'cp -v history.txt .bashrc documents/', note: 'into a folder', offline: true },
  ],
  seeAlso: ['mv', 'ln', 'rm'],
  load: () => import('./cp.run'),
});
