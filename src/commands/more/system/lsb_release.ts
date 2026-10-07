// lsb_release: print distribution-specific information, as Debian's lsb_release does, from
// /etc/os-release. The body is in lsb_release.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'lsb_release',
  category: 'system',
  summary: 'print distribution-specific information',
  synopsis: ['lsb_release [OPTION]...'],
  flags: [
    { short: 'a', long: 'all', description: 'print all of the below' },
    { short: 'i', long: 'id', description: 'print the distributor id' },
    { short: 'd', long: 'description', description: 'print the description of the distribution' },
    { short: 'r', long: 'release', description: 'print the release number' },
    { short: 'c', long: 'codename', description: 'print the codename' },
    { short: 's', long: 'short', description: 'print the values only, without their labels' },
  ],
  examples: [
    { line: 'lsb_release -a', offline: true },
    { line: 'lsb_release -sd', note: 'the description alone', offline: true },
  ],
  seeAlso: ['uname', 'fastfetch'],
  load: () => import('./lsb_release.run'),
});
