// host: a DNS lookup in host's short sentences, over DNS over HTTPS (commands/lib/dns.ts).

import { defineCommand, type EnumValue } from '../../../shell/types';

const TYPES: readonly EnumValue[] = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'TXT', 'SOA', 'CAA', 'PTR'].map((value) => ({ value }));
const SERVERS: readonly EnumValue[] = [
  { value: 'cloudflare', summary: "Cloudflare's resolver" },
  { value: 'google', summary: "Google's resolver" },
];

export default defineCommand({
  name: 'host',
  category: 'network',
  summary: 'look up a name or an address, over HTTPS',
  synopsis: ['host [-t TYPE] NAME [SERVER]'],
  network: true,
  flags: [{ short: 't', description: 'the record type: A, AAAA, MX, NS, TXT…', value: { name: 'TYPE', source: { kind: 'enum', values: () => TYPES, caseInsensitive: true } } }],
  args: [
    { name: 'NAME', source: { kind: 'examples', caseInsensitive: true, fromHistory: true } },
    { name: 'SERVER', source: { kind: 'enum', values: () => SERVERS }, optional: true },
  ],
  loadingLabel: (argv) => `host: looking up ${argv[argv.length - 1] ?? 'the name'}…`,
  examples: [
    { line: 'host vesen.app', note: 'its addresses and mail servers' },
    { line: 'host -t TXT example.com', note: 'one type of record' },
    { line: 'host 1.1.1.1', note: 'the name of an address' },
    { line: 'host localhost', note: 'answered here, without asking', offline: true },
  ],
  seeAlso: ['dig', 'nslookup', 'whois', 'privacy'],
  load: () => import('./host.run'),
});
