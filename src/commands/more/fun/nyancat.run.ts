// The body of nyancat; its spec, in nyancat.ts, loads this the first time nyancat runs.

import { out } from '../../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { stillNyan } from '../../../lib/nyancat';
import { nyanedLine, nyanView, type NyanResult } from '../../lib/nyancat';

/** What --help, help and man say about nyancat, besides its spec (nyancat.ts). */
export const doc: CommandDoc = {
  description:
    "Nyan Cat, the Pop-Tart Cat, flies across the screen with its rainbow behind it, drawn in coloured text and filling the screen, to a chiptune of its song played on Sega Genesis instruments, until q, Esc or ^C (on a touch screen, a tap; the first tap starts it, sound and all). m mutes the sound. Like nyancat, it counts how long you have nyaned at the foot of the screen, and says so when it ends; -n leaves the count out, and -f FRAMES stops it after that many frames, fourteen a second. The picture bobs to the beat, and plays under reduced motion too, as an animation asked for. In a pipe, a script or $( ), it prints the cat standing still.",
  man: [
    {
      heading: 'AUTHORS',
      body: "The animation is K. Lange's nyancat (https://github.com/klange/nyancat), after prguitarman's Nyan Cat, under the University of Illinois/NCSA Open Source Licence: /licences/nyancat.txt has its notice.",
    },
    { heading: 'EXIT STATUS', body: '0 when it ended; 1 for FRAMES below 1, or an operand.' },
  ],
};

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const [extra] = ctx.args;
  if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
  const frames = typeof ctx.opts.frames === 'number' ? ctx.opts.frames : null;
  if (frames !== null && (!Number.isInteger(frames) || frames < 1)) return ctx.usage(`invalid number of frames '${String(ctx.opts.frames)}'`);
  const counter = ctx.opts['no-counter'] !== true;

  if (ctx.tty.interactive && ctx.stdout.isTTY) {
    try {
      const result = await ctx.tty.fullscreen<NyanResult | undefined>('nyan', nyanView(ctx.tty.touch, { counter, frames }));
      // As nyancat's count stood when it ended.
      if (counter && typeof result?.seconds === 'number') await ctx.stdout.line(out.span(nyanedLine(result.seconds), { bold: true }));
      return 0;
    } catch (error) {
      // ^C ends it as usual; with no full-screen app here, the cat is printed standing still.
      if (ctx.signal.aborted) throw error;
    }
  }
  await ctx.stdout.block(out.art(stillNyan(), 'Nyan Cat, standing still, its rainbow behind it', 'scale'));
  return 0;
}
