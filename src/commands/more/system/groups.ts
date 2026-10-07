// groups: print the groups a user is in, as coreutils' groups does. Its body is id's
// (id.run.ts), which reads the same accounts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'groups',
  category: 'system',
  summary: 'print the groups a user is in',
  synopsis: ['groups [USER]...'],
  args: [{ name: 'USER', source: { kind: 'user' }, optional: true, variadic: true }],
  examples: [
    { line: 'groups', offline: true },
    { line: 'groups has root', offline: true },
  ],
  seeAlso: ['id', 'whoami'],
  load: () => import('./id.run').then(({ runGroups, groupsDoc }) => ({ run: runGroups, doc: groupsDoc })),
});
