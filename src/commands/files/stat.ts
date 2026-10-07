// stat: display file status in GNU stat's layout, or as a -c FORMAT says. A link is described
// itself unless -L follows it. The VFS keeps one time per file, so access, modify and change
// times agree, and there is no birth time.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'stat',
  category: 'files',
  summary: 'display file status',
  synopsis: ['stat [OPTION]... FILE...'],
  flags: [
    { short: 'L', long: 'dereference', description: 'follow links' },
    {
      short: 'c',
      long: 'format',
      description: 'use FORMAT instead of the default layout, with a newline after each file',
      value: { name: 'FORMAT', source: { kind: 'free', placeholder: '%n %s' } },
    },
    {
      long: 'printf',
      description: 'like --format, but read backslash escapes and add no newline',
      value: { name: 'FORMAT', source: { kind: 'free', placeholder: '%n\\n' } },
    },
  ],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'any' }, variadic: true }],
  examples: [
    { line: 'stat README.md', offline: true },
    { line: "stat -c '%A %U %s %n' .bashrc /etc/passwd", note: 'pick the facts', offline: true },
    { line: 'stat /home/user', note: 'a link, itself', offline: true },
  ],
  seeAlso: ['ls', 'touch'],
  load: () => import('./stat.run'),
});
