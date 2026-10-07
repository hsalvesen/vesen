// The body of basename; its spec, in basename.ts, loads this the first time basename runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';

/** What --help, help and man say about basename, besides its spec (basename.ts). */
export const doc: CommandDoc = {
  description:
    "Prints NAME with everything up to its last slash removed, trailing slashes ignored, and SUFFIX removed from the end when it is there and is not the whole name. It works on the text alone: NAME need not exist. With -a or -s, every operand is a NAME.",
  man: [{ heading: 'EXIT STATUS', body: '0, or 1 for a missing or extra operand.' }],
};

/** The last part of `name`, as POSIX basename gives it: `/` for slashes alone, '' for ''. */
export function baseName(name: string, suffix = ''): string {
  const trimmed = name.replace(/\/+$/, '');
  if (trimmed === '') return name === '' ? '' : '/';
  const base = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return suffix !== '' && base !== suffix && base.endsWith(suffix) ? base.slice(0, -suffix.length) : base;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const suffixOpt = typeof ctx.opts.suffix === 'string' ? ctx.opts.suffix : undefined;
  const multiple = ctx.opts.multiple === true || suffixOpt !== undefined;
  const end = ctx.opts.zero === true ? '\0' : '\n';
  const [first, second, third] = ctx.args;
  if (first === undefined) return ctx.usage('missing operand');
  if (!multiple && third !== undefined) return ctx.usage(`extra operand '${third}'`);
  const names = multiple ? ctx.args : [first];
  const suffix = multiple ? (suffixOpt ?? '') : (second ?? '');
  await ctx.stdout.write(names.map((name) => `${baseName(name, suffix)}${end}`).join(''));
  return 0;
}
