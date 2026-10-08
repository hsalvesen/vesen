// whois: who registered a domain, and when. A browser cannot reach whois's port 43, so whois
// asks RDAP, the registries' web service for the same records, through rdap.org, which sends
// the question on to the domain's registry.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'whois',
  category: 'network',
  summary: 'look up who registered a domain',
  synopsis: ['whois [-h HOST] DOMAIN'],
  network: true,
  flags: [
    {
      short: 'h',
      long: 'host',
      description: 'the whois server to ask; ignored, since the question always goes over RDAP',
      value: { name: 'HOST', source: { kind: 'free', placeholder: 'whois.verisign-grs.com' } },
    },
  ],
  args: [{ name: 'DOMAIN', source: { kind: 'examples', caseInsensitive: true, fromHistory: true } }],
  // DOMAIN, never -h's HOST.
  loadingLabel: (argv) => `whois: asking RDAP about ${argv.find((word, i) => i > 0 && !word.startsWith('-') && !/^(-h|--host)$/.test(argv[i - 1] ?? '')) ?? 'the domain'}…`,
  examples: [
    { line: 'whois vesen.app', note: 'its registrar, dates and name servers' },
    { line: 'whois example.com' },
    { line: 'whois --help', note: 'what it asks, and where', offline: true },
  ],
  seeAlso: ['dig', 'host', 'privacy'],
  load: () => import('./whois.run'),
});
