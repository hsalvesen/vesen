// The body of figlet; its spec, in figlet.ts, loads this the first time figlet runs.

import { out } from '../../../output/model';
import { stripSgr } from '../../../output/sgr';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { figlet, FONT_HEIGHT, type FigletOptions } from '../../lib/block-font';

/** What --help, help and man say about figlet, besides its spec (figlet.ts). */
export const doc: CommandDoc = {
  description: `Writes TEXT in block letters ${FONT_HEIGHT} rows high, in a font drawn for vesen: the letters A to Z (lower case is written as capitals), the digits and the usual punctuation; anything else is written as a question mark. With no TEXT it writes what is piped into it, a line at a time, and with nothing piped in either, its own name. Words that do not fit the width move to a new row of letters, and a word too long for it is cut.`,
  man: [{ heading: 'EXIT STATUS', body: '0, or 1 for a WIDTH under 1.' }],
};

/** -c, -r or -l, the first that was given in that order. */
function alignment(ctx: CommandContext): FigletOptions['align'] {
  if (ctx.opts.center === true) return 'center';
  if (ctx.opts.right === true) return 'right';
  return 'left';
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const given = ctx.opts.width;
  const width = typeof given === 'number' ? given : ctx.stdout.isTTY ? ctx.stdout.columns : 80;
  if (width < 1) return ctx.usage(`invalid width '${String(given)}'`);

  let text: string;
  if (ctx.args.length > 0) text = ctx.args.join(' ');
  else if (ctx.stdin.isTTY) text = 'vesen';
  else text = stripSgr(await ctx.stdin.text());

  const drawn = figlet(text, { width, align: alignment(ctx) });
  await ctx.stdout.block(out.art(drawn, text.replace(/\s+/g, ' ').trim() || 'blank', 'scale'));
  return 0;
}
