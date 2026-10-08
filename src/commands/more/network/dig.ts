// dig: ask the DNS about a name, as dig shows it. A browser cannot send DNS packets, so the
// question goes over HTTPS to Cloudflare, or Google when Cloudflare cannot be reached
// (commands/lib/dns.ts), and the output says so.

import { defineCommand, type EnumValue } from '../../../shell/types';

const TYPES: readonly EnumValue[] = [
  { value: 'A', summary: 'IPv4 address' },
  { value: 'AAAA', summary: 'IPv6 address' },
  { value: 'CNAME', summary: 'alias of' },
  { value: 'MX', summary: 'mail servers' },
  { value: 'NS', summary: 'name servers' },
  { value: 'TXT', summary: 'text records' },
  { value: 'SOA', summary: 'zone authority' },
  { value: 'CAA', summary: 'who may issue certificates' },
  { value: 'PTR', summary: 'name of an address' },
  { value: 'ANY', summary: 'whatever the resolver gives' },
];

const OPTIONS: readonly EnumValue[] = [
  { value: '+short', summary: 'just the answers' },
  { value: '+noall', summary: 'print nothing, then +answer…' },
  { value: '+answer', summary: 'the answer section' },
  { value: '@cloudflare', summary: "Cloudflare's resolver" },
  { value: '@google', summary: "Google's resolver" },
];

export default defineCommand({
  name: 'dig',
  category: 'network',
  summary: 'look up DNS records, over HTTPS',
  synopsis: ['dig [@SERVER] [-t TYPE] [-x ADDR] [NAME] [TYPE] [+QUERYOPT]...'],
  network: true,
  flags: [
    { short: 't', description: 'the record type: A, AAAA, MX, NS, TXT…', value: { name: 'TYPE', source: { kind: 'enum', values: () => TYPES, caseInsensitive: true } } },
    { short: 'x', description: "reverse lookup: the name of ADDR", value: { name: 'ADDR', source: { kind: 'free', placeholder: '1.1.1.1' } } },
    { short: 'q', description: 'the name to look up', value: { name: 'NAME', source: { kind: 'examples', fromHistory: true } } },
  ],
  args: [
    { name: 'NAME', source: { kind: 'examples', caseInsensitive: true, fromHistory: true }, optional: true },
    { name: 'TYPE', source: { kind: 'enum', values: () => TYPES, caseInsensitive: true }, optional: true },
    { name: 'OPTION', source: { kind: 'enum', values: () => OPTIONS }, optional: true, variadic: true },
  ],
  loadingLabel: (argv) => `dig: resolving ${argv.slice(1).find((word) => /^[^-+@]/.test(word) && word.includes('.')) ?? 'the name'}…`,
  examples: [
    { line: 'dig vesen.app', note: 'the A record, with every section' },
    { line: 'dig +short vesen.app MX', note: 'just the mail servers' },
    { line: 'dig +noall +answer www.github.com', note: 'only the answer, CNAME included' },
    { line: 'dig -x 1.1.1.1 +short', note: 'the name of an address' },
    { line: 'dig @google example.com AAAA', note: "ask Google's resolver" },
    { line: 'dig localhost +short', note: 'answered here, without asking', offline: true },
  ],
  seeAlso: ['host', 'nslookup', 'whois', 'ping', 'privacy'],
  load: () => import('./dig.run'),
});
