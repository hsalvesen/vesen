// sed: stream editor for filtering and transforming text. Its body is in sed.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'sed',
  category: 'text',
  summary: 'stream editor for filtering and transforming text',
  synopsis: ['sed [OPTION]... {script-only-if-no-other-script} [FILE]...'],
  flags: [
    { short: 'n', long: 'quiet', key: 'quiet', description: 'suppress automatic printing of pattern space' },
    { long: 'silent', key: 'quiet', description: 'the same as --quiet' },
    { short: 'e', long: 'expression', description: 'add the script to the commands to be executed', value: { name: 'script', source: { kind: 'free', placeholder: 'script' } }, repeatable: true },
    { short: 'f', long: 'file', description: 'add the contents of script-file to the commands', value: { name: 'script-file', source: { kind: 'path', accept: 'file' } }, repeatable: true },
    { short: 'i', long: 'in-place', description: 'edit files in place (makes a backup if SUFFIX is given)', value: { name: 'SUFFIX', optional: true, source: { kind: 'free', placeholder: 'SUFFIX' } } },
    { short: 'E', long: 'regexp-extended', key: 'extended', description: 'use extended regular expressions in the script' },
    { short: 'r', key: 'extended', description: 'the same as -E' },
    { short: 's', long: 'separate', description: 'consider files as separate rather than as a single continuous long stream' },
  ],
  args: [
    { name: 'script', source: { kind: 'free', placeholder: 'script' } },
    { name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true },
  ],
  examples: [
    { line: "echo 'hello world' | sed 's/world/there/'", note: 'replace the first match', offline: true },
    { line: "sed -n '2,4p' documents/linux.txt", note: 'print lines 2 to 4', offline: true },
    { line: "sed '/^#/d' config/app.conf", note: 'delete comment lines', offline: true },
    { line: "echo aaa | sed 's/a/b/2g'", note: 'from the second match on', offline: true },
    { line: "echo 'John Smith' | sed -E 's/(\\w+) (\\w+)/\\2, \\1/'", note: 'swap two words', offline: true },
    { line: "sed -i 's/dark/light/' config/app.conf", note: 'edit a file in place', offline: true },
    { line: "seq 3 | sed -n '1!G;h;$p'", note: 'the lines in reverse', offline: true },
  ],
  seeAlso: ['grep', 'tr', 'cut'],
  load: () => import('./sed.run'),
});
