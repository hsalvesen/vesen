// w: show who is logged on and what they are doing, as procps' w does. The body is in w.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'w',
  category: 'system',
  summary: 'show who is logged on and what they are doing',
  synopsis: ['w [OPTION]... [USER]'],
  flags: [
    { short: 'h', long: 'no-header', description: 'do not print the header' },
    { short: 's', long: 'short', description: 'use the short format' },
  ],
  args: [{ name: 'USER', source: { kind: 'user' }, optional: true }],
  examples: [
    { line: 'w', offline: true },
    { line: 'w -h', note: 'without the header', offline: true },
  ],
  seeAlso: ['who', 'uptime', 'ps'],
  load: () => import('./w.run'),
});
