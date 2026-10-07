// The body of locale; its spec, in locale.ts, loads this the first time locale runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';

/** What --help, help and man say about locale, besides its spec (locale.ts). */
export const doc: CommandDoc = {
  description:
    'Prints the locale each category uses: $LANG, then each LC_ category, which $LC_ALL overrides and its own variable sets, in quotes when it comes from $LANG or $LC_ALL. With -a, lists the locales there are: C, C.utf8 and POSIX, en_US.utf8, and one for each language your browser asks for. `locale charmap` prints the character set, UTF-8.',
};

const CATEGORIES = [
  'LC_CTYPE', 'LC_NUMERIC', 'LC_TIME', 'LC_COLLATE', 'LC_MONETARY', 'LC_MESSAGES',
  'LC_PAPER', 'LC_NAME', 'LC_ADDRESS', 'LC_TELEPHONE', 'LC_MEASUREMENT', 'LC_IDENTIFICATION',
] as const;

/** `en_AU.utf8` for the browser's `en-AU`; null for a tag that is not a language and region. */
function localeName(tag: string): string | null {
  const match = /^([a-z]{2,3})(?:-[A-Za-z]{4})?-([A-Z]{2}|\d{3})$/.exec(tag);
  return match === null ? null : `${match[1] ?? ''}_${match[2] ?? ''}.utf8`;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.opts['all-locales'] === true) {
    const names = new Set(['en_US.utf8']);
    for (const tag of ctx.sys.snapshot().languages) {
      const name = localeName(tag);
      if (name !== null) names.add(name);
    }
    await ctx.stdout.write(`${['C', 'C.utf8', ...[...names].sort(), 'POSIX'].join('\n')}\n`);
    return 0;
  }
  const [name, extra] = ctx.args;
  if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
  if (name !== undefined) {
    if (name !== 'charmap') return ctx.fail(`unknown name "${name}"`);
    await ctx.stdout.write('UTF-8\n');
    return 0;
  }
  const value = (key: string): string => ctx.env.get(key) ?? '';
  const lang = value('LANG');
  const all = value('LC_ALL');
  const lines = [`LANG=${lang}`, `LANGUAGE=${value('LANGUAGE')}`];
  for (const category of CATEGORIES) {
    const own = value(category);
    lines.push(all !== '' ? `${category}="${all}"` : own !== '' ? `${category}=${own}` : `${category}="${lang}"`);
  }
  lines.push(`LC_ALL=${all}`);
  await ctx.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}
