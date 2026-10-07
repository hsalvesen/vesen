// df: report file system space, as GNU df lays it out: vesen's own file system, with its quota,
// and the storage the browser grants this site, as far as the browser says; the body is in
// df.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'df',
  category: 'files',
  summary: 'report file system space',
  synopsis: ['df [OPTION]... [FILE]...'],
  flags: [
    { short: 'h', long: 'human-readable', description: 'sizes in K, M and G' },
    { short: 'k', description: 'sizes in kibibytes (the default)' },
    { short: 'T', long: 'print-type', description: 'show the type of each file system' },
    { long: 'total', description: 'add a grand total' },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'any' }, optional: true, variadic: true }],
  examples: [
    { line: 'df -h', note: 'how full it is', offline: true },
    { line: 'df -hT ~', note: 'where your home is, and its type', offline: true },
  ],
  seeAlso: ['du', 'ls'],
  load: () => import('./df.run'),
});
