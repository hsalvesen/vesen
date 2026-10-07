// tail: the last lines or bytes of each FILE. Its body is in tail.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'tail',
  category: 'text',
  summary: 'output the last part of files',
  helpRank: 6,
  synopsis: ['tail [OPTION]... [FILE]...'],
  numericShortcut: 'lines',
  flags: [
    { short: 'n', long: 'lines', description: 'print the last NUM lines; with +NUM, from line NUM on', value: { name: 'NUM', source: { kind: 'free', placeholder: 'NUM' } } },
    { short: 'c', long: 'bytes', description: 'print the last NUM bytes; with +NUM, from byte NUM on', value: { name: 'NUM', source: { kind: 'free', placeholder: 'NUM' } } },
    { short: 'f', long: 'follow', description: 'follow the file as it grows (not supported here: prints the end once)' },
    { short: 'F', key: 'follow', description: 'the same as --follow' },
    { short: 'q', long: 'quiet', key: 'quiet', description: 'never print headers giving file names' },
    { long: 'silent', key: 'quiet', description: 'the same as --quiet' },
    { short: 'v', long: 'verbose', description: 'always print headers giving file names' },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true }],
  examples: [
    { line: 'tail -n 3 README.md', note: 'the last three lines', offline: true },
    { line: 'seq 10 | tail -n +8', note: 'from line 8 on', offline: true },
    { line: 'tail -2 /etc/passwd', offline: true },
    { line: 'tail -c 12 .bashrc', note: 'the last 12 bytes', offline: true },
  ],
  seeAlso: ['head', 'cat'],
  load: () => import('./tail.run'),
});
