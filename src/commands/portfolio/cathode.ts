// cathode: trial a CRT (cathode ray tube) effect, and choose how much of it the device draws.
// The mode is the look; the quality (auto, full, lite or off) overrides the tier the device would
// get, and `cathode ls` says which tier is in force and why. The current mode's marker is live,
// so it moves in every earlier listing (F030).

import { out, type Line, type SpanStyle } from '../../output/model';
import type { CathodeTier } from '../../services/types';
import { defineCommand, type ArgSpec, type CommandContext, type EnumValue, type ExitCode, type ValueContext } from '../../shell/types';
import { CURRENT_MARK } from './theme';

const STRONG: SpanStyle = { fg: 'fg-strong' };
const MUTED: SpanStyle = { fg: 'muted' };
const ACCENT: SpanStyle = { fg: 'accent' };

function modeValues(context?: ValueContext): readonly EnumValue[] {
  return (context?.appearance?.cathodeModes() ?? []).map((mode) => ({ value: mode.name, summary: mode.summary }));
}

function qualityValues(context?: ValueContext): readonly EnumValue[] {
  return (context?.appearance?.cathodeQualities() ?? []).map((value) => ({ value }));
}

const MODE: ArgSpec = { name: 'VARIATION', source: { kind: 'enum', values: modeValues, caseInsensitive: true } };

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

export default defineCommand({
  name: 'cathode',
  category: 'portfolio',
  summary: 'trial a retro CRT display effect',
  synopsis: ['cathode ls', 'cathode set VARIATION', 'cathode VARIATION', 'cathode off', 'cathode quality [QUALITY]'],
  description:
    "Draws the terminal as a cathode ray tube would: scanlines, phosphor glow, flicker. 'cathode ls' lists the variations and the quality in force. The quality, auto unless you choose, is how much of the effect the device draws: full on a desktop, lite on phones and in-app browsers, off when the system asks for less motion or more contrast.",
  subcommands: {
    ls: { summary: 'list the variations, and the quality in force' },
    set: { summary: 'turn on the effect VARIATION', args: [MODE] },
    off: { summary: 'turn the effect off' },
    quality: {
      summary: 'choose how much of the effect to draw: auto, full, lite or off',
      args: [{ name: 'QUALITY', source: { kind: 'enum', values: qualityValues, caseInsensitive: true }, optional: true }],
    },
  },
  args: [{ ...MODE, optional: true }],
  examples: [
    { line: 'cathode ls', offline: true },
    { line: 'cathode set vintage', note: 'the full retro set', offline: true },
    { line: 'cathode quality lite', note: 'a lighter effect', offline: true },
    { line: 'cathode off', offline: true },
  ],
  seeAlso: ['theme'],
  async run(ctx) {
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
      for (const block of commandHelp(ctx.spec)) await ctx.stdout.block(block);
      return 0;
    }
    if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
    // The shortcut: `cathode vintage` is `cathode set vintage`.
    return setMode(ctx, name);
  },
});
