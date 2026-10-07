// repo: this terminal's source code on GitHub as a link card; a desktop browser opens it too.

import { defineCommand } from '../../shell/types';
import { OWNER_LINKS } from '../../vfs/identity';

export default defineCommand({
  name: 'repo',
  category: 'portfolio',
  summary: "open this terminal's source code",
  examples: [{ line: 'repo', offline: true }],
  seeAlso: ['about'],
  opens: () => OWNER_LINKS.repo,
  load: () => import('./links.run').then((m) => ({ run: m.repo })),
});
