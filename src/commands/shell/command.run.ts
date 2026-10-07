// The body of command; its spec, in command.ts, loads this the first time command runs, so the
// kernel's chunk carries only the spec.

import { out } from '../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { allCommands } from '../lib/catalogue';
import { brief, describe, lookup } from '../lib/lookup';
import { shellQuote } from './alias';

/** What --help, help and man say about command, besides its spec (command.ts). */
export const doc: CommandDoc = {
  description:
    "Runs COMMAND with its ARGs as a command, never as an alias. With -v, prints what COMMAND would run: a path, a builtin's name, or the alias as it was defined; nothing, and status 1, when there is none. With -V, says so in words, as type does.",
};

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.opts.v === true || ctx.opts.V === true) {
    await allCommands(ctx);
    let status = 0;
    for (const name of ctx.args) {
      const [found] = lookup(ctx, name);
      if (found === undefined) {
        status = 1;
        if (ctx.opts.V === true) await ctx.stderr.line(out.span(`vesen: command: ${name}: not found`, { fg: 'error' }));
        continue;
      }
      await ctx.stdout.write(`${ctx.opts.V === true ? describe(name, found) : brief(name, found)}\n`);
    }
    return status;
  }
  if (ctx.args.length === 0) return 0;
  // The words, quoted, as a line the shell runs without looking up aliases.
  return ctx.shell.exec(ctx.args.map(shellQuote).join(' '), { stdin: ctx.stdin, stdout: ctx.stdout, stderr: ctx.stderr });
}
