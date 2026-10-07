// uptime: tell how long the system has been running, as procps' uptime does, from /proc/uptime
// and /proc/loadavg. The system booted when the page loaded.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'uptime',
  category: 'system',
  summary: 'tell how long the system has been running',
  synopsis: ['uptime [-p | -s]'],
  flags: [
    { short: 'p', long: 'pretty', description: 'show the uptime in words' },
    { short: 's', long: 'since', description: 'show when the system booted, as yyyy-mm-dd HH:MM:SS' },
  ],
  examples: [
    { line: 'uptime', offline: true },
    { line: 'uptime -p', note: 'in words', offline: true },
    { line: 'uptime -s', note: 'when the page loaded', offline: true },
  ],
  seeAlso: ['w', 'top', 'who'],
  load: () => import('./uptime.run'),
});
