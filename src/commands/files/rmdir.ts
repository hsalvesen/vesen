// rmdir: remove empty directories, as GNU rmdir does: every operand, -p for the empty parents
// named in the path too, silent on success unless -v. The body is in rmdir.run.ts.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'rmdir',
  category: 'files',
  summary: 'remove empty directories',
  synopsis: ['rmdir [OPTION]... DIRECTORY...'],
  flags: [
    { long: 'ignore-fail-on-non-empty', key: 'ignore', description: 'say nothing about a folder that is not empty' },
    { short: 'p', long: 'parents', description: 'remove DIRECTORY and its named parents: rmdir -p a/b/c is rmdir a/b/c a/b a' },
    { short: 'v', long: 'verbose', description: 'print a message for each folder removed' },
  ],
  args: [{ name: 'DIRECTORY', source: { kind: 'path', accept: 'dir', includeParent: true }, variadic: true }],
  examples: [
    { line: 'mkdir empty && rmdir empty', offline: true },
    { line: 'rmdir -pv .local/share/applications', note: 'and the empty folders above it', offline: true },
  ],
  seeAlso: ['mkdir', 'rm'],
  load: () => import('./rmdir.run'),
});
