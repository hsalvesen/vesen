// uname: print system information, as coreutils' uname does. The kernel is vesen's; the machine
// is the visitor's device as the browser describes it. The body is in uname.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'uname',
  category: 'system',
  summary: 'print system information',
  helpRank: 2,
  synopsis: ['uname [OPTION]...'],
  flags: [
    { short: 'a', long: 'all', description: 'print all information, leaving out -p and -i if unknown' },
    { short: 's', long: 'kernel-name', description: 'print the kernel name' },
    { short: 'n', long: 'nodename', description: 'print the network node host name' },
    { short: 'r', long: 'kernel-release', description: 'print the kernel release' },
    { short: 'v', long: 'kernel-version', description: 'print the kernel version' },
    { short: 'm', long: 'machine', description: 'print the machine hardware name' },
    { short: 'p', long: 'processor', description: 'print the processor type' },
    { short: 'i', long: 'hardware-platform', description: 'print the hardware platform' },
    { short: 'o', long: 'operating-system', description: 'print the operating system' },
  ],
  examples: [
    { line: 'uname -a', offline: true },
    { line: 'uname -r', note: 'the kernel release', offline: true },
    { line: 'uname -m', note: 'your device, as the browser describes it', offline: true },
  ],
  seeAlso: ['hostname', 'arch', 'lsb_release', 'fastfetch'],
  load: () => import('./uname.run'),
});
