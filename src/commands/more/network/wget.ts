// wget: download a URL into a file here. Like curl, it fetches straight from the browser, so a
// site must allow it (CORS), and it says so when one does not; files stop at 1 MB.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'wget',
  category: 'network',
  summary: 'download a URL into a file',
  synopsis: ['wget [-q] [-S] [-O FILE] URL...'],
  network: true,
  budgetMs: 60_000,
  flags: [
    { short: 'O', long: 'output-document', description: "write to FILE ('-' for the terminal)", value: { name: 'FILE', source: { kind: 'path' } } },
    { short: 'q', long: 'quiet', description: 'say nothing' },
    { short: 'S', long: 'server-response', description: "show the response's headers" },
  ],
  args: [{ name: 'URL', source: { kind: 'url' }, variadic: true }],
  loadingLabel: (argv) => `wget: fetching ${argv.find((word, i) => i > 0 && !word.startsWith('-') && /[./:]/.test(word)) ?? 'the page'}…`,
  examples: [
    { line: 'wget https://httpbin.org/json', note: 'saved as json' },
    { line: 'wget -O - https://httpbin.org/uuid', note: 'to the terminal' },
    { line: 'wget -q -O notes.txt https://httpbin.org/robots.txt', note: 'quietly, to a file of your naming' },
    { line: 'wget --help', note: 'what a browser allows it', offline: true },
  ],
  seeAlso: ['curl', 'privacy'],
  load: () => import('./wget.run'),
});
