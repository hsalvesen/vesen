// nl: number lines of files. Its body is in nl.run.ts.

import { defineCommand } from '../../../shell/types';

const STYLE = { name: 'STYLE', source: { kind: 'enum', values: () => [{ value: 'a', summary: 'all lines' }, { value: 't', summary: 'non-empty lines' }, { value: 'n', summary: 'no lines' }] } } as const;

export default defineCommand({
  name: 'nl',
  category: 'text',
  summary: 'number lines of files',
  synopsis: ['nl [OPTION]... [FILE]...'],
  flags: [
    { short: 'b', long: 'body-numbering', description: 'use STYLE for numbering body lines (a, t, n or pBRE)', value: STYLE },
    { short: 'h', long: 'header-numbering', description: 'use STYLE for numbering header lines', value: STYLE },
    { short: 'f', long: 'footer-numbering', description: 'use STYLE for numbering footer lines', value: STYLE },
    { short: 'i', long: 'line-increment', description: 'line number increment at each line', value: { name: 'NUMBER', source: { kind: 'int' } } },
    {
      short: 'n',
      long: 'number-format',
      description: 'insert line numbers according to FORMAT: ln, rn or rz',
      value: { name: 'FORMAT', source: { kind: 'enum', values: () => [{ value: 'ln', summary: 'left justified' }, { value: 'rn', summary: 'right justified' }, { value: 'rz', summary: 'right justified, leading zeros' }] } },
    },
    { short: 'p', long: 'no-renumber', description: 'do not reset line numbers for each section' },
    { short: 's', long: 'number-separator', description: 'add STRING after a line number', value: { name: 'STRING', source: { kind: 'free', placeholder: 'STRING' } } },
    { short: 'v', long: 'starting-line-number', description: 'first line number for each section', value: { name: 'NUMBER', source: { kind: 'int' } } },
    { short: 'w', long: 'number-width', description: 'use NUMBER columns for line numbers', value: { name: 'NUMBER', source: { kind: 'int' } } },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true }],
  examples: [
    { line: 'nl .bashrc', note: 'numbers the lines that are not empty', offline: true },
    { line: 'nl -ba -w3 -s ": " .profile', note: 'every line, narrower, with a colon', offline: true },
    { line: 'seq 3 | nl -n rz -w 4', note: 'with leading zeros', offline: true },
  ],
  seeAlso: ['cat', 'wc'],
  load: () => import('./nl.run'),
});
