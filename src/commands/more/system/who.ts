// who: show who is logged on, as coreutils' who does: you, on the terminal you type in, since
// the page loaded. The body is in who.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'who',
  category: 'system',
  summary: 'show who is logged on',
  synopsis: ['who [OPTION]... [am i]'],
  flags: [
    { short: 'b', long: 'boot', description: 'time of last system boot' },
    { short: 'q', long: 'count', description: 'all login names and the number of users logged on' },
    { short: 'H', long: 'heading', description: 'print a line of column headings' },
    { short: 'm', description: 'only the user on the terminal standard input is on' },
  ],
  args: [{ name: 'am i', source: { kind: 'free', placeholder: 'am i' }, optional: true, variadic: true }],
  examples: [
    { line: 'who', offline: true },
    { line: 'who -b', note: 'when the page booted', offline: true },
    { line: 'who am i', offline: true },
  ],
  seeAlso: ['w', 'whoami', 'uptime'],
  load: () => import('./who.run'),
});
