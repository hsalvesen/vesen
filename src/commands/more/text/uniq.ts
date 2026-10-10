// uniq: report or omit repeated lines. Its body is in uniq.run.ts.

import { defineCommand } from '../../../shell/types';

const N = { name: 'N', source: { kind: 'int' } } as const;

export default defineCommand({
  name: 'uniq',
  category: 'text',
  summary: 'report or omit repeated lines',
  synopsis: ['uniq [OPTION]... [INPUT [OUTPUT]]'],
  flags: [
    { short: 'c', long: 'count', description: 'prefix lines by the number of occurrences' },
    { short: 'd', long: 'repeated', description: 'only print duplicate lines, one for each group' },
    { short: 'D', key: 'all-repeated', description: 'print all duplicate lines' },
    { short: 'u', long: 'unique', description: 'only print unique lines' },
    { short: 'i', long: 'ignore-case', description: 'ignore differences in case when comparing' },
    { short: 'f', long: 'skip-fields', description: 'avoid comparing the first N fields', value: N },
    { short: 's', long: 'skip-chars', description: 'avoid comparing the first N characters', value: N },
    { short: 'w', long: 'check-chars', description: 'compare no more than N characters in lines', value: N },
  ],
  args: [
    { name: 'INPUT', source: { kind: 'path', accept: 'file' }, optional: true },
    { name: 'OUTPUT', source: { kind: 'path' }, optional: true },
  ],
  examples: [
    { line: "printf 'a\\na\\nb\\na\\n' | uniq", note: 'only neighbours are merged', offline: true },
    { line: "printf 'b\\na\\nb\\n' | sort | uniq -c", note: 'count each line', offline: true },
    { line: "printf 'x\\nx\\ny\\n' | uniq -d", note: 'only the repeated ones', offline: true },
    { line: "printf 'Hi\\nhi\\n' | uniq -i", note: 'ignoring case', offline: true },
  ],
  seeAlso: ['sort', 'wc'],
  load: () => import('./uniq.run'),
});
