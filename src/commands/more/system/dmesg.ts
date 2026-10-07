// dmesg: print the kernel's messages, as util-linux's dmesg does: how vesen booted on this
// device, and what /var/log/syslog kept from boot. The body is in dmesg.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'dmesg',
  category: 'system',
  summary: "print the kernel's messages",
  synopsis: ['dmesg [-t | -T]'],
  flags: [
    { short: 't', long: 'notime', description: 'do not print the time of each message' },
    { short: 'T', long: 'ctime', description: 'print the time of each message as a date' },
    { short: 'k', long: 'kernel', description: "print the kernel's messages (the default)" },
    { short: 'c', long: 'read-clear', description: 'clear the messages after printing them (root only)' },
    { short: 'C', long: 'clear', description: 'clear the messages (root only)' },
  ],
  examples: [
    { line: 'dmesg', offline: true },
    { line: 'dmesg -T', note: 'with dates', offline: true },
  ],
  seeAlso: ['uname', 'uptime'],
  load: () => import('./dmesg.run'),
});
