// history: list, trim or clear the command history, as bash's builtin does. Lines are numbered
// as `!n` reads them, and the line that ran history is in it, as in bash. History is kept across
// reloads; `history -c` empties it, and so does reset.

import { out } from '../../output/model';
import { defineCommand } from '../../shell/types';

/** A whole number as bash's builtins read it, or null. */
function integer(text: string): number | null {
  return /^[+-]?\d+$/.test(text) ? Number(text) : null;
}

export default defineCommand({
  name: 'history',
  category: 'shell',
  summary: 'display or manipulate the command history',
  helpRank: 3,
  synopsis: ['history [N]', 'history -c', 'history -d OFFSET'],
  description:
    'Lists the lines typed so far, numbered, oldest first; with N, only the last N. !N runs line N again and !! the last one. History is kept across reloads, up to 500 lines; a line typed with a space in front is not kept.',
  builtin: true,
  posixArgs: true,
  flags: [
    { short: 'c', key: 'clear', description: 'clear the history' },
    {
      short: 'd',
      key: 'delete',
      description: 'delete the line at OFFSET; a negative OFFSET counts back from the end',
      value: { name: 'OFFSET', source: { kind: 'int' } },
    },
  ],
  args: [{ name: 'N', source: { kind: 'int' }, optional: true }],
  examples: [
    { line: 'history', offline: true },
    { line: 'history 5', note: 'the last five lines', offline: true },
    { line: 'history -c', note: 'forget everything typed', offline: true },
  ],
  seeAlso: ['reset', 'clear'],
  man: [
    {
      heading: 'HISTORY EXPANSION',
      body: '!! the last line, !N line N, !-N the Nth line back, !text the last line starting with text, !$ the last word of the last line, ^old^new the last line with old replaced by new.',
    },
  ],
  async run(ctx) {
    const history = ctx.shell.history;
    if (ctx.opts.clear === true) {
      history.clear();
      return 0;
    }
    const remove = ctx.opts.delete;
    if (remove !== undefined) {
      const entries = history.list();
      const offset = typeof remove === 'number' ? remove : integer(String(remove));
      const first = entries[0]?.n ?? 1;
      // A negative offset counts back from the end, as in bash 5.
      const n = offset === null ? null : offset < 0 ? (entries[entries.length + offset]?.n ?? null) : offset;
      if (n === null || n < first || history.get(n) === undefined) return ctx.fail(`${String(remove)}: history position out of range`);
      history.remove(n);
      return 0;
    }
    if (ctx.args.length > 1) return ctx.fail('too many arguments');
    const entries = history.list();
    let shown = entries;
    const [count] = ctx.args;
    if (count !== undefined) {
      const n = integer(count);
      if (n === null) return ctx.fail(`${count}: numeric argument required`);
      shown = n <= 0 ? [] : entries.slice(Math.max(0, entries.length - n));
    }
    for (const entry of shown) {
      await ctx.stdout.line(out.span(String(entry.n).padStart(5), { fg: 'accent' }), out.span(`  ${entry.line}`));
    }
    return 0;
  },
});
