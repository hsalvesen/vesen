// The bodies of man, apropos and whatis; their specs (man.ts, apropos.ts, whatis.ts) load this the
// first time one of them runs, so the kernel's chunk carries only the specs.

import { out, type Block } from '../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { allCommands } from '../lib/catalogue';

/** What --help, help and man say about man, besides its spec (man.ts). */
export const doc: CommandDoc = {
  description:
    "Shows the manual page of each PAGE: what the command does, how to call it, its options, examples to run and related commands. 'man vesen' is about this terminal.",
};

/** man-db's status when a page is not found. */
export const NOT_FOUND = 16;

async function nothingFor(ctx: CommandContext, words: readonly string[]): Promise<ExitCode> {
  for (const word of words) await ctx.stderr.line(out.span(`${word}: nothing appropriate.`, { fg: 'error' }));
  return NOT_FOUND;
}

/** apropos: the whatis line of every command a keyword appears in. Shared with `man -k`. */
export async function runApropos(ctx: CommandContext, keywords: readonly string[]): Promise<ExitCode> {
  const [help, registry] = await Promise.all([import('../../shell/help'), allCommands(ctx)]);
  const missing: string[] = [];
  const found = new Map<string, string>();
  for (const keyword of keywords) {
    const specs = help.apropos(registry, keyword);
    if (specs.length === 0) missing.push(keyword);
    for (const spec of specs) found.set(spec.name, spec.summary);
  }
  for (const name of [...found.keys()].sort()) await ctx.stdout.write(`${help.whatisLine(name, found.get(name) ?? '')}\n`);
  return missing.length > 0 ? nothingFor(ctx, missing) : 0;
}

/** whatis: the one-line summary of each command named. Shared with `man -f`. */
export async function runWhatis(ctx: CommandContext, names: readonly string[]): Promise<ExitCode> {
  const [help, registry] = await Promise.all([import('../../shell/help'), allCommands(ctx)]);
  const missing: string[] = [];
  for (const name of names) {
    const spec = registry.get(name);
    if (spec === undefined) missing.push(name);
    else await ctx.stdout.write(`${help.whatisLine(name, spec.summary)}\n`);
  }
  return missing.length > 0 ? nothingFor(ctx, missing) : 0;
}

/** apropos KEYWORD...: what `apropos` runs. */
export async function apropos(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args.length === 0) {
    await ctx.stderr.write('apropos what?\n');
    return 1;
  }
  return runApropos(ctx, ctx.args);
}

/** whatis COMMAND...: what `whatis` runs. */
export async function whatis(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args.length === 0) {
    await ctx.stderr.write('whatis what?\n');
    return 1;
  }
  return runWhatis(ctx, ctx.args);
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  let pages = [...ctx.args];
  if (pages.length === 0) {
    await ctx.stderr.line(out.span('What manual page do you want?', { fg: 'error' }));
    await ctx.stderr.line(out.span("For example, try 'man man'.", { fg: 'muted' }));
    return 1;
  }
  if (ctx.opts.apropos === true) return runApropos(ctx, pages);
  if (ctx.opts.whatis === true) return runWhatis(ctx, pages);

  // A section number first: every command is in section 1, and vesen in 7.
  let section: string | null = null;
  if (pages.length > 1 && /^\d$/.test(pages[0] ?? '')) {
    section = pages[0] ?? null;
    pages = pages.slice(1);
  }
  const [help, registry] = await Promise.all([import('../../shell/help'), allCommands(ctx)]);
  const layout = { columns: ctx.stdout.columns, version: __APP_VERSION__ };
  let status = 0;
  const shown: { title: string; blocks: Block[] }[] = [];
  for (const name of pages) {
    const spec = name === 'vesen' ? undefined : registry.get(name);
    const inSection = name === 'vesen' ? section === null || section === '7' : section === null || section === '1';
    if ((spec === undefined && name !== 'vesen') || !inSection) {
      const where = section === null ? '' : ` in section ${section}`;
      await ctx.stderr.line(out.span(`No manual entry for ${name}${where}`, { fg: 'error' }));
      status = NOT_FOUND;
      continue;
    }
    const blocks = spec === undefined ? help.vesenPage(registry, layout) : help.manPage(await help.withDoc(spec), layout);
    shown.push({ title: `Manual page ${name}(${spec === undefined ? 7 : 1})`, blocks });
  }
  const title = shown[0]?.title;
  if (title !== undefined && ctx.stdout.isTTY) {
    const pager = await import('../lib/pager');
    if (await pager.pageBlocks(ctx, title, shown.map((page) => page.blocks))) return status;
  }
  for (const [i, page] of shown.entries()) {
    if (i > 0) await ctx.stdout.write('\n');
    for (const block of page.blocks) await ctx.stdout.block(block);
  }
  return status;
}
