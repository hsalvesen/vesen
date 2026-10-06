// export: give variables to the commands the shell runs, as bash's builtin does. ~/.bashrc and
// /etc/profile use it at boot.

import { isVariableName } from '../../shell/session';
import { defineCommand } from '../../shell/types';

/** A value as `declare -x` prints it: in double quotes, with \ " $ and ` escaped. */
function declared(value: string): string {
  return `"${value.replace(/[\\"$`]/g, (c) => `\\${c}`)}"`;
}

export default defineCommand({
  name: 'export',
  category: 'shell',
  summary: 'give variables to the commands you run',
  synopsis: ['export [-n] [-p] [NAME[=VALUE] ...]'],
  description:
    'Marks each NAME for the environment of the commands the shell runs, setting it to VALUE first when one is given. With nothing, or -p, lists the exported variables.',
  builtin: true,
  // `export X=$Y` keeps the spaces in $Y, as bash's declaration builtins do.
  assignmentArgs: true,
  posixArgs: true,
  flags: [
    { short: 'p', description: 'list the exported variables' },
    { short: 'n', description: 'stop exporting each NAME' },
  ],
  args: [{ name: 'NAME=VALUE', source: { kind: 'var' }, optional: true, variadic: true }],
  examples: [
    { line: 'export NAME=Has', offline: true },
    { line: 'export -p', note: 'list what is exported', offline: true },
  ],
  seeAlso: ['alias', 'printenv'],
  async run(ctx) {
    const env = ctx.env;
    if (ctx.args.length === 0 || ctx.opts.p === true) {
      for (const [name, value] of env.entries(true)) await ctx.stdout.write(`declare -x ${name}=${declared(value)}\n`);
      if (ctx.args.length === 0) return 0;
    }
    let status = 0;
    for (const word of ctx.args) {
      const equals = word.indexOf('=');
      const name = equals === -1 ? word : word.slice(0, equals);
      if (!isVariableName(name)) {
        status = await ctx.fail(`\`${word}': not a valid identifier`);
        continue;
      }
      if (equals === -1) {
        // `export X` before X has a value: a later `X=5` lands in the environment.
        env.markExported(name, ctx.opts.n !== true);
        continue;
      }
      env.set(name, word.slice(equals + 1), { export: ctx.opts.n !== true });
    }
    return status;
  },
});
