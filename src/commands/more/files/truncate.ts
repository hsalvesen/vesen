// truncate: shrink or extend the size of a file, as GNU truncate does; the body is in
// truncate.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'truncate',
  category: 'files',
  summary: 'shrink or extend the size of a file',
  synopsis: ['truncate OPTION... FILE...'],
  flags: [
    { short: 'c', long: 'no-create', description: 'do not create any files' },
    { short: 'r', long: 'reference', description: "use RFILE's size", value: { name: 'RFILE', source: { kind: 'path', accept: 'file' } } },
    {
      short: 's',
      long: 'size',
      description: 'set or adjust the size by SIZE bytes',
      value: { name: 'SIZE', source: { kind: 'free', placeholder: '0' } },
    },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, variadic: true }],
  examples: [
    { line: 'truncate -s 0 history.txt', note: 'empty it', offline: true },
    { line: 'truncate -s 1K blank.txt', note: 'a new file of 1024 NUL bytes', offline: true },
    { line: 'truncate -s -10 README.md', note: 'ten bytes shorter', offline: true },
  ],
  seeAlso: ['touch', 'du', 'stat'],
  load: () => import('./truncate.run'),
});
