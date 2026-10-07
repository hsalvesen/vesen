// fold: wrap each input line to fit in a width. Its body is in fold.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'fold',
  category: 'text',
  summary: 'wrap each input line to fit in specified width',
  synopsis: ['fold [OPTION]... [FILE]...'],
  numericShortcut: 'width',
  flags: [
    { short: 'b', long: 'bytes', description: 'count bytes rather than columns' },
    { short: 's', long: 'spaces', description: 'break at spaces' },
    { short: 'w', long: 'width', description: 'use WIDTH columns instead of 80', value: { name: 'WIDTH', source: { kind: 'free', placeholder: '80' } } },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true }],
  examples: [
    { line: 'fold -w 30 README.md', note: 'at most 30 columns a line', offline: true },
    { line: 'fold -s -w 40 documents/linux.txt', note: 'breaking at spaces', offline: true },
    { line: 'echo abcdefghij | fold -w 3', offline: true },
  ],
  seeAlso: ['column', 'cut'],
  load: () => import('./fold.run'),
});
