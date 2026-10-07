// The body of more: less's pager (less.run.ts), which leaves when a screen forward goes past the
// end, and is not opened at all for text that fits on the screen.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { page } from './less.run';

/** What --help, help and man say about more, besides its spec (more.ts). */
export const doc: CommandDoc = {
  description:
    'Shows each FILE, or standard input, a screen at a time on the terminal: space goes on a screen, and going on past the end leaves, as does q. Text that fits on the screen is simply printed. The keys of less work too: b goes back, /text searches and h lists the rest. Into a pipe, more copies its input as cat would, with a rule of colons above each FILE when there are several.',
  man: [{ heading: 'EXIT STATUS', body: '0, or 1 when a FILE could not be read: more shows the others.' }],
};

export function run(ctx: CommandContext): Promise<ExitCode> {
  return page(ctx, 'more');
}
