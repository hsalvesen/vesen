// about: the developer's own summary, /home/has/about.md, then link cards to reach him.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'about',
  category: 'portfolio',
  summary: 'about the developer',
  description: 'Prints /home/has/about.md, then links to reach the developer.',
  examples: [{ line: 'about', note: 'who made vesen', offline: true }],
  seeAlso: ['whoami', 'contact'],
  load: () => import('./links.run').then((m) => ({ run: m.about })),
});
