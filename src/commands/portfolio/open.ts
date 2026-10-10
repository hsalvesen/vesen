// open and xdg-open: a web link as a card with Copy. A desktop browser opens an http or https URL
// in a new tab inside the Enter that ran the line; phones and in-app browsers open it on a tap.
// --external offers the way out of an in-app browser to the real one, behind a tap.

import { defineCommand } from '../../shell/types';
import { autoOpenUrl } from '../lib/web-url';

export default defineCommand({
  name: 'open',
  aliases: ['xdg-open'],
  category: 'system',
  summary: 'open a web link',
  synopsis: ['open URL', 'open --external URL'],
  description: 'Shows URL as a link with Copy; a desktop browser also opens it. vesen.app means https://vesen.app.',
  flags: [{ long: 'external', description: 'offer the real browser, inside an in-app one' }],
  args: [{ name: 'URL', source: { kind: 'url' } }],
  examples: [
    { line: 'open https://www.vesen.app', offline: true },
    { line: 'open --external vesen.app', offline: true },
  ],
  seeAlso: ['repo', 'whoami'],
  opens: (argv) => autoOpenUrl(argv),
  load: () => import('./links.run').then((m) => ({ run: m.open })),
});
