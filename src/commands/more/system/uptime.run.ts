// The body of uptime; its spec, in uptime.ts, loads this the first time uptime runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { bootTime, clockText, prettyUptime, two, uptimeLine, uptimeSeconds, wallClock } from '../../lib/sysread';

/** What --help, help and man say about uptime, besides its spec (uptime.ts). */
export const doc: CommandDoc = {
  description:
    'Prints the time, how long the system has been running, how many users are logged on, and the load averages for the past 1, 5 and 15 minutes. The system booted when this page loaded, so the uptime is how long you have had vesen open; the figures are the ones in /proc/uptime and /proc/loadavg.',
};

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args[0] !== undefined) return ctx.usage(`extra operand '${ctx.args[0]}'`);
  let line: string;
  if (ctx.opts.since === true) {
    const t = wallClock(ctx, bootTime(ctx));
    line = `${t.year}-${two(t.month)}-${two(t.day)} ${clockText(t)}`;
  } else if (ctx.opts.pretty === true) {
    line = prettyUptime(uptimeSeconds(ctx));
  } else {
    line = uptimeLine(ctx);
  }
  await ctx.stdout.write(`${line}\n`);
  return 0;
}
