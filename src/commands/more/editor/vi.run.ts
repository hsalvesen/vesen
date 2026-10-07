// The body of vi and vim: a one-line note, then nano on the same file.

import { out } from '../../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { edit } from './nano.run';

/** What --help, help and man say about vi, besides its spec (vi.ts). */
export const doc: CommandDoc = {
  description:
    "vesen has no vi or vim. Both say so in one line, then open nano on the same FILE, where ^O and Enter save and ^X leaves. 'man nano' lists its keys.",
};

export async function run(ctx: CommandContext): Promise<ExitCode> {
  await ctx.stderr.line(out.span(`vesen has no ${ctx.name}; opening nano`, { fg: 'muted' }));
  return edit(ctx);
}
