// The body of w; its spec, in w.ts, loads this the first time w runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { processTable, TERMINAL } from '../../lib/procs';
import { bootTime, two, uptimeLine, wallClock } from '../../lib/sysread';

/** What --help, help and man say about w, besides its spec (w.ts). */
export const doc: CommandDoc = {
  description:
    'Prints the time, how long the system has been up, how many users are on and the load averages, as uptime does, then a line for each user: the terminal, where from, when they logged on, how long they have been idle, the processor time used, and the command they are running. Here that is you, running w. With USER, only that user; with -h, no header; with -s, without the login time and processor times.',
};

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const [only] = ctx.args;
  const short = ctx.opts.short === true;
  const rows: string[] = [];
  if (ctx.opts['no-header'] !== true) {
    rows.push(uptimeLine(ctx));
    rows.push(short ? 'USER     TTY      FROM              IDLE WHAT' : 'USER     TTY      FROM             LOGIN@   IDLE   JCPU   PCPU WHAT');
  }
  if (only === undefined || only === ctx.user.name) {
    const login = wallClock(ctx, bootTime(ctx));
    const what = processTable(ctx).find((proc) => proc.self)?.args ?? '-vesh';
    const head = `${ctx.user.name.padEnd(8)} ${TERMINAL.padEnd(8)} ${'-'.padEnd(16)}`;
    rows.push(short ? `${head}  0.00s ${what}` : `${head} ${`${two(login.hour)}:${two(login.minute)}`.padEnd(8)} 0.00s  0.00s  0.00s ${what}`);
  }
  await ctx.stdout.write(`${rows.join('\n')}\n`);
  return 0;
}
