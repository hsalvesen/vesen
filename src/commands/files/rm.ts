// rm: remove files or directories, as GNU rm does (F017, F020): every operand, -r to remove
// folders and what is in them (depth first, so -v and -i can name each one), -f to say nothing
// about what is missing, -d for empty folders, -i to ask first. `.`, `..` and `/` are refused in
// GNU's words before anything is touched. Silent on success unless -v.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'rm',
  category: 'files',
  summary: 'remove files or directories',
  synopsis: ['rm [OPTION]... FILE...'],
  flags: [
    { short: 'd', long: 'dir', description: 'remove empty folders' },
    { short: 'f', long: 'force', description: 'ignore files that do not exist, and never ask' },
    { short: 'i', key: 'interactive', description: 'ask before every removal' },
    { short: 'r', long: 'recursive', description: 'remove folders and their contents' },
    { short: 'R', key: 'recursive', description: 'the same as -r' },
    { short: 'v', long: 'verbose', description: 'say what is being removed' },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'any' }, variadic: true }],
  examples: [
    { line: 'rm history.txt', offline: true },
    { line: 'rm -r downloads', note: 'a folder and everything in it', offline: true },
    { line: 'rm -rf ~/projects', note: 'no questions, no complaints', offline: true },
    { line: 'rm -v README.md', note: 'say what went', offline: true },
  ],
  seeAlso: ['rmdir', 'mv', 'ls'],
  load: () => import('./rm.run'),
});
