// file: determine file type from what a file holds and, for the pictures and archives the seed
// stands in for, its name; the body is in file.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'file',
  category: 'files',
  summary: 'determine file type',
  synopsis: ['file [OPTION]... FILE...'],
  flags: [
    { short: 'b', long: 'brief', description: 'do not print the file names' },
    { short: 'i', long: 'mime', description: 'print MIME types, such as text/plain; charset=us-ascii' },
    { long: 'mime-type', description: 'print only the MIME type' },
    { short: 'L', long: 'dereference', description: 'follow symbolic links' },
    { short: 'h', long: 'no-dereference', description: 'do not follow symbolic links (the default)' },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'any' }, variadic: true }],
  examples: [
    { line: 'file *', note: 'everything here', offline: true },
    { line: 'file bin/deploy src/main.c .ssh', offline: true },
    { line: 'file -i README.md', note: 'as a MIME type', offline: true },
  ],
  seeAlso: ['stat', 'ls'],
  load: () => import('./file.run'),
});
