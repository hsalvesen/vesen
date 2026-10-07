// man: a command's manual, generated from its spec: NAME, SYNOPSIS, DESCRIPTION, OPTIONS,
// EXAMPLES and SEE ALSO, laid out to the terminal's width (at most 80 columns), as man-db lays a
// page out. It prints inline; the pager comes with wave F. `man vesen` is the about page, and -k
// and -f are apropos and whatis.

import { out } from '../../output/model';
import { defineCommand, type CommandContext, type ExitCode } from '../../shell/types';
import { allCommands } from '../lib/catalogue';

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

export default defineCommand({
  name: 'man',
  category: 'shell',
  summary: 'show the manual page of a command',
  helpRank: 2,
  synopsis: ['man [SECTION] PAGE...', 'man -k KEYWORD...', 'man -f PAGE...'],
  description:
    "Shows the manual page of each PAGE: what the command does, how to call it, its options, examples to run and related commands. 'man vesen' is about this terminal.",
  flags: [
    { short: 'k', long: 'apropos', description: 'search the commands for KEYWORD, as apropos does' },
    { short: 'f', long: 'whatis', description: 'print the one-line summary of PAGE, as whatis does' },
  ],
  args: [{ name: 'PAGE', source: { kind: 'command' }, variadic: true }],
  examples: [
    { line: 'man ls', offline: true },
    { line: 'man vesen', note: 'about this terminal', offline: true },
    { line: 'man -k file', note: 'commands about files', offline: true },
  ],
  seeAlso: ['help', 'whatis', 'apropos'],
  async run(ctx) {
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
    let first = true;
    for (const name of pages) {
      const spec = name === 'vesen' ? undefined : registry.get(name);
      const inSection = name === 'vesen' ? section === null || section === '7' : section === null || section === '1';
      if ((spec === undefined && name !== 'vesen') || !inSection) {
        const where = section === null ? '' : ` in section ${section}`;
        await ctx.stderr.line(out.span(`No manual entry for ${name}${where}`, { fg: 'error' }));
        status = NOT_FOUND;
        continue;
      }
      if (!first) await ctx.stdout.write('\n');
      first = false;
      const blocks = spec === undefined ? help.vesenPage(registry, layout) : help.manPage(await help.withDoc(spec), layout);
      for (const block of blocks) await ctx.stdout.block(block);
    }
    return status;
  },
});
