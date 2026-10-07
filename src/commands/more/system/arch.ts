// arch: print the machine hardware name, as coreutils' arch does: the same as uname -m, whose
// body it shares (uname.run.ts).

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'arch',
  category: 'system',
  summary: 'print the machine hardware name',
  synopsis: ['arch'],
  examples: [{ line: 'arch', note: 'the same as uname -m', offline: true }],
  seeAlso: ['uname', 'lscpu'],
  load: () => import('./uname.run').then(({ runArch, archDoc }) => ({ run: runArch, doc: archDoc })),
});
