// printenv: print the environment, or the value of each variable named, as coreutils' printenv
// does. Only exported variables are in the environment.

import { defineCommand } from '../../shell/types';

export default defineCommand({
  name: 'printenv',
  category: 'shell',
  summary: 'print all or part of the environment',
  synopsis: ['printenv [NAME]...'],
  description:
    "With no NAME, prints every exported variable as NAME=VALUE. Otherwise prints the value of each NAME that is exported; a NAME that is not makes the status 1. 'export NAME' adds a variable.",
  args: [{ name: 'NAME', source: { kind: 'var' }, optional: true, variadic: true }],
  examples: [
    { line: 'printenv HOME', offline: true },
    { line: 'printenv', note: 'everything exported', offline: true },
  ],
  seeAlso: ['env', 'export', 'set'],
  async run(ctx) {
    if (ctx.args.length === 0) {
      for (const [name, value] of ctx.env.entries(true)) await ctx.stdout.write(`${name}=${value}\n`);
      return 0;
    }
    let status = 0;
    for (const name of ctx.args) {
      const value = ctx.env.isExported(name) ? ctx.env.get(name) : undefined;
      if (value === undefined) status = 1;
      else await ctx.stdout.write(`${value}\n`);
    }
    return status;
  },
});
