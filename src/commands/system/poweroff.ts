// poweroff: systemd's shutdown lines, a fade, then '● vesen is off' with Power on, which starts a
// new session with the files kept. It never leaves a dead page (F029), and only a line typed at
// the prompt can set it off.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'poweroff',
  category: 'system',
  summary: 'shut down the terminal',
  description: 'Shuts vesen down, then offers Power on: a new session that keeps your files and history.',
  interactiveOnly: true,
  examples: [{ line: 'poweroff' }, { line: 'poweroff --help', offline: true }],
  seeAlso: ['reboot', 'shutdown', 'exit'],
  load: () => import('./power.run').then((m) => ({ run: m.poweroff })),
});
