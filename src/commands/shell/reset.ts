// reset: start the terminal again, as it always has here: the banner, the default theme, the
// home folder as cwd, the original files and an empty history.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'reset',
  category: 'shell',
  summary: 'restore the terminal, its files and history',
  description:
    'Clears the screen and shows the banner again, restores the default theme, the original files under ~ and the working directory, and empties the command history. Aliases and variables go back to what a new session has.',
  examples: [{ line: 'reset', offline: true }],
  seeAlso: ['clear', 'history', 'theme'],
  run(ctx) {
    ctx.shell.reset({ files: true });
    return 0;
  },
});
