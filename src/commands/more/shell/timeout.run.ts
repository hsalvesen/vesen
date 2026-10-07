// The body of timeout; its spec, in timeout.ts, loads this the first time timeout runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { signalName, signalNumber } from '../../lib/procs';
import { shellQuote } from '../../shell/alias';
import { interval } from '../../shell/sleep';

/** What --help, help and man say about timeout, besides its spec (timeout.ts). */
export const doc: CommandDoc = {
  description:
    "Runs COMMAND with its ARGs, and stops it if it is still running after DURATION: a number of seconds, with a fraction if you like, or with s, m, h or d after it; 0 means no limit. Stopping it works as ^C does, for that command alone, and timeout then exits 124, while the rest of your line carries on. -s names the signal, which only changes the status: with KILL, or with --preserve-status, it is 128 plus the signal's number. -v says when the time is up. A command always stops when asked here, so -k has nothing to do.",
  man: [
    {
      heading: 'EXIT STATUS',
      body: "124 when COMMAND ran out of time (or 128 plus the signal, as above); 125 when timeout itself failed, such as for a bad DURATION; 127 when COMMAND is not found; otherwise COMMAND's status.",
    },
  ],
};

/** timeout's status when the command ran out of time. */
const TIMED_OUT = 124;

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const [duration, ...command] = ctx.args;
  if (duration === undefined || command.length === 0) return ctx.usage('missing operand');
  const ms = interval(duration);
  if (ms === null) return ctx.usage(`invalid time interval '${duration}'`);
  const killAfter = ctx.opts['kill-after'];
  if (typeof killAfter === 'string' && interval(killAfter) === null) return ctx.usage(`invalid time interval '${killAfter}'`);
  const given = ctx.opts.signal;
  const signal = typeof given === 'string' ? signalNumber(given) : 15;
  if (signal === null || signal === 0) return ctx.usage(`${String(given)}: invalid signal`);

  const cancel = new AbortController();
  const expire = new AbortController();
  let timedOut = false;
  if (ms > 0 && Number.isFinite(ms)) {
    ctx.clock.sleep(ms, cancel.signal).then(
      async () => {
        timedOut = true;
        if (ctx.opts.verbose === true) await ctx.stderr.line(`timeout: sending signal ${signalName(signal)} to command '${command[0] ?? ''}'`).catch(() => {});
        expire.abort();
      },
      () => {
        // The command finished first, or ^C ended the line.
      },
    );
  }
  let status: ExitCode;
  try {
    status = await ctx.shell.exec(command.map(shellQuote).join(' '), { stdin: ctx.stdin, stdout: ctx.stdout, stderr: ctx.stderr, signal: expire.signal });
  } finally {
    cancel.abort();
  }
  if (!timedOut) return status;
  return ctx.opts['preserve-status'] === true || signal === 9 ? 128 + signal : TIMED_OUT;
}
