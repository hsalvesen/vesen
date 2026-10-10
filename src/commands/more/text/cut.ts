// cut: remove sections from each line of files. Its body is in cut.run.ts.

import { defineCommand } from '../../../shell/types';

const LIST = { name: 'LIST', source: { kind: 'free', placeholder: 'LIST' } } as const;

export default defineCommand({
  name: 'cut',
  category: 'text',
  summary: 'remove sections from each line of files',
  synopsis: ['cut OPTION... [FILE]...'],
  flags: [
    { short: 'b', long: 'bytes', description: 'select only these bytes', value: LIST },
    { short: 'c', long: 'characters', description: 'select only these characters', value: LIST },
    { short: 'f', long: 'fields', description: 'select only these fields', value: LIST },
    { short: 'd', long: 'delimiter', description: 'use DELIM instead of TAB for field delimiter', value: { name: 'DELIM', source: { kind: 'free', placeholder: 'DELIM' } } },
    { short: 's', long: 'only-delimited', description: 'do not print lines not containing delimiters' },
    { long: 'complement', description: 'complement the set of selected bytes, characters or fields' },
    { long: 'output-delimiter', description: 'use STRING as the output delimiter', value: { name: 'STRING', source: { kind: 'free', placeholder: 'STRING' } } },
    { short: 'n', description: '(ignored)' },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true }],
  examples: [
    { line: 'cut -d : -f 1,7 /etc/passwd', note: 'user names and shells', offline: true },
    { line: 'echo hello world | cut -c 1-5', offline: true },
    { line: 'cut -d = -f 2 config/app.conf', note: 'the values after =', offline: true },
    { line: 'cut -d : -f 1 --complement /etc/group', note: 'everything but the first field', offline: true },
  ],
  seeAlso: ['sort', 'tr', 'grep'],
  load: () => import('./cut.run'),
});
