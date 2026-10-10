// sort: sort lines of text files. Its body is in sort.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'sort',
  category: 'text',
  summary: 'sort lines of text files',
  synopsis: ['sort [OPTION]... [FILE]...'],
  usageStatus: 2,
  flags: [
    { short: 'b', long: 'ignore-leading-blanks', description: 'ignore leading blanks' },
    { short: 'd', long: 'dictionary-order', description: 'consider only blanks and alphanumeric characters' },
    { short: 'f', long: 'ignore-case', description: 'fold lower case to upper case characters' },
    { short: 'g', long: 'general-numeric-sort', description: 'compare according to general numerical value' },
    { short: 'h', long: 'human-numeric-sort', description: 'compare human readable numbers (e.g., 2K 1G)' },
    { short: 'i', long: 'ignore-nonprinting', description: 'consider only printable characters' },
    { short: 'M', long: 'month-sort', description: "compare (unknown) < 'JAN' < ... < 'DEC'" },
    { short: 'n', long: 'numeric-sort', description: 'compare according to string numerical value' },
    { short: 'R', long: 'random-sort', description: 'shuffle, but group identical keys' },
    { short: 'r', long: 'reverse', description: 'reverse the result of comparisons' },
    { short: 'V', long: 'version-sort', description: 'natural sort of (version) numbers within text' },
    { short: 'c', long: 'check', description: 'check for sorted input; do not sort' },
    { short: 'C', key: 'quiet-check', description: 'like -c, but do not report the first bad line' },
    { short: 'k', long: 'key', description: 'sort via a key; KEYDEF gives location and type', value: { name: 'KEYDEF', source: { kind: 'free', placeholder: 'F[.C][OPTS][,F[.C][OPTS]]' } }, repeatable: true },
    { short: 'o', long: 'output', description: 'write result to FILE instead of standard output', value: { name: 'FILE', source: { kind: 'path' } } },
    { short: 's', long: 'stable', description: 'stabilize sort by disabling last-resort comparison' },
    { short: 't', long: 'field-separator', description: 'use SEP instead of non-blank to blank transition', value: { name: 'SEP', source: { kind: 'free', placeholder: 'SEP' } } },
    { short: 'u', long: 'unique', description: 'output only the first of an equal run' },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true }],
  examples: [
    { line: 'sort /etc/shells', offline: true },
    { line: 'seq 10 | sort -rn', note: 'numbers, largest first', offline: true },
    { line: 'sort -t : -k 3,3n /etc/passwd', note: 'by the third field, as numbers', offline: true },
    { line: "printf '2K\\n1G\\n512\\n' | sort -h", note: 'sizes as people write them', offline: true },
    { line: 'cut -d : -f 7 /etc/passwd | sort | uniq -c', note: 'how many of each shell', offline: true },
  ],
  seeAlso: ['uniq', 'cut', 'tr'],
  load: () => import('./sort.run'),
});
