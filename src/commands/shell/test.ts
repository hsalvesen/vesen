// test and [: evaluate a condition and exit 0 when it holds, 1 when it does not and 2 on a
// mistake, as bash's builtin does. With && and || it stands in for if, which vesen does not have:
//
//   [ -f notes.txt ] && cat notes.txt || echo 'no notes'
//
// The grammar is POSIX test's with bash's extras: ! ( ) -a -o, the file tests, the string and
// integer comparisons, and -nt -ot -ef.

import type { RawArgsSpec } from '../../shell/flags';
import { defineCommand, type CommandSpec, type RunnerChoice } from '../../shell/types';

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'test',
  aliases: ['['],
  category: 'shell',
  // A usage error exits 2, as bash builtins do.
  usageStatus: 2,
  summary: 'check a condition: files, strings, numbers',
  synopsis: ['test EXPRESSION', '[ EXPRESSION ]'],
  rawArgs: true,
  handlesHelp: true,
  args: [{ name: 'EXPRESSION', source: { kind: 'free', placeholder: 'expression' }, optional: true, variadic: true }],
  examples: [
    { line: '[ -f README.md ] && echo yes', offline: true },
    { line: 'test -d projects && cd projects', offline: true },
    { line: '[ 3 -gt 2 ] && echo bigger', offline: true },
    { line: '[ -z "$NOPE" ] && echo empty', offline: true },
  ],
  seeAlso: ['true', 'false'],
  load: () => import('./test.run'),
};

export default defineCommand(spec);
