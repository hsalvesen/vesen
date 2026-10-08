// Fixed-width tables (column -t, free, finger, ps): padded with spaces so each column lines up.
// On a screen narrower than the table, wrapped rows would put numbers under the wrong headings,
// so there the table is a block that scrolls sideways, as tree's drawing is. Into a pipe or a
// file, and on a screen wide enough, it is written as it is.

import { out, textWidth } from '../../output/model';
import type { CommandContext } from '../../shell/types';

/** The width of the widest line of `text`, in cells. */
function widest(text: string): number {
  let most = 0;
  for (const line of text.split('\n')) most = Math.max(most, textWidth(line));
  return most;
}

/**
 * Writes a table (lines ending in a newline). `alt` is what a screen reader hears for the
 * scrolling block; the table's own text by default.
 */
export async function writeTable(ctx: CommandContext, text: string, alt: string = text): Promise<void> {
  // Text with escapes in it is written as it is, so its colours still show.
  if (ctx.stdout.isTTY && text !== '' && !text.includes('\u001b') && widest(text) > ctx.stdout.columns) {
    await ctx.stdout.block(out.art(text.replace(/\n$/, ''), alt.trim(), 'scroll'));
    return;
  }
  await ctx.stdout.write(text);
}
