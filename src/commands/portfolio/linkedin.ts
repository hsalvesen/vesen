// linkedin: the developer's LinkedIn profile as a link card; a desktop browser opens it too.

import { defineCommand } from '../../shell/types';
import { OWNER_LINKS } from '../../vfs/identity';

export default defineCommand({
  name: 'linkedin',
  category: 'portfolio',
  summary: "open the developer's LinkedIn profile",
  examples: [{ line: 'linkedin', offline: true }],
  seeAlso: ['whoami', 'about'],
  opens: () => OWNER_LINKS.linkedin,
  load: () => import('./links.run').then((m) => ({ run: m.linkedin })),
});
