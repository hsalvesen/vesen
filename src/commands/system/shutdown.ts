// shutdown: poweroff, or reboot with -r. Only `now` works: nothing is ever scheduled.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'shutdown',
  category: 'system',
  summary: 'power off or restart the terminal',
  synopsis: ['shutdown [-r | -P] [now]'],
  description: "poweroff, or reboot with -r. Only 'now' works: nothing is scheduled.",
  interactiveOnly: true,
  flags: [
    { short: 'r', long: 'reboot', description: 'restart rather than power off' },
    { short: 'P', long: 'poweroff', description: 'power off (the default)' },
  ],
  args: [{ name: 'TIME', source: { kind: 'enum', values: () => [{ value: 'now', summary: 'at once' }] }, optional: true }],
  examples: [{ line: 'shutdown now' }, { line: 'shutdown -r now' }, { line: 'shutdown --help', offline: true }],
  seeAlso: ['poweroff', 'reboot'],
  load: () => import('./power.run').then((m) => ({ run: m.shutdown })),
});
