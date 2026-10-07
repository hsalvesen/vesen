// ifconfig: the network interfaces in net-tools' layout, the same as ip addr shows
// (commands/lib/interfaces.ts): eth0 synthetic and marked so, and the public address from
// Cloudflare, said first. It reads its own words, as ifconfig does (ifconfig eth0 up).

import type { RawArgsSpec } from '../../../shell/flags';
import type { CommandSpec, RunnerChoice } from '../../../shell/types';

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'ifconfig',
  category: 'network',
  summary: 'show the network interfaces',
  synopsis: ['ifconfig [-a] [INTERFACE]'],
  rawArgs: true,
  flags: [{ short: 'a', description: 'every interface, down ones too' }],
  args: [{ name: 'INTERFACE', source: { kind: 'enum', values: () => [{ value: 'eth0' }, { value: 'lo' }] }, optional: true }],
  loadingLabel: (argv) => (argv.includes('lo') ? 'ifconfig' : 'ifconfig: asking Cloudflare for your public address…'),
  examples: [
    { line: 'ifconfig', note: 'the interfaces, and your public address' },
    { line: 'ifconfig lo', note: 'the loopback only', offline: true },
  ],
  seeAlso: ['ip', 'privacy'],
  load: () => import('./ifconfig.run'),
};

export default spec;
