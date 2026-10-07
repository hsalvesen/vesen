// curl: fetch a URL straight from the browser, with the flags people reach for, and honest
// errors when the browser will not allow it (docs/plan/07-stock-and-proxy.md, "curl"; F038). No
// public proxy ever sees the URL; vesen's own proxy is used only with --via-proxy, and says so.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'curl',
  category: 'network',
  summary: 'transfer a URL',
  synopsis: ['curl [OPTION]... URL...'],
  network: true,
  budgetMs: 60_000,
  usageStatus: 2,
  flags: [
    { short: 'I', long: 'head', description: 'show only the headers, with a HEAD request' },
    { short: 'i', long: 'include', description: 'show the headers before the body' },
    { short: 's', long: 'silent', description: 'say nothing but the output' },
    { short: 'S', long: 'show-error', description: 'with -s, still say what went wrong' },
    { short: 'L', long: 'location', description: 'follow redirects' },
    { short: 'f', long: 'fail', description: 'fail with no output on an HTTP error (22)' },
    { short: 'o', long: 'output', description: 'write the body to FILE instead', value: { name: 'FILE', source: { kind: 'path' } } },
    { short: 'O', long: 'remote-name', description: 'write the body to a file named as the URL names it' },
    {
      short: 'X',
      long: 'request',
      description: 'the request method',
      value: { name: 'METHOD', source: { kind: 'enum', values: () => ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].map((value) => ({ value })) } },
    },
    { short: 'H', long: 'header', description: "add a header, 'Name: value'", repeatable: true, value: { name: 'HEADER', source: { kind: 'free', placeholder: 'Name: value' } } },
    { short: 'd', long: 'data', description: 'POST DATA; @FILE reads it from a file', repeatable: true, value: { name: 'DATA', source: { kind: 'free', placeholder: 'name=value' } } },
    { long: 'data-raw', description: "POST DATA, with no special '@'", repeatable: true, value: { name: 'DATA', source: { kind: 'free', placeholder: 'name=value' } } },
    { short: 'w', long: 'write-out', description: "print FORMAT after: '%{http_code}' and more", value: { name: 'FORMAT', source: { kind: 'free', placeholder: '%{http_code}' } } },
    { short: 'm', long: 'max-time', description: 'give up after SECONDS (8 by default)', value: { name: 'SECONDS', source: { kind: 'free', placeholder: 'seconds' } } },
    { short: 'v', long: 'verbose', description: 'show the request and the response headers' },
    { long: 'compressed', description: 'accepted: the browser always decompresses' },
    { long: 'via-proxy', description: "fetch through vesen's own proxy, where it has one" },
  ],
  args: [{ name: 'URL', source: { kind: 'url' }, variadic: true }],
  loadingLabel: (argv) => `fetching ${argv.find((word, i) => i > 0 && !word.startsWith('-') && /[./:]/.test(word)) ?? 'the page'}…`,
  examples: [
    { line: 'curl https://httpbin.org/get', note: 'a site that allows browser requests' },
    { line: 'curl -I https://www.vesen.app/', note: 'just the headers' },
    { line: 'curl -d name=vesen https://httpbin.org/post', note: 'POST a form' },
    { line: "curl -s -o /dev/null -w '%{http_code}\\n' https://httpbin.org/status/404", note: 'only the status' },
    { line: 'curl file:///etc/hostname', note: 'a file, by its URL', offline: true },
  ],
  seeAlso: ['speedtest', 'privacy'],
  load: () => import('./curl.run'),
});
