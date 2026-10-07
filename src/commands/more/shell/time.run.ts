// The body of time; its spec, in time.ts, loads this the first time time runs.

import { expandAliases } from '../../../shell/alias';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { shellQuote } from '../../shell/alias';

/** A word that needs no quotes, so it may still name an alias. */
const PLAIN = /^[\w.,:@%+=/-]+$/;

/** What --help, help and man say about time, besides its spec (time.ts). */
export const doc: CommandDoc = {
  description:
    "Runs COMMAND with its ARGs, then reports how long it took: real is the time on the clock, and user and sys the processor time it used outside and inside the kernel. A browser does not tell a page how much processor time it used, so user and sys are always 0. -p reports in POSIX's format, in seconds. $TIMEFORMAT changes the format, as in bash: %R, %U and %S are the three times and %P the share of the processor, each with an optional number of decimals (%2R) and l for minutes and seconds (%3lR); an empty $TIMEFORMAT reports nothing. The report goes to standard error, so a pipe after COMMAND does not get it. vesen's time is a builtin rather than a keyword, so in `time a | b` it times a alone.",
  man: [{ heading: 'EXIT STATUS', body: "COMMAND's status, or 0 with no COMMAND." }],
};

/** bash's report when $TIMEFORMAT is unset. */
export const DEFAULT_TIMEFORMAT = '\nreal\t%3lR\nuser\t%3lU\nsys\t%3lS';
const POSIX_FORMAT = 'real %2R\nuser %2U\nsys %2S';

export interface Times {
  readonly real: number;
  readonly user: number;
  readonly sys: number;
}

/** Seconds to `places` decimals, cut rather than rounded, as bash cuts them. */
function seconds(value: number, places: number): string {
  const scale = 10 ** places;
  return (Math.floor(value * scale + 1e-9) / scale).toFixed(places);
}

/** A TIMEFORMAT with the times put in: %R %U %S (with [p][l]), %P and %%. */
export function formatTimes(format: string, times: Times): string {
  return format.replace(/%(%|P|([0-3])?(l)?([RUS]))/g, (whole, what: string, digits: string | undefined, long: string | undefined, which: string | undefined) => {
    if (what === '%') return '%';
    if (what === 'P') return times.real > 0 ? (((times.user + times.sys) / times.real) * 100).toFixed(2) : '0.00';
    const value = which === 'R' ? times.real : which === 'U' ? times.user : times.sys;
    const places = digits === undefined ? 3 : Number(digits);
    if (long === undefined) return seconds(value, places);
    const minutes = Math.floor(value / 60);
    return `${minutes}m${seconds(value - minutes * 60, places)}s`;
  });
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  let words = ctx.args;
  let posix = false;
  if (words[0] === '-p') {
    posix = true;
    words = words.slice(1);
  }
  if (words[0] === '--') words = words.slice(1);
  const started = ctx.clock.now();
  let status = 0;
  const [first, ...rest] = words;
  if (first !== undefined) {
    // As bash's keyword does, time expands an alias in the command's place: `time ll`.
    const head = PLAIN.test(first) ? first : shellQuote(first);
    const line = expandAliases([head, ...rest.map(shellQuote)].join(' '), ctx.shell.aliases).line;
    status = await ctx.shell.exec(line, { stdin: ctx.stdin, stdout: ctx.stdout, stderr: ctx.stderr });
  }
  const real = Math.max(0, ctx.clock.now() - started) / 1000;
  const format = posix ? POSIX_FORMAT : (ctx.env.get('TIMEFORMAT') ?? DEFAULT_TIMEFORMAT);
  if (format === '') return status;
  const report = `${formatTimes(format, { real, user: 0, sys: 0 })}\n`;
  // At the prompt the report shows with the output, without the bell an error rings; anywhere
  // else it goes to standard error, as bash's does, so a pipe or a file does not take it.
  await (ctx.stdout.isTTY && ctx.stderr.isTTY ? ctx.stdout : ctx.stderr).write(report);
  return status;
}
