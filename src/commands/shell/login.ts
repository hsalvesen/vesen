// login: start a new session, as the chip after `exit` does: the screen cleared with the banner,
// a new session's variables and aliases from /etc/profile and ~/.bashrc, in the home folder.
// Files, history and the theme stay. Hidden from help: it is what the chip runs.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'login',
  category: 'shell',
  summary: 'start a new session',
  description:
    'Starts a new session, as opening a new terminal does: the banner on a clear screen, and variables and aliases as /etc/profile and ~/.bashrc set them, in the home folder. Files, history and the theme are kept.',
  hidden: true,
  builtin: true,
  examples: [{ line: 'login', offline: true }],
  seeAlso: ['exit', 'reset'],
  async run(ctx) {
    await ctx.shell.login({ banner: ctx.tty.interactive && ctx.stdout.isTTY });
    return 0;
  },
});
