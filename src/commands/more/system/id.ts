// id: print user and group ids, as coreutils' id does, from /etc/passwd and /etc/group's
// accounts. The body, shared with groups, is in id.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'id',
  category: 'system',
  summary: 'print real and effective user and group ids',
  synopsis: ['id [OPTION]... [USER]...'],
  flags: [
    { short: 'u', long: 'user', description: 'print only the effective user id' },
    { short: 'g', long: 'group', description: 'print only the effective group id' },
    { short: 'G', long: 'groups', description: 'print all group ids' },
    { short: 'n', long: 'name', description: 'print a name instead of a number, with -u, -g or -G' },
    { short: 'r', long: 'real', description: 'print the real id instead of the effective one, with -u, -g or -G' },
  ],
  args: [{ name: 'USER', source: { kind: 'user' }, optional: true, variadic: true }],
  examples: [
    { line: 'id', offline: true },
    { line: 'id -un', note: 'your user name', offline: true },
    { line: 'id has', note: 'the owner', offline: true },
  ],
  seeAlso: ['groups', 'whoami', 'who'],
  load: () => import('./id.run'),
});
