// nslookup: a DNS lookup in nslookup's layout, over DNS over HTTPS (commands/lib/dns.ts). It
// reads its own words, because its options are written -type=MX.

import type { RawArgsSpec } from '../../../shell/flags';
import type { CommandSpec, EnumValue, RunnerChoice } from '../../../shell/types';

const SERVERS: readonly EnumValue[] = [
  { value: 'cloudflare', summary: "Cloudflare's resolver" },
  { value: 'google', summary: "Google's resolver" },
];

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'nslookup',
  category: 'network',
  summary: 'query the DNS for a name, over HTTPS',
  synopsis: ['nslookup [-type=TYPE] NAME [SERVER]'],
  rawArgs: true,
  network: true,
  flags: [
    {
      long: 'type',
      description: 'written -type=TYPE: A, AAAA, MX, NS, TXT…',
      value: { name: 'TYPE', source: { kind: 'enum', values: () => ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'CAA', 'PTR'].map((value) => ({ value })), caseInsensitive: true } },
    },
  ],
  args: [
    { name: 'NAME', source: { kind: 'examples', caseInsensitive: true, fromHistory: true } },
    { name: 'SERVER', source: { kind: 'enum', values: () => SERVERS }, optional: true },
  ],
  loadingLabel: (argv) => `nslookup: looking up ${argv.slice(1).find((word) => !word.startsWith('-')) ?? 'the name'}…`,
  examples: [
    { line: 'nslookup vesen.app', note: 'its addresses' },
    { line: 'nslookup -type=MX vesen.app', note: 'its mail servers' },
    { line: 'nslookup example.com google', note: "ask Google's resolver" },
    { line: 'nslookup localhost', note: 'answered here, without asking', offline: true },
  ],
  seeAlso: ['dig', 'host', 'privacy'],
  load: () => import('./nslookup.run'),
};

export default spec;
