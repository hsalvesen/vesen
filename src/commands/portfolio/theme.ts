// theme: list the colour themes with a preview of each, or switch to one, by name in any case.
// Output is drawn in theme tokens, so a switch recolours everything already on the screen; the
// marker and the highlight on the current theme in `theme ls` are live, so they move too, in
// every earlier listing (F075, F030, F009). The theme is remembered by name.

import { out, type Line, type SpanStyle } from '../../output/model';
import { defineCommand, PLAIN_ARG, type ArgSpec, type CommandContext, type EnumValue, type ExitCode, type ValueContext } from '../../shell/types';

/** The mark beside the current theme in a listing. */
export const CURRENT_MARK = '› ';

const STRONG: SpanStyle = { fg: 'fg-strong' };
const MUTED: SpanStyle = { fg: 'muted' };

/** The themes, for Tab and the chips, each with its background as a swatch. */
function themeValues(context?: ValueContext): readonly EnumValue[] {
  return (context?.appearance?.themes() ?? []).map((theme) => ({ value: theme.name.toLowerCase(), summary: theme.name, swatch: theme.background }));
}

const NAME: ArgSpec = { name: 'NAME', source: { kind: 'enum', values: themeValues, caseInsensitive: true } };

async function list(ctx: CommandContext): Promise<ExitCode> {
  const themes = ctx.appearance.themes();
  // In a pipe, the names, one per line, as `ls | cat` gives them.
  if (!ctx.stdout.isTTY) {
    for (const theme of themes) await ctx.stdout.write(`${theme.name}\n`);
    return 0;
  }
  const current = ctx.appearance.currentTheme().toLowerCase();
  const width = Math.max(...themes.map((theme) => theme.name.length));
  const rows: Line[] = themes.map((theme) => {
    const isCurrent = theme.name.toLowerCase() === current;
    return [
      out.live(isCurrent ? CURRENT_MARK : ' '.repeat(CURRENT_MARK.length), { kind: 'isCurrentTheme', theme: theme.name, marker: CURRENT_MARK }, { fg: 'accent' }),
      // A tap switches to it.
      { ...out.run(theme.name, `theme set ${theme.name}`, STRONG), live: { kind: 'isCurrentTheme', theme: theme.name } },
      out.span(' '.repeat(width - theme.name.length + 2)),
      out.swatches(theme.background, theme.swatches),
    ];
  });
  rows.push([], [out.span(`Try one with: theme set NAME, or ${ctx.tty.touch ? 'tap' : 'click'} a name.`, MUTED)]);
  await ctx.stdout.block(out.lines(rows));
  return 0;
}

async function set(ctx: CommandContext, name: string): Promise<ExitCode> {
  if (!ctx.appearance.setTheme(name)) {
    await ctx.stderr.line(out.span(`theme: ${name}: no such theme`, { fg: 'error' }));
    await ctx.stderr.line(out.span("Try 'theme ls' to see all available themes.", MUTED));
    return 1;
  }
  await ctx.stdout.write(`Theme set to ${ctx.appearance.currentTheme()}.\n`);
  return 0;
}

export default defineCommand({
  name: 'theme',
  category: 'portfolio',
  summary: 'change the colour theme',
  synopsis: ['theme ls', 'theme set NAME', 'theme NAME'],
  description:
    "Switches the terminal to the theme NAME, in any case, and remembers it. 'theme ls' lists the themes, each with a preview of its colours; the current one is marked. Everything on the screen takes the new colours.",
  featured: true,
  subcommands: {
    ls: { summary: 'list the themes, each with its colours' },
    set: { summary: 'switch to the theme NAME', args: [NAME] },
  },
  args: [{ ...NAME, optional: true }],
  examples: [
    { line: 'theme ls', note: 'every theme, with its colours', offline: true, starter: 5 },
    { line: 'theme set cockatoo', note: 'the light one', offline: true },
    { line: 'theme swamphen', note: 'the default, without set', offline: true },
  ],
  seeAlso: ['cathode', 'reset'],
  // After the list, every theme is one tap away.
  next: ({ status, argv }, context) => {
    if (status !== 0 || argv[1] !== 'ls' || argv.length > 2) return [];
    return (context?.appearance?.themes() ?? [])
      .map((theme) => theme.name.toLowerCase())
      .filter((name) => PLAIN_ARG.test(name))
      .map((name) => `theme set ${name}`);
  },
  async run(ctx) {
    if (ctx.sub === 'ls') {
      if (ctx.args.length > 0) return ctx.usage(`ls: extra operand '${ctx.args[0] ?? ''}'`);
      return list(ctx);
    }
    if (ctx.sub === 'set') {
      const [name, extra] = ctx.args;
      if (name === undefined) return ctx.usage('set: missing theme name');
      if (extra !== undefined) return ctx.usage(`set: extra operand '${extra}'`);
      return set(ctx, name);
    }
    const [name, extra] = ctx.args;
    if (name === undefined) {
      const { commandHelp } = await import('../../shell/help');
      for (const block of commandHelp(ctx.spec)) await ctx.stdout.block(block);
      return 0;
    }
    if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
    // The shortcut: `theme wombat` is `theme set wombat`.
    return set(ctx, name);
  },
});
