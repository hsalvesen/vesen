// xargs: build and run command lines from standard input. Its body is in xargs.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'xargs',
  category: 'text',
  summary: 'build and run command lines from standard input',
  synopsis: ['xargs [OPTION]... [COMMAND [INITIAL-ARGS]...]'],
  posixArgs: true,
  flags: [
    { short: '0', long: 'null', description: 'items are separated by a null, not whitespace' },
    { short: 'a', long: 'arg-file', description: 'read arguments from FILE, not standard input', value: { name: 'FILE', source: { kind: 'path', accept: 'file' } } },
    { short: 'd', long: 'delimiter', description: 'items in the input are separated by CHARACTER, not by blanks', value: { name: 'CHARACTER', source: { kind: 'free', placeholder: 'CHARACTER' } } },
    { short: 'I', key: 'replace', description: 'replace R in INITIAL-ARGS with each line read from standard input', value: { name: 'R', source: { kind: 'free', placeholder: '{}' } } },
    { short: 'L', long: 'max-lines', description: 'use at most MAX-LINES non-blank input lines per command line', value: { name: 'MAX-LINES', source: { kind: 'int' } } },
    { short: 'n', long: 'max-args', description: 'use at most MAX-ARGS arguments per command line', value: { name: 'MAX-ARGS', source: { kind: 'int' } } },
    { short: 'r', long: 'no-run-if-empty', description: 'if there are no arguments, do not run COMMAND' },
    { short: 't', long: 'verbose', description: 'print commands before executing them' },
  ],
  args: [{ name: 'COMMAND', source: { kind: 'commandLine' }, optional: true, variadic: true }],
  examples: [
    { line: 'ls | xargs -n1 echo', note: 'one echo for each name', offline: true },
    { line: 'echo README.md .profile | xargs wc -l', note: 'names from a pipe as arguments', offline: true },
    { line: "printf 'a\\nb\\n' | xargs -I {} echo 'item {}'", note: 'each line in its place', offline: true },
    { line: 'seq 6 | xargs -n 2', note: 'two at a time, with echo', offline: true },
  ],
  seeAlso: ['echo', 'grep', 'sed'],
  load: () => import('./xargs.run'),
});
