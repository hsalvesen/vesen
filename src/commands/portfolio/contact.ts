// contact, and email, its other name: the developer's email address, with Open mail app (a real
// mailto link) and Copy. Nothing opens by itself, so a mail app never pops up uninvited.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'contact',
  aliases: ['email'],
  category: 'portfolio',
  summary: 'email the developer',
  description: "The developer's address, with Open mail app and Copy. Nothing opens by itself.",
  examples: [{ line: 'contact', offline: true }, { line: 'email', offline: true }],
  seeAlso: ['whoami', 'about'],
  load: () => import('./links.run').then((m) => ({ run: m.contact })),
});
