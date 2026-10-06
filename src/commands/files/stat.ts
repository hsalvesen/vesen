// stat: display file status in GNU stat's layout, or as a -c FORMAT says. A link is described
// itself unless -L follows it. The VFS keeps one time per file, so access, modify and change
// times agree, and there is no birth time.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'stat',
  category: 'files',
  summary: 'display file status',
  synopsis: ['stat [OPTION]... FILE...'],
  description:
    "Shows each FILE's size, blocks, permissions, owner, group and times. -c picks the facts and their layout with %-directives: %n name, %s size, %A permissions, %U owner, %G group, %y modified, %F type.",
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
  man: [
    {
      heading: 'FORMAT',
      body: '%a permissions in octal, %A in ls form, %b blocks, %F file type, %g and %G group, %u and %U owner, %h links, %i inode, %n name, %N quoted name and link target, %s size in bytes, %y modified, %Y modified in seconds since 1970, %% a percent sign. A width goes between: %-8U.',
    },
    { heading: 'EXIT STATUS', body: '0 when every FILE was found, 1 otherwise.' },
  ],
  load: () => import('./stat.run'),
});
