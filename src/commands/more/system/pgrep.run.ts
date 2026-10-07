// The bodies of pgrep and pkill; their specs, in pgrep.ts and pkill.ts, load this the first time
// either runs. Both select over the process table ps shows (lib/procs.ts), with the pattern
// through the shared guard for visitors' regular expressions (lib/regex.ts).

import { FlagError, parseFlags } from '../../../shell/flags';
import type { CommandContext, CommandDoc, ExitCode, OptValue } from '../../../shell/types';
import { endSession, processTable, sendSignal, signalNumber, type Proc } from '../../lib/procs';
import { compilePattern, matches, PatternError } from '../../lib/regex';

/** What --help, help and man say about pgrep, besides its spec (pgrep.ts). */
export const doc: CommandDoc = {
  description:
    "Prints the pid of each running process whose name matches PATTERN, an extended regular expression, one to a line. The processes are the ones ps shows: init, the shell vesh, and the commands of the line running now; pgrep never lists itself. -f matches the whole command line, -x the whole name, -i ignores case and -v selects the ones that do not match. -l and -a print the name or command line beside each pid, -c prints how many, and -n and -o pick the newest or the oldest. A pattern that could run for ever, such as (a+)+, is refused.",
  man: [{ heading: 'EXIT STATUS', body: '0 when a process matched, 1 when none did, 2 for a mistake in the options or the pattern.' }],
};

/** What --help, help and man say about pkill, besides its spec (pkill.ts). */
export const pkillDoc: CommandDoc = {
  description:
    "Sends a signal, TERM unless -SIGNAL or --signal names another, to each running process whose name matches PATTERN, chosen as pgrep chooses them. A command of the line running now ends that line, as ^C does. init belongs to root, so signalling it is not permitted. The shell ignores TERM, as an interactive shell does, but HUP or KILL end the session. Signal 0 sends nothing: it only asks whether a process is there. -e says which processes were signalled.",
  man: [{ heading: 'EXIT STATUS', body: '0 when a process matched, 1 when none did, 2 for a mistake in the options or the pattern.' }],
};

interface Selection {
  readonly opts: Readonly<Record<string, OptValue>>;
  readonly chosen: readonly Proc[];
}

/** The processes the options and PATTERN pick, or the status of the mistake that was reported. */
async function select(ctx: CommandContext, words: readonly string[]): Promise<Selection | ExitCode> {
  let parsed: ReturnType<typeof parseFlags>;
  try {
    parsed = parseFlags(words, ctx.spec, { interceptHelp: false });
  } catch (error) {
    if (error instanceof FlagError) return ctx.usage(error.message);
    throw error;
  }
  const { opts, args } = parsed;
  const [pattern, extra] = args;
  if (extra !== undefined) return ctx.usage('only one pattern can be provided');
  const users = typeof opts.euid === 'string' ? opts.euid.split(',') : [];
  if (pattern === undefined && users.length === 0) return ctx.usage('no matching criteria specified');
  let re: RegExp | null = null;
  if (pattern !== undefined) {
    try {
      re = compilePattern(opts.exact === true ? `^(?:${pattern})$` : pattern, { ignoreCase: opts['ignore-case'] === true });
    } catch (error) {
      if (error instanceof PatternError) return ctx.fail(error.message, 2);
      throw error;
    }
  }
  const picked = processTable(ctx).filter((proc) => {
    if (proc.self) return false;
    if (users.length > 0 && !users.includes(proc.user) && !users.includes(String(proc.uid))) return false;
    const hit = re === null || matches(re, opts.full === true ? proc.args : proc.comm);
    return opts.inverse === true ? !hit : hit;
  });
  const byAge = [...picked].sort((a, b) => a.startedAt - b.startedAt || a.pid - b.pid);
  const newest = byAge[byAge.length - 1];
  const oldest = byAge[0];
  const chosen = opts.newest === true ? (newest ? [newest] : []) : opts.oldest === true ? (oldest ? [oldest] : []) : picked;
  return { opts, chosen };
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const found = await select(ctx, ctx.args);
  if (typeof found === 'number') return found;
  const { opts, chosen } = found;
  if (opts.count === true) {
    await ctx.stdout.write(`${chosen.length}\n`);
    return chosen.length > 0 ? 0 : 1;
  }
  const lines = chosen.map((proc) => (opts['list-full'] === true ? `${proc.pid} ${proc.args}` : opts['list-name'] === true ? `${proc.pid} ${proc.comm}` : String(proc.pid)));
  const delimiter = typeof opts.delimiter === 'string' ? opts.delimiter : '\n';
  if (lines.length > 0) await ctx.stdout.write(`${lines.join(delimiter)}\n`);
  return chosen.length > 0 ? 0 : 1;
}

/** `-9`, `-KILL` or `-SIGKILL` first, as pkill reads a signal; null when the first word is not one. */
function leadingSignal(word: string | undefined): number | null {
  if (word === undefined || !/^-(?:\d+|[A-Z][A-Z0-9]*)$/.test(word)) return null;
  return signalNumber(word.slice(1));
}

export async function runPkill(ctx: CommandContext): Promise<ExitCode> {
  let words = ctx.args;
  let signal = 15;
  const first = leadingSignal(words[0]);
  if (first !== null) {
    signal = first;
    words = words.slice(1);
  } else if (words[0] !== undefined && /^-[A-Z]/.test(words[0])) {
    return ctx.usage(`unknown signal name ${words[0].slice(1)}`);
  }
  const found = await select(ctx, words);
  if (typeof found === 'number') return found;
  const { opts, chosen } = found;
  if (typeof opts.signal === 'string') {
    const given = signalNumber(opts.signal);
    if (given === null) return ctx.usage(`unknown signal name ${opts.signal}`);
    signal = given;
  }
  let endsSession = false;
  for (const proc of chosen) {
    if (opts.echo === true) await ctx.stdout.write(`${proc.comm} killed (pid ${proc.pid})\n`);
    const sent = sendSignal(ctx, proc.pid, signal);
    if (sent === 'denied') await ctx.fail(`killing pid ${proc.pid} failed: Operation not permitted`);
    if (sent === 'shell') endsSession = true;
  }
  if (endsSession) return endSession(ctx, signal);
  return chosen.length > 0 ? 0 : 1;
}
