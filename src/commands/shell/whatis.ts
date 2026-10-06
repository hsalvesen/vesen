// whatis: the one-line summary of each command named, as man-db prints it.

import { defineCommand } from '../../shell/types';
import { runWhatis } from './man';

export default defineCommand({
  name: 'whatis',
  category: 'shell',
  summary: 'display one-line command summaries',
  description: 'Prints the NAME line of the manual page of each COMMAND.',
  args: [{ name: 'COMMAND', source: { kind: 'command' }, variadic: true }],
  examples: [
    { line: 'whatis ls', offline: true },
    { line: 'whatis cd pwd theme', offline: true },
  ],
  seeAlso: ['apropos', 'man', 'help'],
  async run(ctx) {
    if (ctx.args.length === 0) {
      await ctx.stderr.write('whatis what?\n');
      return 1;
    }
    return runWhatis(ctx, ctx.args);
  },
});
