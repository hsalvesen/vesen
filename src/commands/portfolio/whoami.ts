// whoami: who made this terminal, with link cards for LinkedIn, GitHub and email. On a desktop
// browser LinkedIn also opens in a new tab, inside the Enter that ran the line. In a pipe it is
// the Linux command again and prints the user name, guest.

import { defineCommand } from '../../shell/types';
import { OWNER_LINKS } from '../../vfs/identity';

export default defineCommand({
  name: 'whoami',
  category: 'portfolio',
  summary: 'meet the developer; in a pipe, your user name',
  description: 'Who made vesen, with LinkedIn, GitHub and email links. A desktop browser also opens LinkedIn. In a pipe it prints the user name.',
  featured: true,
  examples: [{ line: 'whoami', note: 'the developer', offline: true }, { line: 'whoami | cat', note: 'your user name', offline: true }],
  seeAlso: ['about', 'contact', 'linkedin'],
  opens: () => OWNER_LINKS.linkedin,
  load: () => import('./links.run').then((m) => ({ run: m.whoami })),
});
