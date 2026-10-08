// The body of figlet; its spec, in figlet.ts, loads this the first time figlet runs.

import { out } from '../../../output/model';
import { stripSgr } from '../../../output/sgr';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { figlet, FONT_HEIGHT, type FigletOptions } from '../../lib/block-font';
import { readAtMost } from '../../lib/text-input';

/** The widest -w takes: wider would only fill the page with spaces. */
export const MAX_WIDTH = 1000;

/**
 * The longest message figlet draws, in characters. Each becomes about 30 characters of drawing,
 * so this keeps one figlet to a few screens, however much is piped into it.
 */
export const MAX_MESSAGE = 4096;

/** The font's own name, and the default's, which -f accepts (figlet.ts lists them for Tab). */
const FONT_NAMES = new Set(['block', 'standard']);

/** What --help, help and man say about figlet, besides its spec (figlet.ts). */
export const doc: CommandDoc = {
  description: `Writes TEXT in block letters ${FONT_HEIGHT} rows high, in a font drawn for vesen: the letters A to Z (lower case is written as capitals), the digits and the usual punctuation; anything else is written as a question mark. With no TEXT it writes what is piped into it, a line at a time, and with nothing piped in either, its own name. Words that do not fit the width move to a new row of letters, and a word too long for it is cut.`,
  man: [
    {
      heading: 'FONTS',
      body: 'vesen has one font, block, which is also the default font, so -f block and -f standard (with or without .flf) change nothing. Any other font cannot be opened.',
    },
    {
      heading: 'LIMITS',
      body: `WIDTH is 1 to ${MAX_WIDTH} columns, and the message at most ${MAX_MESSAGE} characters: a longer one is refused as too long rather than drawn.`,
    },
    { heading: 'EXIT STATUS', body: `0, or 1 for a font that cannot be opened, a WIDTH outside 1 to ${MAX_WIDTH} or a message that is too long.` },
  ],
};

/** -c, -r or -l, the first that was given in that order. */
function alignment(ctx: CommandContext): FigletOptions['align'] {
  if (ctx.opts.center === true) return 'center';
  if (ctx.opts.right === true) return 'right';
  return 'left';
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const font = ctx.opts.f;
  if (typeof font === 'string' && !FONT_NAMES.has(font.replace(/\.flf$/, ''))) return ctx.fail(`${font}: Unable to open font file`);
  const given = ctx.opts.width;
  const width = typeof given === 'number' ? given : ctx.stdout.isTTY ? Math.min(MAX_WIDTH, ctx.stdout.columns) : 80;
  if (width < 1) return ctx.usage(`invalid width '${String(given)}'`);
  if (width > MAX_WIDTH) return ctx.usage(`invalid width '${String(given)}': Numerical result out of range`);

  let text: string | null;
  if (ctx.args.length > 0) text = ctx.args.join(' ');
  else if (ctx.stdin.isTTY) text = 'vesen';
  else text = await readAtMost(ctx, MAX_MESSAGE);
  if (text === null || text.length > MAX_MESSAGE) return ctx.fail(`message too long (over ${MAX_MESSAGE} characters)`);
  text = stripSgr(text);

  const drawn = figlet(text, { width, align: alignment(ctx) });
  await ctx.stdout.block(out.art(drawn, text.replace(/\s+/g, ' ').trim() || 'blank', 'scale'));
  return 0;
}
