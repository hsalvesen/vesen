// wc: count lines, words and bytes. Its body is in wc.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'wc',
  category: 'text',
  summary: 'print newline, word, and byte counts',
  synopsis: ['wc [OPTION]... [FILE]...'],
  flags: [
    { short: 'l', long: 'lines', description: 'print the newline counts' },
    { short: 'w', long: 'words', description: 'print the word counts' },
    { short: 'm', long: 'chars', description: 'print the character counts' },
    { short: 'c', long: 'bytes', description: 'print the byte counts' },
    { short: 'L', long: 'max-line-length', description: 'print the maximum display width' },
    {
      long: 'total',
      description: 'when to print a line with total counts: auto, always, only or never',
      value: { name: 'WHEN', source: { kind: 'enum', values: () => ['auto', 'always', 'only', 'never'].map((value) => ({ value })) } },
    },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true }],
  examples: [
    { line: 'wc README.md', note: 'lines, words and bytes', offline: true },
    { line: 'wc -l .bashrc .profile', note: 'lines, with a total', offline: true },
    { line: 'echo one two three | wc -w', offline: true },
    { line: 'cat README.md | grep -i theme | wc -l', note: 'how many lines mention themes', offline: true },
  ],
  seeAlso: ['cat', 'grep'],
  load: () => import('./wc.run'),
});
