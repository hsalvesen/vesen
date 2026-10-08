// ping: how long a host takes to answer. A browser cannot send ICMP, so ping resolves the name
// over DNS over HTTPS, then times HTTPS requests to the host, says so, and prints ping's
// statistics at the end, or on ^C.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'ping',
  category: 'network',
  summary: 'time HTTPS round trips to a host',
  synopsis: ['ping [-c COUNT] [-i INTERVAL] [-W TIMEOUT] [-q] HOST'],
  network: true,
  // -c 100 at -i 2 takes over three minutes; it stops early, with its statistics, before five.
  budgetMs: 300_000,
  usageStatus: 2,
  flags: [
    { short: 'c', description: 'stop after COUNT requests (4 unless given)', value: { name: 'COUNT', source: { kind: 'int' } } },
    { short: 'i', description: 'wait INTERVAL seconds between requests (1; 0.2 at least)', value: { name: 'INTERVAL', source: { kind: 'free', placeholder: 'seconds' } } },
    { short: 'W', description: 'wait TIMEOUT seconds for each answer (5)', value: { name: 'TIMEOUT', source: { kind: 'free', placeholder: 'seconds' } } },
    { short: 'q', description: 'quiet: only the summary at the end' },
  ],
  args: [{ name: 'HOST', source: { kind: 'examples', caseInsensitive: true, fromHistory: true } }],
  // The host, never the value -c, -i or -W took: `ping -c 10 -i 0.5 example.com` times example.com.
  loadingLabel: (argv) => `ping: timing ${argv.find((word, i) => i > 0 && !word.startsWith('-') && !/^-[a-zA-Z]*[ciW]$/.test(argv[i - 1] ?? '')) ?? 'the host'}…`,
  examples: [
    { line: 'ping vesen.app', note: 'four requests, a second apart' },
    { line: 'ping -c 10 -i 0.5 example.com', note: 'ten, half a second apart' },
    { line: 'ping --help', note: 'what it does instead of ICMP', offline: true },
  ],
  seeAlso: ['dig', 'curl', 'speedtest', 'traceroute', 'privacy'],
  load: () => import('./ping.run'),
});
