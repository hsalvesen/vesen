// tree: list the contents of folders in a tree, drawn with box-drawing lines, with a count of
// folders and files at the end; the body is in tree.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'tree',
  category: 'files',
  // Named in help's short index, where the catalogue's other file tools are counted.
  featured: true,
  summary: 'list folders as a tree',
  synopsis: ['tree [OPTION]... [DIRECTORY]...'],
  flags: [
    { short: 'a', description: 'show hidden files too' },
    { short: 'd', description: 'list folders only' },
    { short: 'f', description: 'print the full path of each file' },
    { short: 'L', description: 'go no deeper than LEVEL folders', value: { name: 'LEVEL', source: { kind: 'free', placeholder: 'LEVEL' } } },
    {
      short: 'I',
      description: 'leave out names matching PATTERN (a|b for either)',
      value: { name: 'PATTERN', source: { kind: 'free', placeholder: "'*.txt'" } },
      repeatable: true,
    },
    { long: 'noreport', description: 'leave out the count of folders and files' },
    { long: 'dirsfirst', description: 'list folders before files' },
  ],
  args: [{ name: 'DIRECTORY', source: { kind: 'path', accept: 'dir' }, optional: true, variadic: true }],
  examples: [
    { line: 'tree', note: 'everything under here', offline: true },
    { line: 'tree -L 1 /', note: 'one level down', offline: true },
    { line: 'tree -a -I .ssh ~', note: 'hidden files, but not .ssh', offline: true },
    { line: 'tree -d projects', note: 'folders only', offline: true },
  ],
  seeAlso: ['ls', 'find', 'du'],
  load: () => import('./tree.run'),
});
