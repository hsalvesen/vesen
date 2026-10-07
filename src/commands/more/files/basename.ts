// basename: strip the folders, and optionally a suffix, from file names, as GNU basename does;
// the body is in basename.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'basename',
  category: 'files',
  summary: 'strip folders and suffix from file names',
  synopsis: ['basename NAME [SUFFIX]', 'basename OPTION... NAME...'],
  flags: [
    { short: 'a', long: 'multiple', description: 'take every NAME as a name' },
    { short: 's', long: 'suffix', description: 'remove SUFFIX too (implies -a)', value: { name: 'SUFFIX', source: { kind: 'free', placeholder: '.txt' } } },
    { short: 'z', long: 'zero', description: 'end each name with NUL, not a newline' },
  ],
  args: [{ name: 'NAME', source: { kind: 'path', accept: 'any' }, variadic: true }],
  examples: [
    { line: 'basename /usr/bin/ls', note: 'ls', offline: true },
    { line: 'basename documents/linux.txt .txt', note: 'linux', offline: true },
    { line: 'basename -s .sh scripts/backup.sh bin/deploy', note: 'several names', offline: true },
  ],
  seeAlso: ['dirname', 'realpath'],
  load: () => import('./basename.run'),
});
