// alias: define or list aliases, as bash's builtin does. ~/.bashrc defines ll, la and l with it
// at boot. Aliases typed at the prompt last for the session.

import { defineCommand } from '../../shell/types';

/** A word quoted for the shell, as bash prints alias values: 'ls -la', with ' written '\''. */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Names bash refuses for an alias. */
const INVALID = /[\s/$`=\\'"|&;<>()]/;

export default defineCommand({
  name: 'alias',
  category: 'shell',
  summary: 'define or list aliases',
  synopsis: ['alias [-p] [NAME[=VALUE] ...]'],
  description:
    "With NAME=VALUE, makes NAME stand for VALUE at the start of a command. With a NAME alone, prints its alias; with nothing, prints them all. ~/.bashrc defines ll, la and l.",
  builtin: true,
  posixArgs: true,
  flags: [{ short: 'p', description: 'print every alias in a form that can be read back' }],
  args: [{ name: 'NAME=VALUE', source: { kind: 'alias' }, optional: true, variadic: true }],
  examples: [
    { line: 'alias', note: 'list the aliases', offline: true },
    { line: "alias gs='git status'", offline: true },
    { line: 'alias ll', offline: true },
  ],
  seeAlso: ['export', 'history'],
  async run(ctx) {
    const aliases = ctx.shell.aliases;
    if (ctx.args.length === 0 || ctx.opts.p === true) {
      const names = [...aliases.keys()].sort();
      for (const name of names) await ctx.stdout.write(`alias ${name}=${shellQuote(aliases.get(name) ?? '')}\n`);
      if (ctx.args.length === 0) return 0;
    }
    let status = 0;
    for (const word of ctx.args) {
      const equals = word.indexOf('=');
      const name = equals === -1 ? word : word.slice(0, equals);
      if (name === '' || INVALID.test(name)) {
        status = await ctx.fail(`\`${name}': invalid alias name`);
        continue;
      }
      if (equals === -1) {
        const value = aliases.get(name);
        if (value === undefined) status = await ctx.fail(`${name}: not found`);
        else await ctx.stdout.write(`alias ${name}=${shellQuote(value)}\n`);
        continue;
      }
      aliases.set(name, word.slice(equals + 1));
    }
    return status;
  },
});
