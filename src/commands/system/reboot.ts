// reboot: the shutdown lines, then straight back up: a new session with the files kept.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'reboot',
  category: 'system',
  summary: 'restart the terminal',
  description: 'Shuts vesen down and starts a new session, keeping your files and history.',
  interactiveOnly: true,
  examples: [{ line: 'reboot' }, { line: 'reboot --help', offline: true }],
  seeAlso: ['poweroff', 'shutdown'],
  load: () => import('./power.run').then((m) => ({ run: m.reboot })),
});
