// unset: remove shell variables, as bash's builtin does.

import { isVariableName } from '../../shell/session';
import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'unset',
  category: 'shell',
  summary: 'remove shell variables',
  synopsis: ['unset [-fv] NAME...'],
  description: 'Removes each variable NAME, from the shell and from the environment of the commands it runs.',
  builtin: true,
  posixArgs: true,
  flags: [
    { short: 'v', description: 'treat each NAME as a variable (the default)' },
    { short: 'f', description: 'treat each NAME as a function (vesen has none)' },
  ],
  args: [{ name: 'NAME', source: { kind: 'var' }, optional: true, variadic: true }],
  examples: [
    { line: 'unset NAME', offline: true },
    { line: 'export NAME=Has; unset NAME; echo "[$NAME]"', note: 'gone', offline: true },
  ],
  seeAlso: ['export', 'set', 'env'],
  async run(ctx) {
    if (ctx.opts.f === true) return 0;
    let status = 0;
    for (const name of ctx.args) {
      if (!isVariableName(name)) {
        status = await ctx.fail(`\`${name}': not a valid identifier`);
        continue;
      }
      ctx.env.unset(name);
    }
    return status;
  },
});
