// head: the first lines or bytes of each FILE. Its body is in head.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'head',
  category: 'text',
  summary: 'output the first part of files',
  synopsis: ['head [OPTION]... [FILE]...'],
  numericShortcut: 'lines',
  flags: [
    { short: 'n', long: 'lines', description: 'print the first NUM lines; with a leading -, all but the last NUM', value: { name: 'NUM', source: { kind: 'free', placeholder: 'NUM' } } },
    { short: 'c', long: 'bytes', description: 'print the first NUM bytes; with a leading -, all but the last NUM', value: { name: 'NUM', source: { kind: 'free', placeholder: 'NUM' } } },
    { short: 'q', long: 'quiet', key: 'quiet', description: 'never print headers giving file names' },
    { long: 'silent', key: 'quiet', description: 'the same as --quiet' },
    { short: 'v', long: 'verbose', description: 'always print headers giving file names' },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true }],
  examples: [
    { line: 'head -n 3 README.md', note: 'the first three lines', offline: true },
    { line: 'head -5 documents/linux.txt', offline: true },
    { line: 'seq 10 | head -n -7', note: 'all but the last seven', offline: true },
    { line: 'head -c 20 .bashrc', note: 'the first 20 bytes', offline: true },
    { line: 'head -n 1 .bashrc .profile', note: 'with a header for each', offline: true },
  ],
  seeAlso: ['tail', 'cat', 'sed'],
  load: () => import('./head.run'),
});
