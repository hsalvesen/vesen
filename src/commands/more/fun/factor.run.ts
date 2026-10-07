// The body of factor; its spec, in factor.ts, loads this the first time factor runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { FACTOR_MAX, parseWhole, primeFactors } from '../../lib/primes';

/** What --help, help and man say about factor, besides its spec (factor.ts). */
export const doc: CommandDoc = {
  description: `Prints each NUMBER, a colon, and its prime factors, smallest first, as many times as each divides it: 12: 2 2 3. With no NUMBER it reads numbers from what is piped into it, separated by spaces or lines. Numbers up to 2^64 - 1 (${FACTOR_MAX}) are taken; a larger one would take too long to factor in a browser, which cannot stop a sum halfway.`,
  man: [{ heading: 'EXIT STATUS', body: '0 when every NUMBER was factored; 1 when any was not a whole number, or too large: factor carries on with the rest.' }],
};

/** One number's line, or an error for it; true when it was factored. */
async function factorOne(ctx: CommandContext, word: string): Promise<boolean> {
  const n = parseWhole(word);
  if (n === null) {
    await ctx.fail(`'${word}' is not a valid positive integer`);
    return false;
  }
  if (n > FACTOR_MAX) {
    await ctx.fail(`'${word}' is too large`);
    return false;
  }
  const factors = primeFactors(n);
  await ctx.stdout.write(`${n}:${factors.map((p) => ` ${p}`).join('')}\n`);
  return true;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  let ok = true;
  if (ctx.args.length > 0) {
    for (const word of ctx.args) {
      if (ctx.signal.aborted) throw ctx.signal.reason;
      if (!(await factorOne(ctx, word))) ok = false;
    }
    return ok ? 0 : 1;
  }
  for await (const line of ctx.stdin.lines()) {
    for (const word of line.split(/\s+/)) {
      if (word === '') continue;
      if (ctx.signal.aborted) throw ctx.signal.reason;
      if (!(await factorOne(ctx, word))) ok = false;
    }
  }
  return ok ? 0 : 1;
}
