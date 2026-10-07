// top: display processes, as procps' top does in batch mode: the summary and the process
// table, once (or -n times). Interactive top is not available. The body is in top.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'top',
  category: 'system',
  summary: 'display processes, as one snapshot',
  helpRank: 4,
  synopsis: ['top [-b] [-n NUMBER] [-d SECONDS]'],
  flags: [
    { short: 'b', description: 'batch mode: print and exit, as vesen always does' },
    { short: 'n', description: 'the number of snapshots to print', value: { name: 'NUMBER', source: { kind: 'int' }, default: '1' } },
    { short: 'd', description: 'the seconds between snapshots', value: { name: 'SECONDS', source: { kind: 'free', placeholder: '3.0' }, default: '3' } },
  ],
  loadingLabel: () => 'top: waiting for the next snapshot',
  examples: [
    { line: 'top', offline: true },
    { line: 'top -b -n 1', note: 'as scripts ask for it', offline: true },
  ],
  seeAlso: ['ps', 'uptime', 'free', 'kill'],
  load: () => import('./top.run'),
});
