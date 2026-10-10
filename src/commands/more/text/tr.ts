// tr: translate, squeeze or delete characters. Its body is in tr.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'tr',
  category: 'text',
  summary: 'translate or delete characters',
  synopsis: ['tr [OPTION]... STRING1 [STRING2]'],
  flags: [
    { short: 'c', long: 'complement', key: 'complement', description: 'use the complement of STRING1' },
    { short: 'C', key: 'complement', description: 'the same as -c' },
    { short: 'd', long: 'delete', description: 'delete characters in STRING1, do not translate' },
    { short: 's', long: 'squeeze-repeats', description: 'replace each run of a repeated character in the last STRING with one' },
    { short: 't', long: 'truncate-set1', description: 'first truncate STRING1 to the length of STRING2' },
  ],
  args: [
    { name: 'STRING1', source: { kind: 'free', placeholder: 'set' } },
    { name: 'STRING2', source: { kind: 'free', placeholder: 'set' }, optional: true },
  ],
  examples: [
    { line: 'echo hello | tr a-z A-Z', note: 'HELLO', offline: true },
    { line: "echo 'hello world' | tr -d lo", note: 'delete letters', offline: true },
    { line: "echo 'too    many   spaces' | tr -s ' '", note: 'squeeze runs of spaces', offline: true },
    { line: "echo 'a1b2c3' | tr -cd '[:digit:]'", note: 'keep only the digits', offline: true },
    { line: "echo 'one two' | tr ' ' '\\n'", note: 'one word a line', offline: true },
  ],
  seeAlso: ['sed', 'cut'],
  load: () => import('./tr.run'),
});
