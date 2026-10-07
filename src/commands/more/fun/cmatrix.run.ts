// The body of cmatrix; its spec, in cmatrix.ts, loads this the first time cmatrix runs.

import { out } from '../../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { MATRIX_GLYPHS, stepFor, stillRain, type MatrixView } from '../../lib/matrix';

/** What --help, help and man say about cmatrix, besides its spec (cmatrix.ts). */
export const doc: CommandDoc = {
  description:
    "Fills the screen with characters falling in columns, in the theme's accent and green, until any key or a tap. It pauses while the page is hidden. When the system asks for reduced motion the rain stands still. In a pipe, a script or $( ), it prints one still screen of it.",
  man: [{ heading: 'EXIT STATUS', body: '0 when it was stopped; 1 for a DELAY outside 0 to 10, or an operand.' }],
};

/** The rows of the still screen printed outside the terminal. */
const STILL_ROWS = 12;

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const [extra] = ctx.args;
  if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
  const delay = typeof ctx.opts.u === 'number' ? ctx.opts.u : 4;
  if (!Number.isInteger(delay) || delay < 0 || delay > 10) return ctx.usage(`invalid delay '${String(ctx.opts.u)}': 0 to 10`);

  if (ctx.tty.interactive && ctx.stdout.isTTY) {
    const view: MatrixView = { glyphs: MATRIX_GLYPHS, stepMs: stepFor(delay), touch: ctx.tty.touch };
    try {
      await ctx.tty.fullscreen('matrix', view);
      return 0;
    } catch (error) {
      // ^C ends it as usual; with no full-screen app here, a still screen is printed instead.
      if (ctx.signal.aborted) throw error;
    }
  }
  const rows = Math.max(4, Math.min(STILL_ROWS, ctx.tty.rows));
  const still = stillRain(ctx.stdout.columns, rows, () => ctx.clock.random()).join('\n');
  await ctx.stdout.block(out.art(still, 'Characters falling down the screen, standing still', 'scale', { fg: 'ok' }));
  return 0;
}
