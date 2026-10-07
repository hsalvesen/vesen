// lscpu: display information about the CPU, as util-linux's lscpu does, from /proc/cpuinfo and
// the machine the browser reports. The body is in lscpu.run.ts.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'lscpu',
  category: 'system',
  summary: 'display information about the CPU architecture',
  synopsis: ['lscpu'],
  examples: [{ line: 'lscpu', offline: true }],
  seeAlso: ['nproc', 'uname', 'free', 'fastfetch'],
  load: () => import('./lscpu.run'),
});
