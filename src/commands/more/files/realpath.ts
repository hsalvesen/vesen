// realpath: print the resolved absolute path, as GNU realpath does; the body is in
// realpath.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'realpath',
  category: 'files',
  summary: 'print the resolved absolute path',
  synopsis: ['realpath [OPTION]... FILE...'],
  flags: [
    { short: 'e', long: 'canonicalize-existing', description: 'every part of the path must exist' },
    { short: 'm', long: 'canonicalize-missing', description: 'no part of the path need exist' },
    { short: 's', long: 'strip', description: 'do not follow links: only tidy . and ..' },
    { long: 'no-symlinks', key: 'strip', description: 'the same as -s' },
    { short: 'q', long: 'quiet', description: 'say nothing about most errors' },
    { long: 'relative-to', description: 'print the path relative to DIR', value: { name: 'DIR', source: { kind: 'path', accept: 'dir' } } },
    { short: 'z', long: 'zero', description: 'end each path with NUL, not a newline' },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'any' }, variadic: true }],
  examples: [
    { line: 'realpath .', note: 'where you are, links followed', offline: true },
    { line: 'realpath /home/user/../user/README.md', note: 'a link and .. resolved', offline: true },
    { line: 'realpath -m drafts/new.txt', note: 'need not exist', offline: true },
    { line: 'realpath --relative-to=documents projects', note: '../projects', offline: true },
  ],
  seeAlso: ['readlink', 'basename', 'dirname', 'pwd'],
  load: () => import('./realpath.run'),
});
