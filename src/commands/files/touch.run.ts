// The body of touch; its spec, in touch.ts, loads this the first time touch runs, so the kernel's
// chunk carries only the spec (and not the date reader -d needs).

import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { parseDate, parseStamp } from '../lib/datespec';
import { reason, tryStat } from '../lib/files';

/** What --help, help and man say about touch, besides its spec (touch.ts). */
export const doc: CommandDoc = {
  description:
    "Sets each FILE's modification time to now, or to the time -d, -t or -r gives. A FILE that does not exist is created empty, unless -c is given. It works on folders too, and prints nothing when it works.",
  man: [
    {
      heading: 'DATES',
      body: "-d reads @SECONDS since 1970, a date (2026-10-01, 1 Oct 2026, Oct 1), a time (09:30, 09:30:15, 9am, 9:30 pm), both (2026-10-01T09:30:00Z), a day of the week (monday, 'next fri', 'last tuesday'), and words: now, today, yesterday, tomorrow, '3 days ago', '+2 hours', 'next week', 'last month'. Times are in your time zone unless a zone (UTC, Z, +11:00) is given. A day the month does not have, such as 2024-02-30, is refused. -t reads [[CC]YY]MMDDhhmm[.ss], as 202610010930.",
    },
    {
      heading: 'TIMES',
      body: 'vesen keeps one time for each file, when it was last modified, which ls -l and stat show; -a, which changes only the time a file was last read, leaves it as it is.',
    },
    { heading: 'EXIT STATUS', body: '0 when every FILE was touched (or, with -c, skipped), 1 otherwise.' },
  ],
};

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args.length === 0) return ctx.usage('missing file operand');
  const date = typeof ctx.opts.date === 'string' ? ctx.opts.date : undefined;
  const stamp = typeof ctx.opts.t === 'string' ? ctx.opts.t : undefined;
  const reference = typeof ctx.opts.reference === 'string' ? ctx.opts.reference : undefined;
  if ([date, stamp, reference].filter((given) => given !== undefined).length > 1) return ctx.usage('cannot specify times from more than one source');
  let time: number | undefined;
  const now = ctx.clock.now();
  if (date !== undefined) {
    const parsed = parseDate(date, now, ctx.clock.timeZone());
    if (parsed === null) return ctx.fail(`invalid date format '${date}'`);
    time = parsed;
  } else if (stamp !== undefined) {
    const parsed = parseStamp(stamp, now, ctx.clock.timeZone());
    if (parsed === null) return ctx.fail(`invalid date format '${stamp}'`);
    time = parsed;
  } else if (reference !== undefined) {
    try {
      time = ctx.fs.stat(ctx.resolve(reference)).mtime;
    } catch (error) {
      return ctx.fail(`failed to get attributes of '${reference}': ${reason(error)}`);
    }
  }
  // -a alone changes the access time, which vesen does not keep.
  const accessOnly = ctx.opts.a === true && ctx.opts.m !== true;
  let status = 0;
  for (const typed of ctx.args) {
    const path = ctx.resolve(typed);
    const existed = tryStat(ctx, path) !== null;
    if (ctx.opts['no-create'] === true && !existed) continue;
    if (accessOnly && existed) continue;
    try {
      ctx.fs.touch(path, time);
    } catch (error) {
      // GNU's two messages: one for a file it could not make, one for times it could not set.
      status = await ctx.fail(existed ? `setting times of '${typed}': ${reason(error)}` : `cannot touch '${typed}': ${reason(error)}`);
    }
  }
  return status;
}
