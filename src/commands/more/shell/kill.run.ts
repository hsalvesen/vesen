// The body of kill; its spec, in kill.ts, loads this the first time kill runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { endSession, sendSignal, SIGNALS, signalNumber } from '../../lib/procs';

/** What --help, help and man say about kill, besides its spec (kill.ts). */
export const doc: CommandDoc = {
  description:
    "Sends a signal, TERM unless one is named, to each PID. The processes are the ones ps shows. init (pid 1) belongs to root, so signalling it is not permitted. The shell (pid $$) ignores TERM and INT, as an interactive shell does, but HUP or KILL end the session. A command of the line running now, such as one `ps` listed, ends that line, as ^C does. Any other PID is no such process: vesen runs one line at a time, so nothing is left running in the background. Signal 0 sends nothing and only asks whether the process is there. -l lists the signals, or turns a number into a name and a name into a number.",
  man: [{ heading: 'EXIT STATUS', body: '0 when every signal was sent; 1 when one could not be, or a signal is unknown; 2 for a mistake in the options.' }],
};

const USAGE = 'usage: kill [-s sigspec | -n signum | -sigspec] pid | jobspec ... or kill -l [sigspec]';

/** `kill -l`: the signals five to a line, as bash lists them. */
function signalTable(): string {
  const cells = SIGNALS.slice(1).map((name, i) => `${String(i + 1).padStart(2)}) SIG${name}`);
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += 5) rows.push(cells.slice(i, i + 5).join('\t'));
  return `${rows.join('\n')}\n`;
}

/** `kill -l SPEC`: a number's name, or a name's number; an exit status above 128 is its signal. */
async function listOne(ctx: CommandContext, spec: string): Promise<boolean> {
  if (/^\d+$/.test(spec)) {
    const n = Number(spec) > 128 ? Number(spec) - 128 : Number(spec);
    const name = SIGNALS[n];
    if (n < 1 || name === undefined) return false;
    await ctx.stdout.write(`${name}\n`);
    return true;
  }
  const n = signalNumber(spec);
  if (n === null || n === 0) return false;
  await ctx.stdout.write(`${n}\n`);
  return true;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const words = ctx.args;
  if (words.length === 0) return ctx.fail(USAGE, 2);
  let signal = 15;
  let i = 0;
  while (i < words.length) {
    const word = words[i] ?? '';
    if (word === '--') {
      i += 1;
      break;
    }
    if (word === '-l' || word === '-L') {
      const specs = words.slice(i + 1);
      if (specs.length === 0) {
        await ctx.stdout.write(signalTable());
        return 0;
      }
      let status = 0;
      for (const spec of specs) if (!(await listOne(ctx, spec))) status = await ctx.fail(`${spec}: invalid signal specification`);
      return status;
    }
    if (word === '-s' || word === '-n') {
      const spec = words[i + 1];
      if (spec === undefined) return ctx.fail(`${word}: option requires an argument`, 2);
      const n = word === '-n' && !/^\d+$/.test(spec) ? null : signalNumber(spec);
      if (n === null) return ctx.fail(`${spec}: invalid signal specification`);
      signal = n;
      i += 2;
      continue;
    }
    // -9, -KILL or -SIGKILL; the first word without a dash is the first PID.
    if (!word.startsWith('-') || word === '-') break;
    const n = signalNumber(word.slice(1));
    if (n === null) return ctx.fail(`${word.slice(1)}: invalid signal specification`);
    signal = n;
    i += 1;
  }
  const targets = words.slice(i);
  if (targets.length === 0) return ctx.fail(USAGE, 2);
  let status = 0;
  let endsSession = false;
  for (const target of targets) {
    if (target.startsWith('%')) {
      status = await ctx.fail(`${target}: no such job`);
      continue;
    }
    if (!/^-?\d+$/.test(target)) {
      status = await ctx.fail(`${target}: arguments must be process or job IDs`);
      continue;
    }
    const pid = Math.abs(Number(target));
    const sent = sendSignal(ctx, pid, signal);
    if (sent === 'denied') status = await ctx.fail(`(${pid}) - Operation not permitted`);
    else if (sent === 'missing') status = await ctx.fail(`(${pid}) - No such process`);
    else if (sent === 'shell') endsSession = true;
  }
  if (endsSession) return endSession(ctx, signal);
  return status;
}
