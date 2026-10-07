// chgrp: change the group of files, as GNU chgrp does; the body is in chgrp.run.ts.

import { defineCommand } from '../../../shell/types';
import { GROUPS } from '../../../vfs/identity';

export default defineCommand({
  name: 'chgrp',
  category: 'files',
  summary: 'change the group of files',
  synopsis: ['chgrp [OPTION]... GROUP FILE...', 'chgrp [OPTION]... --reference=RFILE FILE...'],
  flags: [
    { short: 'c', long: 'changes', description: 'like verbose, but say only when a change is made' },
    { short: 'f', long: 'silent', description: 'suppress most error messages' },
    { long: 'quiet', key: 'silent', description: 'the same as -f' },
    { short: 'v', long: 'verbose', description: 'say what is done to every file' },
    { short: 'R', long: 'recursive', description: 'change folders and their contents' },
    { long: 'reference', description: "use RFILE's group", value: { name: 'RFILE', source: { kind: 'path', accept: 'any' } } },
  ],
  args: [
    { name: 'GROUP', source: { kind: 'enum', values: () => GROUPS.map((group) => ({ value: group.name })) } },
    { name: 'FILE', source: { kind: 'path', accept: 'any' }, variadic: true },
  ],
  examples: [
    { line: 'chgrp guest README.md', offline: true },
    { line: 'chgrp -Rv guest documents', note: 'a folder and all in it', offline: true },
  ],
  seeAlso: ['chown', 'chmod', 'ls'],
  load: () => import('./chgrp.run'),
});
