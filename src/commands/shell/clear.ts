// clear: clear the terminal screen. On the terminal it is the screen effect Ctrl+L also uses
// (the line being typed is kept); in a pipe or a file it writes the escape sequence ncurses'
// clear writes, which a terminal reading it clears the screen for, so `clear | cat` still clears.

import { defineCommand } from '../../shell/types';

/** Home the cursor, erase the screen, erase the scrollback. */
export const CLEAR_SEQUENCE = '\u001b[H\u001b[2J\u001b[3J';

export default defineCommand({
  name: 'clear',
  category: 'shell',
  summary: 'clear the terminal screen',
  synopsis: ['clear'],
  description: 'Clears the screen, leaving the prompt at the top. What was there is gone; history keeps the lines that made it. Ctrl+L does the same without losing what you are typing.',
  examples: [{ line: 'clear', offline: true }],
  seeAlso: ['reset', 'history'],
  async run(ctx) {
    if (ctx.stdout.isTTY) ctx.tty.clear();
    else await ctx.stdout.write(CLEAR_SEQUENCE);
    return 0;
  },
});
