// column: columnate lists. Its body is in column.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'column',
  category: 'text',
  summary: 'columnate lists',
  synopsis: ['column [OPTION]... [FILE]...'],
  flags: [
    { short: 't', long: 'table', description: 'create a table: line up the fields of each line' },
    { short: 's', long: 'separator', description: 'the characters that separate fields with -t (default: white space)', value: { name: 'SEP', source: { kind: 'free', placeholder: 'SEP' } } },
    { short: 'o', long: 'output-separator', description: 'what goes between table columns (default: two spaces)', value: { name: 'STRING', source: { kind: 'free', placeholder: 'STRING' } } },
    { short: 'c', long: 'output-width', description: 'the width to fill (default: the terminal)', value: { name: 'WIDTH', source: { kind: 'int' } } },
    { short: 'x', long: 'fillrows', description: 'fill rows before columns' },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true }],
  examples: [
    { line: 'column -t -s : /etc/passwd', note: 'the user database as a table', offline: true },
    { line: "printf 'name size\\nREADME.md 1K\\nhistory.txt 2K\\n' | column -t", offline: true },
    { line: 'seq 12 | column -c 40', note: 'a list in columns', offline: true },
  ],
  seeAlso: ['fold', 'cut', 'ls'],
  load: () => import('./column.run'),
});
