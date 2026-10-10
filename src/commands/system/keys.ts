// keys: show or hide the key bar in the phone dock (docs/plan/04-phone-and-instagram.md, "Dock,
// chips and key bar"). The bar (tab, ↑, ↓, ^C, clear, a page of symbols, and ▾ to put the
// keyboard away) rides above a touch screen's keyboard. Under `auto`, the default, it goes once a
// hardware keyboard is used there, and the chips stay. The setting is remembered.

import { out } from '../../output/model';
import type { KeyBarState } from '../../services/types';
import { defineCommand, type CommandContext, type EnumValue, type ExitCode } from '../../shell/types';

const MODES: readonly EnumValue[] = [
  { value: 'auto', summary: 'shown until a hardware keyboard is used (the default)' },
  { value: 'on', summary: 'always shown' },
  { value: 'off', summary: 'never shown; the chips stay' },
];

/** The setting and what it comes to, in words: `auto (shown until a hardware keyboard is used)`. */
export function describeKeyBar(state: KeyBarState, touch: boolean): string {
  if (state.mode === 'on') return 'on (always shown)';
  if (state.mode === 'off') return 'off (never shown; the chips stay)';
  if (state.hardware) return `${state.mode} (hidden: a hardware keyboard was used)`;
  return touch ? `${state.mode} (shown until a hardware keyboard is used)` : state.mode;
}

async function report(ctx: CommandContext, prefix: string): Promise<ExitCode> {
  await ctx.stdout.write(`${prefix}${describeKeyBar(ctx.appearance.keyBar(), ctx.tty.touch)}.\n`);
  // On a desktop the dock, and its key bar, only show with ?dock=1.
  if (!ctx.tty.touch) await ctx.stdout.line(out.span('The key bar is part of the dock on touch screens.', { fg: 'muted' }));
  return 0;
}

export default defineCommand({
  name: 'keys',
  category: 'system',
  summary: 'show or hide the key bar on touch screens',
  synopsis: ['keys', 'keys auto|on|off'],
  description:
    "On a touch screen, a bar of keys rides above the keyboard: tab, ↑ and ↓ for history (hold ↑ for the list), ^C, clear, ••• for symbols, and ▾ to put the keyboard away. With 'auto', the default, it goes once a hardware keyboard is used, and the suggestion chips stay; 'on' always shows it and 'off' never does. The setting is remembered. With no argument, says which is in force.",
  // --help is `help keys`: the keys themselves, then this.
  handlesHelp: true,
  flags: [{ long: 'help', description: 'display the keys and this help, and exit' }],
  args: [{ name: 'MODE', source: { kind: 'enum', values: () => MODES, caseInsensitive: true }, optional: true }],
  examples: [
    { line: 'keys', note: 'which is in force', offline: true },
    { line: 'keys on', note: 'always show the key bar', offline: true },
    { line: 'keys auto', note: 'the default', offline: true },
  ],
  seeAlso: ['help'],
  async run(ctx) {
    if (ctx.opts.help === true) {
      const { keysTopic } = await import('../../shell/help');
      for (const block of keysTopic({ touch: ctx.tty.touch, spec: ctx.spec })) await ctx.stdout.block(block);
      return 0;
    }
    const [mode, extra] = ctx.args;
    if (mode === undefined) return report(ctx, 'Key bar: ');
    if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
    if (!ctx.appearance.setKeyBar(mode)) {
      await ctx.stderr.line(out.span(`keys: ${mode}: not a setting`, { fg: 'error' }));
      await ctx.stderr.line(out.span(`Choose one of: ${ctx.appearance.keyBarModes().join(', ')}.`, { fg: 'muted' }));
      return 1;
    }
    return report(ctx, 'Key bar set to ');
  },
});
