// dirname: strip the last part from file names, as GNU dirname does; the body is in
// dirname.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'dirname',
  category: 'files',
  summary: 'strip the last part from file names',
  synopsis: ['dirname [OPTION] NAME...'],
  flags: [{ short: 'z', long: 'zero', description: 'end each name with NUL, not a newline' }],
  args: [{ name: 'NAME', source: { kind: 'path', accept: 'any' }, variadic: true }],
  examples: [
    { line: 'dirname /usr/bin/ls', note: '/usr/bin', offline: true },
    { line: 'dirname documents/linux.txt README.md', note: 'documents, then .', offline: true },
  ],
  seeAlso: ['basename', 'realpath'],
  load: () => import('./dirname.run'),
});
