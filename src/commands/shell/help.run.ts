// The body of help; its spec, in help.ts, loads this the first time help runs, so the kernel's
// chunk carries only the spec.

import { out } from '../../output/model';
import { categoryNamed } from '../../shell/registry';
import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { allCommands } from '../lib/catalogue';

/** What --help, help and man say about help, besides its spec (help.ts). */
export const doc: CommandDoc = {
  description:
    "With no COMMAND, lists eight commands of each category by name, the everyday ones, in a column per category, vesen's own first, with ... under a category that has more. With a CATEGORY (vesen, files, text, shell, system, network, fun or editor), lists every command in it; -v adds what each does, and with no CATEGORY -v (or -a) lists every command of every category that way. Tap a name to put it at the prompt. With a COMMAND, shows its options and examples, as 'COMMAND --help' does. 'help keys' lists the keys the terminal answers to.",
};

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const [help, registry] = await Promise.all([import('../../shell/help'), allCommands(ctx)]);
  const verbose = ctx.opts.verbose === true || ctx.opts.all === true;
  if (ctx.args.length === 0) {
    // On a terminal the categories are columns that reflow with the width; in a pipe, lines of names.
    for (const block of help.helpIndex(registry, { all: verbose, tty: ctx.stdout.isTTY })) await ctx.stdout.block(block);
    return 0;
  }
  let status = 0;
  for (const topic of ctx.args) {
    if (topic === 'keys') {
      const keys = registry.get('keys');
      for (const block of help.keysTopic({ touch: ctx.tty.touch, ...(keys === undefined ? {} : { spec: keys }) })) await ctx.stdout.block(block);
      continue;
    }
    // A category: every one of its commands (help files, help -v files).
    const category = categoryNamed(topic);
    if (category !== undefined) {
      for (const block of help.categoryHelp(registry, category, { verbose, tty: ctx.stdout.isTTY })) await ctx.stdout.block(block);
      continue;
    }
    const spec = registry.get(topic);
    if (spec === undefined) {
      await ctx.stderr.line(out.span(`help: no help topics match '${topic}'`, { fg: 'error' }));
      await ctx.stderr.line(out.span(`Try 'help' for the list, or 'apropos ${topic}' to search it.`, { fg: 'muted' }));
      status = 1;
      continue;
    }
    for (const block of help.commandHelp(await help.withDoc(spec))) await ctx.stdout.block(block);
  }
  return status;
}
