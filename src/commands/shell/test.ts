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
  description:
    "Exits 0 when EXPRESSION is true, 1 when it is false and 2 when it is malformed, printing nothing. With && and || it stands in for if: [ -d projects ] && cd projects. '[' needs a closing ']'.",
  rawArgs: true,
  handlesHelp: true,
  args: [{ name: 'EXPRESSION', source: { kind: 'free', placeholder: 'expression' }, optional: true, variadic: true }],
  man: [
    {
      heading: 'FILES',
      body: '-e FILE exists; -f a regular file; -d a directory; -L or -h a symbolic link; -c a character device; -r, -w, -x readable, writable, executable by you; -s not empty; -O, -G owned by your user, your group; FILE1 -nt FILE2 newer, -ot older, -ef the same file.',
    },
    {
      heading: 'STRINGS AND NUMBERS',
      body: '-z STRING empty; -n STRING, or STRING alone, not empty; S1 = S2, S1 != S2, S1 < S2, S1 > S2; N1 -eq N2, -ne, -lt, -le, -gt, -ge for whole numbers.',
    },
    { heading: 'COMBINING', body: '! EXPR not; EXPR1 -a EXPR2 and; EXPR1 -o EXPR2 or; ( EXPR ) groups.' },
  ],
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
