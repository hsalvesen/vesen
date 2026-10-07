// The body of cathode; its spec, in cathode.ts, loads this the first time cathode runs, so the
// kernel's chunk carries only the spec.

import { out, type Line, type SpanStyle } from '../../output/model';
import type { CathodeTier } from '../../services/types';
import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { CURRENT_MARK } from './theme';

/** What --help, help and man say about cathode, besides its spec (cathode.ts). */
export const doc: CommandDoc = {
  description:
    "Draws the terminal as a cathode ray tube would: scanlines, phosphor glow, flicker. 'cathode ls' lists the variations and the quality in force. The quality, auto unless you choose, is how much of the effect the device draws: full on a desktop, lite on phones and in-app browsers, off when the system asks for less motion or more contrast.",
};

const STRONG: SpanStyle = { fg: 'fg-strong' };
const MUTED: SpanStyle = { fg: 'muted' };
const ACCENT: SpanStyle = { fg: 'accent' };

/** The tier in force and why: `lite (auto: a touch screen)`. */
export function describeTier({ tier, reason, quality }: CathodeTier): string {
  return `${tier} (${quality === 'auto' ? `auto: ${reason}` : reason})`;
}

async function list(ctx: CommandContext): Promise<ExitCode> {
  const modes = ctx.appearance.cathodeModes();
  const current = ctx.appearance.currentCathode();
  const width = Math.max(...modes.map((mode) => mode.name.length));
  const rows: Line[] = [[out.span('Cathode variations (current marked):', ACCENT)]];
  for (const mode of modes) {
    const isCurrent = mode.name === current;
    rows.push([
      out.live(isCurrent ? CURRENT_MARK : ' '.repeat(CURRENT_MARK.length), { kind: 'isCurrentCathode', mode: mode.name, marker: CURRENT_MARK }, ACCENT),
      { ...out.run(mode.name, `cathode set ${mode.name}`, STRONG), live: { kind: 'isCurrentCathode', mode: mode.name } },
      out.span(' '.repeat(width - mode.name.length + 2)),
      out.span(mode.summary, STRONG),
    ]);
  }
  const qualities = ctx.appearance.cathodeQualities().join('|');
  rows.push(
    [],
    [out.span('Quality:', ACCENT), out.span(' '), out.span(describeTier(ctx.appearance.cathodeTier()), STRONG)],
    [],
    [out.span(`Trial one with: cathode set VARIATION, or ${ctx.tty.touch ? 'tap' : 'click'} a name.`, MUTED)],
    [out.span(`Change the quality with: cathode quality [${qualities}]`, MUTED)],
  );
  await ctx.stdout.block(out.lines(rows));
  return 0;
}

async function setMode(ctx: CommandContext, name: string): Promise<ExitCode> {
  if (!ctx.appearance.setCathode(name)) {
    await ctx.stderr.line(out.span(`cathode: ${name}: no such variation`, { fg: 'error' }));
    await ctx.stderr.line(out.span("Try 'cathode ls' to see all available variations.", MUTED));
    return 1;
  }
  const mode = ctx.appearance.currentCathode();
  await ctx.stdout.write(mode === 'off' ? 'Cathode effect turned off.\n' : `Cathode effect set to ${mode}. Try 'cathode ls' to compare the variations.\n`);
  return 0;
}

async function quality(ctx: CommandContext): Promise<ExitCode> {
  const [requested, extra] = ctx.args;
  if (requested === undefined) {
    await ctx.stdout.write(`Cathode quality: ${describeTier(ctx.appearance.cathodeTier())}\n`);
    await ctx.stdout.line(out.span(`Change it with: cathode quality [${ctx.appearance.cathodeQualities().join('|')}]`, MUTED));
    return 0;
  }
  if (extra !== undefined || !ctx.appearance.setCathodeQuality(requested)) {
    await ctx.stderr.line(out.span(`cathode: quality: ${ctx.args.join(' ')}: not a quality`, { fg: 'error' }));
    await ctx.stderr.line(out.span(`Choose one of: ${ctx.appearance.cathodeQualities().join(', ')}.`, MUTED));
    return 1;
  }
  const tier = ctx.appearance.cathodeTier();
  await ctx.stdout.write(`Cathode quality set to ${tier.quality}: ${describeTier(tier)}.\n`);
  return 0;
}

/** Runs cathode. */
export async function run(ctx: CommandContext): Promise<ExitCode | void> {
  switch (ctx.sub) {
    case 'ls':
      if (ctx.args.length > 0) return ctx.usage(`ls: extra operand '${ctx.args[0] ?? ''}'`);
      return list(ctx);
    case 'set': {
      const [name, extra] = ctx.args;
      if (name === undefined) return ctx.usage('set: missing variation');
      if (extra !== undefined) return ctx.usage(`set: extra operand '${extra}'`);
      return setMode(ctx, name);
    }
    case 'off':
      if (ctx.args.length > 0) return ctx.usage(`off: extra operand '${ctx.args[0] ?? ''}'`);
      return setMode(ctx, 'off');
    case 'quality':
      return quality(ctx);
  }
  const [name, extra] = ctx.args;
  if (name === undefined) {
    const { commandHelp } = await import('../../shell/help');
    for (const block of commandHelp({ ...ctx.spec, ...doc })) await ctx.stdout.block(block);
    return 0;
  }
  if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
  // The shortcut: `cathode vintage` is `cathode set vintage`.
  return setMode(ctx, name);
}
