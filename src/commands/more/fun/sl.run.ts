// The body of sl; its spec, in sl.ts, loads this the first time sl runs.

import { out } from '../../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { STILL_LABEL, trainFrame, trainView, type TrainResult } from '../../lib/train';

/** What --help, help and man say about sl, besides its spec (sl.ts). */
export const doc: CommandDoc = {
  description:
    'A steam train, drawn for vesen, crosses the screen once from right to left, for when ls was meant. Any key or a tap stops it early. When the system asks for reduced motion the train stands still for a moment instead. In a pipe, a script or $( ), it prints the train standing still.',
  man: [{ heading: 'EXIT STATUS', body: '0, however the train left; 1 for an operand.' }],
};

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const [extra] = ctx.args;
  if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
  const view = trainView();
  if (ctx.tty.interactive && ctx.stdout.isTTY) {
    try {
      await ctx.tty.fullscreen<TrainResult>('sl', view);
      return 0;
    } catch (error) {
      // ^C ends it as usual; with no full-screen app here, the train is printed instead.
      if (ctx.signal.aborted) throw error;
    }
  }
  await ctx.stdout.block(out.art(trainFrame(0), STILL_LABEL, 'scale'));
  return 0;
}
