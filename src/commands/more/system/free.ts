// free: show the amount of free and used memory, as procps' free does, from /proc/meminfo:
// the total is the browser's rounded figure for the device. The body is in free.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'free',
  category: 'system',
  summary: 'show the amount of free and used memory',
  synopsis: ['free [OPTION]...'],
  flags: [
    { short: 'b', long: 'bytes', description: 'show output in bytes' },
    { short: 'k', long: 'kibi', description: 'show output in kibibytes (the default)' },
    { short: 'm', long: 'mebi', description: 'show output in mebibytes' },
    { short: 'g', long: 'gibi', description: 'show output in gibibytes' },
    { short: 'h', long: 'human', description: 'show output in units people read: B, Ki, Mi, Gi' },
    { short: 't', long: 'total', description: 'show a total for memory and swap' },
    { short: 'w', long: 'wide', description: 'show buffers and cache in columns of their own' },
  ],
  examples: [
    { line: 'free -h', offline: true },
    { line: 'free -m -t', note: 'mebibytes, with a total', offline: true },
  ],
  seeAlso: ['top', 'ps', 'fastfetch'],
  load: () => import('./free.run'),
});
