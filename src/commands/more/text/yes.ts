// yes: output a string repeatedly until killed. Small enough to keep its body here.

import { defineCommand } from '../../../shell/types';
import { pacer } from '../../lib/text-input';

export default defineCommand({
  name: 'yes',
  category: 'text',
  summary: 'output a string repeatedly until killed',
  synopsis: ['yes [STRING]...'],
  description:
    'Prints its STRINGs, separated by spaces, or y, on line after line until the reader of its output stops, as head does, or Ctrl+C ends it. It is for answering every question a command asks: `yes | rm -i *`.',
  posixArgs: true,
  args: [{ name: 'STRING', source: { kind: 'free', placeholder: 'text' }, optional: true, variadic: true }],
  examples: [
    { line: 'yes | head -n 3', offline: true },
    { line: 'yes no | head -n 2', offline: true },
  ],
  seeAlso: ['head', 'seq'],
  async run(ctx) {
    const line = `${ctx.args.length === 0 ? 'y' : ctx.args.join(' ')}\n`;
    // Many lines a write, so the loop is cheap; the reader closing the pipe ends it.
    const chunk = line.repeat(Math.max(1, Math.floor(8192 / line.length)));
    const breathe = pacer(ctx);
    for (;;) {
      await ctx.stdout.write(chunk);
      await breathe();
    }
  },
});
