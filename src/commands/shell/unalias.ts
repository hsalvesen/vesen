// unalias: remove aliases, as bash's builtin does. The next login reads ~/.bashrc again.

import { out } from '../../output/model';
import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'unalias',
  category: 'shell',
  summary: 'remove aliases',
  synopsis: ['unalias [-a] NAME...'],
  description: 'Removes each NAME from the aliases; with -a, removes them all. A new session reads ~/.bashrc, and its aliases, again.',
  builtin: true,
  posixArgs: true,
  flags: [{ short: 'a', description: 'remove every alias' }],
  args: [{ name: 'NAME', source: { kind: 'alias' }, optional: true, variadic: true }],
  examples: [
    { line: 'unalias ll', offline: true },
    { line: 'unalias -a', note: 'remove them all', offline: true },
  ],
  seeAlso: ['alias'],
  async run(ctx) {
    const aliases = ctx.shell.aliases;
    if (ctx.opts.a === true) {
      aliases.clear();
      return 0;
    }
    if (ctx.args.length === 0) {
      await ctx.stderr.line(out.span('unalias: usage: unalias [-a] name [name ...]', { fg: 'error' }));
      return 2;
    }
    let status = 0;
    for (const name of ctx.args) if (!aliases.delete(name)) status = await ctx.fail(`${name}: not found`);
    return status;
  },
});
