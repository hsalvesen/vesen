// The body of lolcat; its spec, in lolcat.ts, loads this the first time lolcat runs. The colouring
// is in commands/lib/rainbow.ts.

import { out } from '../../../output/model';
import { stripSgr } from '../../../output/sgr';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { expandTabs } from '../../lib/cows';
import { reason } from '../../lib/files';
import { DEFAULT_FREQ, DEFAULT_SPREAD, rainbowLine, RAINBOW, type RainbowOptions } from '../../lib/rainbow';

/** What --help, help and man say about lolcat, besides its spec (lolcat.ts). */
export const doc: CommandDoc = {
  description: `Copies each FILE, or what is piped into it, to the terminal with every character in a colour of the rainbow, taken from the theme's own palette (${RAINBOW.length} colours), so it changes with the theme. The colours step along each line and start a little further on each new line, so the bands run diagonally. Into a pipe or a file the text goes on unchanged, since colour means nothing there. Colours already in the text are dropped first.`,
  man: [{ heading: 'EXIT STATUS', body: '0 when every FILE was read; 1 when any could not be, or for a SPREAD or FREQ that is not a number: lolcat carries on with the rest of the files.' }],
};

/** A positive number for -p, or any number for -F; null when it is not one. */
function number(value: unknown, fallback: number, positive: boolean): number | null {
  if (value === undefined) return fallback;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (String(value).trim() === '' || !Number.isFinite(n) || (positive && n <= 0)) return null;
  return n;
}

/** The text of FILE, or null after saying why it could not be read. */
async function readFile(ctx: CommandContext, file: string): Promise<string | null> {
  try {
    return ctx.fs.readFile(ctx.resolve(file));
  } catch (error) {
    await ctx.fail(`${file}: ${reason(error)}`);
    return null;
  }
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const spread = number(ctx.opts.spread, DEFAULT_SPREAD, true);
  if (spread === null) return ctx.usage(`invalid spread '${String(ctx.opts.spread)}'`);
  const freq = number(ctx.opts.freq, DEFAULT_FREQ, false);
  if (freq === null) return ctx.usage(`invalid frequency '${String(ctx.opts.freq)}'`);
  const seed = typeof ctx.opts.seed === 'number' ? ctx.opts.seed : Math.floor(ctx.clock.random() * 256);
  const options: RainbowOptions = { spread, freq, seed };
  const files = ctx.args.length === 0 ? ['-'] : ctx.args;

  if (!ctx.stdout.isTTY) {
    // Plain text where colour means nothing: copied as it came.
    let status = 0;
    for (const file of files) {
      if (file === '-') {
        for await (const chunk of ctx.stdin.chunks()) await ctx.stdout.write(chunk);
        continue;
      }
      const text = await readFile(ctx, file);
      if (text === null) status = 1;
      else await ctx.stdout.write(text);
    }
    return status;
  }

  if (ctx.args.length === 0 && ctx.stdin.isTTY) {
    await ctx.stderr.line(out.span('lolcat colours what is piped into it: try fortune | lolcat', { fg: 'muted' }));
    return 0;
  }

  let row = 0;
  const paint = (line: string): Promise<void> => ctx.stdout.line(...rainbowLine(expandTabs(stripSgr(line)), row++, options));
  let status = 0;
  for (const file of files) {
    if (file === '-') {
      for await (const line of ctx.stdin.lines()) await paint(line);
      continue;
    }
    const text = await readFile(ctx, file);
    if (text === null) {
      status = 1;
      continue;
    }
    const lines = text.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    for (const line of lines) await paint(line);
  }
  return status;
}
