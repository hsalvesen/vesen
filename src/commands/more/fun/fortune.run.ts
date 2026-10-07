// The body of fortune; its spec, in fortune.ts, loads this the first time fortune runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { FORTUNES, isShort, pickFortune, SHORT_MAX } from '../../lib/fortunes';

/** What --help, help and man say about fortune, besides its spec (fortune.ts). */
export const doc: CommandDoc = {
  description: `Prints one saying, chosen at random, about computers, terminals and the shell, or the animals the themes are named after. Every one was written for vesen, and they are all here, so fortune works offline. -s keeps to the short ones: a single line of ${SHORT_MAX} characters or fewer.`,
  man: [{ heading: 'EXIT STATUS', body: '0, unless an operand is given: 1.' }],
};

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const [extra] = ctx.args;
  if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
  const pool = ctx.opts.short === true ? FORTUNES.filter(isShort) : FORTUNES;
  await ctx.stdout.write(`${pickFortune(pool, () => ctx.clock.random())}\n`);
  return 0;
}
