// chown: change file owner and group, as GNU chown does. Only root gives files away, so the
// visitor's chown to anyone else says 'Operation not permitted'; the body is in chown.run.ts.

import { defineCommand } from '../../../shell/types';
import { ACCOUNTS, GROUPS } from '../../../vfs/identity';

export default defineCommand({
  name: 'chown',
  category: 'files',
  summary: 'change file owner and group',
  synopsis: ['chown [OPTION]... [OWNER][:[GROUP]] FILE...', 'chown [OPTION]... --reference=RFILE FILE...'],
  flags: [
    { short: 'c', long: 'changes', description: 'like verbose, but say only when a change is made' },
    { short: 'f', long: 'silent', description: 'suppress most error messages' },
    { long: 'quiet', key: 'silent', description: 'the same as -f' },
    { short: 'v', long: 'verbose', description: 'say what is done to every file' },
    { short: 'R', long: 'recursive', description: 'change folders and their contents' },
    { short: 'h', long: 'no-dereference', description: "change a link named on the line rather than what it points to; vesen keeps no owner for a link itself, so the link is left as it is" },
    { long: 'reference', description: "use RFILE's owner and group", value: { name: 'RFILE', source: { kind: 'path', accept: 'any' } } },
  ],
  args: [
    {
      name: 'OWNER[:GROUP]',
      source: {
        kind: 'enum',
        values: () => [
          ...ACCOUNTS.map((account) => ({ value: account.name, summary: account.gecos })),
          ...GROUPS.map((group) => ({ value: `:${group.name}`, summary: `group ${group.name}` })),
        ],
      },
    },
    { name: 'FILE', source: { kind: 'path', accept: 'any' }, variadic: true },
  ],
  examples: [
    { line: 'chown guest README.md', note: 'yours already: no change', offline: true },
    { line: 'chown -v guest:guest history.txt', offline: true },
    { line: 'chown -R :guest projects', note: 'the group of a folder and all in it', offline: true },
  ],
  seeAlso: ['chgrp', 'chmod', 'ls'],
  load: () => import('./chown.run'),
});
