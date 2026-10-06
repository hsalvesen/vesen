// sleep: pause for a while, as coreutils' sleep does. Ctrl+C (or ^C and cancel on a phone) ends it at once with 130.

import { out } from '../../output/model';
import { defineCommand, type CommandContext, type ExitCode } from '../../shell/types';
import { tryHelp } from '../../shell/flags';

const UNIT_MS: Readonly<Record<string, number>> = { '': 1000, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const INTERVAL = /^(\d+(?:\.\d*)?|\.\d+)([smhd]?)$/;
/** setTimeout's longest wait; longer sleeps wait in turns. */
const LONGEST = 2_147_483_647;

/** The milliseconds `text` stands for, Infinity for `infinity`, or null when it is not a time. */
export function interval(text: string): number | null {
  if (text === 'inf' || text === 'infinity') return Number.POSITIVE_INFINITY;
  const match = INTERVAL.exec(text);
  if (match === null) return null;
  return Number(match[1]) * (UNIT_MS[match[2] ?? ''] ?? 1000);
}

async function complain(ctx: CommandContext, message: string): Promise<ExitCode> {
  await ctx.stderr.line(out.span(`sleep: ${message}`, { fg: 'error' }));
  await ctx.stderr.line(out.span(tryHelp('sleep'), { fg: 'muted' }));
  return 1;
}

export default defineCommand({
  name: 'sleep',
  category: 'shell',
  summary: 'delay for a specified amount of time',
  synopsis: ['sleep NUMBER[SUFFIX]...'],
  description:
    "Pauses for NUMBER seconds; with several, for their sum. NUMBER may have a fraction. A SUFFIX of s, m, h or d means seconds, minutes, hours or days, and 'infinity' never ends. Ctrl+C ends it at once; on a phone, so do ^C and the cancel chip.",
  args: [{ name: 'NUMBER', source: { kind: 'free', placeholder: 'seconds' }, variadic: true }],
  loadingLabel: (argv) => `sleeping ${argv.slice(1).join(' ')}`.trimEnd(),
  examples: [
    { line: 'sleep 0.5', offline: true },
    { line: 'sleep 2 && echo awake', note: 'then a command' },
  ],
  seeAlso: ['date'],
  async run(ctx) {
    if (ctx.args.length === 0) return complain(ctx, 'missing operand');
    let total = 0;
    for (const word of ctx.args) {
      const ms = interval(word);
      if (ms === null) return complain(ctx, `invalid time interval '${word}'`);
      total += ms;
    }
    // Ends early only by ^C, which rejects with the job's reason.
    while (total > 0) {
      const turn = Math.min(total, LONGEST);
      await ctx.clock.sleep(turn, ctx.signal);
      total -= turn;
    }
    return 0;
  },
});
