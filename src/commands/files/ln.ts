// ln: make links, as GNU ln -s does: TARGET to LINK_NAME, TARGET into the working directory, or
// TARGETs into a folder. The target is stored as typed, so a relative one is read from where
// the link is. The VFS has no hard links, so ln without -s says so in Linux's words.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'ln',
  category: 'files',
  summary: 'make links between files',
  synopsis: ['ln -s [OPTION]... TARGET [LINK_NAME]', 'ln -s [OPTION]... TARGET... DIRECTORY'],
  description:
    'With -s, makes LINK_NAME a symbolic link to TARGET: opening the link opens TARGET. With no LINK_NAME, the link is made here, with TARGET\'s name; with a DIRECTORY, inside it. A relative TARGET is read from the folder the link is in. Hard links are not available here, so -s is needed.',
  flags: [
    { short: 'f', long: 'force', description: 'replace a file that is already at LINK_NAME' },
    { short: 's', long: 'symbolic', description: 'make symbolic links' },
    { short: 'v', long: 'verbose', description: 'print the name of each link made' },
  ],
  args: [
    { name: 'TARGET', source: { kind: 'path', accept: 'any' } },
    { name: 'LINK_NAME', source: { kind: 'path', accept: 'any' }, optional: true, variadic: true },
  ],
  examples: [
    { line: 'ln -s documents/linux.txt linux', note: 'linux now opens documents/linux.txt', offline: true },
    { line: 'ln -sv /etc/hostname', note: 'a link called hostname, here', offline: true },
  ],
  seeAlso: ['ls', 'stat', 'cp'],
  man: [{ heading: 'EXIT STATUS', body: '0 when every link was made, 1 otherwise.' }],
  load: () => import('./ln.run'),
});
