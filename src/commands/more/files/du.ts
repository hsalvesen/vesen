// du: estimate the space files take, as GNU du does, from the sizes in the file system; the body
// is in du.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'du',
  category: 'files',
  summary: 'estimate the space files take',
  synopsis: ['du [OPTION]... [FILE]...'],
  flags: [
    { short: 'a', long: 'all', description: 'count files as well as folders' },
    { short: 'b', long: 'bytes', description: 'sizes in bytes, as files report them (--apparent-size)' },
    { long: 'apparent-size', description: 'sizes as files report them, not the blocks they take' },
    { short: 'c', long: 'total', description: 'add a grand total' },
    {
      short: 'd',
      long: 'max-depth',
      description: 'show a folder only N or fewer levels below the FILE',
      value: { name: 'N', source: { kind: 'free', placeholder: 'N' } },
    },
    { short: 'h', long: 'human-readable', description: 'sizes in K, M and G' },
    { short: 'k', description: 'sizes in kibibytes (the default)' },
    { short: 's', long: 'summarize', description: 'only a total for each FILE' },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'any' }, optional: true, variadic: true }],
  examples: [
    { line: 'du -sh ~', note: 'how much your home takes', offline: true },
    { line: 'du -h -d 1', note: 'each folder here', offline: true },
    { line: 'du -ach projects', note: 'files too, and a total', offline: true },
  ],
  seeAlso: ['df', 'ls', 'tree'],
  load: () => import('./du.run'),
});
