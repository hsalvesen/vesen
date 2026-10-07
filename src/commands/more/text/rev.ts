// rev: reverse the characters of each line. The first command in the catalogue
// (src/commands/more), which loads after the kernel; its body is in rev.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'rev',
  category: 'text',
  summary: 'reverse the characters of each line',
  synopsis: ['rev [FILE]...'],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true }],
  examples: [
    { line: 'echo hello | rev', note: 'olleh', offline: true },
    { line: "printf 'one\\ntwo\\n' | rev", note: 'line by line', offline: true },
    { line: 'rev .bashrc', note: 'a file, each line backwards', offline: true },
  ],
  seeAlso: ['cat', 'echo'],
  load: () => import('./rev.run'),
});
