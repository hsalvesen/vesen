// readlink: print where a symbolic link points, or a canonical path with -f, -e or -m, as GNU
// readlink does; the body is in readlink.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'readlink',
  category: 'files',
  summary: 'print where a link points',
  synopsis: ['readlink [OPTION]... FILE...'],
  flags: [
    { short: 'f', long: 'canonicalize', description: 'follow every link; all but the last part must exist' },
    { short: 'e', long: 'canonicalize-existing', description: 'follow every link; every part must exist' },
    { short: 'm', long: 'canonicalize-missing', description: 'follow every link; no part need exist' },
    { short: 'n', long: 'no-newline', description: 'print no newline after the path' },
    { short: 'q', long: 'quiet', description: 'say nothing about errors (the default)' },
    { short: 's', long: 'silent', key: 'quiet', description: 'the same as -q' },
    { short: 'v', long: 'verbose', description: 'report errors' },
    { short: 'z', long: 'zero', description: 'end each path with NUL, not a newline' },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'any' }, variadic: true }],
  examples: [
    { line: 'readlink /bin', note: 'usr/bin', offline: true },
    { line: 'readlink -f /home/user', note: 'the whole way: /home/guest', offline: true },
    { line: 'readlink -v README.md || echo not a link', offline: true },
  ],
  seeAlso: ['realpath', 'ln', 'stat'],
  load: () => import('./readlink.run'),
});
