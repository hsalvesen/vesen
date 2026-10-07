// The body of who; its spec, in who.ts, loads this the first time who runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { TERMINAL } from '../../lib/procs';
import { bootTime, isoMinute, wallClock } from '../../lib/sysread';

/** What --help, help and man say about who, besides its spec (who.ts). */
export const doc: CommandDoc = {
  description:
    'Prints a line for each user logged on: the name, the terminal and when they logged on. Here that is you, as guest, on pts/0, since the page loaded. With -b, when the system booted, which is the same moment; with -q, the names and how many; with -H, column headings first. `who am i` and -m print only the user on the terminal you are typing in.',
};

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const words = ctx.args;
  if (words.length > 2) return ctx.usage(`extra operand '${words[2] ?? ''}'`);
  if (words.length === 1 && words[0] !== undefined) return ctx.fail(`${words[0]}: No such file or directory`);
  const since = isoMinute(wallClock(ctx, bootTime(ctx)));
  const user = ctx.user.name;
  if (ctx.opts.count === true) {
    await ctx.stdout.write(`${user}\n# users=1\n`);
    return 0;
  }
  const rows: string[] = [];
  if (ctx.opts.heading === true) rows.push(`${'NAME'.padEnd(8)} ${'LINE'.padEnd(12)} ${'TIME'.padEnd(16)} COMMENT`);
  if (ctx.opts.boot === true) rows.push(`${''.padEnd(8)} ${'system boot'.padEnd(12)} ${since}`);
  else rows.push(`${user.padEnd(8)} ${TERMINAL.padEnd(12)} ${since}`);
  await ctx.stdout.write(`${rows.join('\n')}\n`);
  return 0;
}
