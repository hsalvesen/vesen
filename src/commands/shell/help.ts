// help: every command by category, or one command's options and examples, or the keys. The
// index, the panels and the key list are all generated from the specs (src/shell/help.ts), so
// help never disagrees with the commands (F042, F043).

import { out } from '../../output/model';
import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'help',
  category: 'shell',
  summary: 'list the commands, or explain one',
  synopsis: ['help', 'help COMMAND...', 'help keys'],
  description:
    "With no COMMAND, lists every command by category, each with what it does; tap a name to put it at the prompt. With a COMMAND, shows its options and examples, as 'COMMAND --help' does. 'help keys' lists the keys the terminal answers to.",
  featured: true,
  args: [{ name: 'COMMAND', source: { kind: 'command' }, optional: true, variadic: true }],
  examples: [
    { line: 'help', note: 'every command', offline: true, starter: 1 },
    { line: 'help ls', note: "one command's options and examples", offline: true },
    { line: 'help keys', note: 'the keys', offline: true },
  ],
  seeAlso: ['man', 'whatis', 'apropos'],
  async run(ctx) {
    const help = await import('../../shell/help');
    if (ctx.args.length === 0) {
      for (const block of help.helpIndex(ctx.shell.registry)) await ctx.stdout.block(block);
      return 0;
    }
    let status = 0;
    for (const topic of ctx.args) {
      if (topic === 'keys') {
        for (const block of help.keysHelp({ touch: ctx.tty.touch })) await ctx.stdout.block(block);
        continue;
      }
      const spec = ctx.shell.registry.get(topic);
      if (spec === undefined) {
        await ctx.stderr.line(out.span(`help: no help topics match '${topic}'`, { fg: 'error' }));
        await ctx.stderr.line(out.span(`Try 'help' for the list, or 'apropos ${topic}' to search it.`, { fg: 'muted' }));
        status = 1;
        continue;
      }
      for (const block of help.commandHelp(spec)) await ctx.stdout.block(block);
    }
    return status;
  },
});
