// type: say what a name would run, as bash's builtin does: an alias, a keyword, a builtin or a
// file on $PATH.

import { out } from '../../output/model';
import { defineCommand } from '../../shell/types';
import { allCommands } from '../lib/catalogue';
import { describe, lookup } from '../lib/lookup';

export default defineCommand({
  name: 'type',
  category: 'shell',
  summary: 'describe what a command name runs',
  synopsis: ['type [-afptP] NAME...'],
  description:
    'For each NAME, says whether it is an alias, a shell keyword, a shell builtin or a file on $PATH, and which. A NAME that is none of them is an error.',
  builtin: true,
  flags: [
    { short: 'a', description: 'list every place NAME is found, not just the first' },
    { short: 't', description: "print only one word: alias, keyword, builtin or file" },
    { short: 'p', description: 'print the file NAME would run, if it is a file' },
    { short: 'P', description: 'search $PATH for NAME, even if it is an alias or builtin' },
    { short: 'f', description: 'do not look up shell functions (vesen has none)' },
  ],
  args: [{ name: 'NAME', source: { kind: 'command' }, variadic: true }],
  examples: [
    { line: 'type ls', offline: true },
    { line: 'type ll cd if', note: 'an alias, a builtin and a keyword', offline: true },
    { line: 'type -a ls', note: 'every match on $PATH', offline: true },
  ],
  seeAlso: ['which', 'command', 'alias'],
  async run(ctx) {
    await allCommands(ctx);
    let status = 0;
    const all = ctx.opts.a === true;
    for (const name of ctx.args) {
      if (ctx.opts.P === true) {
        const files = lookup(ctx, name, { all, aliases: false }).filter((found) => found.kind === 'file');
        if (files.length === 0) status = 1;
        for (const found of files) if (found.kind === 'file') await ctx.stdout.write(`${found.path}\n`);
        continue;
      }
      const found = lookup(ctx, name, { all });
      if (found.length === 0) {
        status = 1;
        if (ctx.opts.t !== true && ctx.opts.p !== true) await ctx.stderr.line(out.span(`vesen: type: ${name}: not found`, { fg: 'error' }));
        continue;
      }
      for (const each of found) {
        if (ctx.opts.t === true) await ctx.stdout.write(`${each.kind}\n`);
        else if (ctx.opts.p === true) {
          if (each.kind === 'file') await ctx.stdout.write(`${each.path}\n`);
        } else await ctx.stdout.write(`${describe(name, each)}\n`);
      }
    }
    return status;
  },
});
