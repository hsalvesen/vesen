// The body of type; its spec, in type.ts, loads this the first time type runs, so the
// kernel's chunk carries only the spec.

import { out } from '../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { allCommands } from '../lib/catalogue';
import { describe, lookup } from '../lib/lookup';

/** What --help, help and man say about type, besides its spec (type.ts). */
export const doc: CommandDoc = {
  description:
    'For each NAME, says whether it is an alias, a shell keyword, a shell builtin or a file on $PATH, and which. A NAME that is none of them is an error.',
};

export async function run(ctx: CommandContext): Promise<ExitCode> {
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
}
