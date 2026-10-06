// which: the file each name runs, found on $PATH as debianutils' which finds it. Aliases and
// builtins are the shell's, so which does not see them; type does.

import { defineCommand } from '../../shell/types';
import { searchPath } from '../lib/lookup';

export default defineCommand({
  name: 'which',
  category: 'shell',
  summary: 'locate a command on $PATH',
  synopsis: ['which [-a] NAME...'],
  description: 'Prints the path of the file each NAME runs: the first executable of that name in the folders of $PATH. A NAME with none prints nothing and makes the status 1.',
  flags: [{ short: 'a', description: 'print every match, not just the first' }],
  args: [{ name: 'NAME', source: { kind: 'command' }, variadic: true }],
  examples: [
    { line: 'which cat', offline: true },
    { line: 'which -a ls', note: 'every match on $PATH', offline: true },
  ],
  seeAlso: ['type', 'command'],
  async run(ctx) {
    if (ctx.args.length === 0) return 1;
    let status = 0;
    for (const name of ctx.args) {
      const found = searchPath(ctx, name, ctx.opts.a === true);
      if (found.length === 0) status = 1;
      for (const path of found) await ctx.stdout.write(`${path}\n`);
    }
    return status;
  },
});
