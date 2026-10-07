// The body of watch; its spec, in watch.ts, loads this the first time watch runs.

import { CaptureOut } from '../../../shell/streams';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { HOST } from '../../../vfs/identity';
import { ctimeText, wallClock } from '../../lib/sysread';

/** What --help, help and man say about watch, besides its spec (watch.ts). */
export const doc: CommandDoc = {
  description:
    "Runs COMMAND every 2 seconds, or every -n SECONDS, until ^C (or the cancel chip on a phone), and shows its output under a title with the interval, the command, the host and the time. COMMAND is a line for the shell, so `watch 'ls | wc -l'` works. vesen's screen keeps what has been printed rather than drawing over it, so watch prints the output again only when it has changed, each time under a new title, and leaves the rest of the screen as it was. -g stops when the output changes, -q CYCLES when it has stayed the same for that many runs, -t leaves out the title, and -b rings the bell when COMMAND fails.",
  man: [{ heading: 'EXIT STATUS', body: '0 when -g or -q stopped it, 130 for ^C, 1 for a mistake in the options.' }],
};

/** The title line: the interval and the command on the left, the host and the time on the right. */
function title(ctx: CommandContext, seconds: number, line: string): string[] {
  const left = `Every ${seconds.toFixed(1)}s: ${line}`;
  const right = `${HOST}: ${ctimeText(wallClock(ctx, ctx.clock.now()))}`;
  const columns = ctx.stdout.columns;
  if (left.length + 2 + right.length <= columns) return [`${left}${' '.repeat(columns - left.length - right.length)}${right}`, ''];
  return [left, right, ''];
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args.length === 0) return ctx.usage('no command given');
  const given = ctx.opts.interval;
  let seconds = 2;
  if (typeof given === 'string') {
    const parsed = Number(given.replace(',', '.'));
    if (!/^\d*[.,]?\d+$/.test(given) || !Number.isFinite(parsed)) return ctx.usage(`failed to parse argument: '${given}'`);
    seconds = Math.max(0.1, parsed);
  }
  const cycles = typeof ctx.opts.equexit === 'number' ? ctx.opts.equexit : null;
  if (cycles !== null && cycles < 1) return ctx.usage(`failed to parse argument: '${cycles}'`);
  // As procps does, the words are joined into one line for the shell.
  const line = ctx.args.join(' ');
  let previous: string | null = null;
  let unchanged = 0;
  for (;;) {
    const capture = new CaptureOut(ctx.stdout.columns);
    const status = await ctx.shell.exec(line, { stdout: capture, stderr: capture });
    const output = capture.text;
    if (status !== 0 && ctx.opts.beep === true) ctx.tty.bell();
    if (output !== previous) {
      if (previous !== null && ctx.opts['no-title'] !== true) await ctx.stdout.write('\n');
      const head = ctx.opts['no-title'] === true ? [] : title(ctx, seconds, line);
      await ctx.stdout.write(`${head.map((row) => `${row}\n`).join('')}${output}${output === '' || output.endsWith('\n') ? '' : '\n'}`);
    }
    if (previous !== null) {
      if (output !== previous && ctx.opts.chgexit === true) return 0;
      unchanged = output === previous ? unchanged + 1 : 0;
      if (cycles !== null && unchanged >= cycles) return 0;
    }
    previous = output;
    await ctx.clock.sleep(seconds * 1000, ctx.signal);
  }
}
