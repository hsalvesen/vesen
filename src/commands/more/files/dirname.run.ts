// The body of dirname; its spec, in dirname.ts, loads this the first time dirname runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';

/** What --help, help and man say about dirname, besides its spec (dirname.ts). */
export const doc: CommandDoc = {
  description:
    "Prints each NAME with its last part and the slashes before it removed: the folder it is in. A NAME with no slash gives '.', the working directory. It works on the text alone: NAME need not exist.",
  man: [{ heading: 'EXIT STATUS', body: '0, or 1 when no NAME is given.' }],
};

/** The folder part of `name`, as POSIX dirname gives it: `.` with no slash, `/` for the root. */
export function dirName(name: string): string {
  const trimmed = name.replace(/\/+$/, '');
  if (trimmed === '') return name.startsWith('/') ? '/' : '.';
  const slash = trimmed.lastIndexOf('/');
  if (slash === -1) return '.';
  const head = trimmed.slice(0, slash).replace(/\/+$/, '');
  return head === '' ? '/' : head;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args.length === 0) return ctx.usage('missing operand');
  const end = ctx.opts.zero === true ? '\0' : '\n';
  await ctx.stdout.write(ctx.args.map((name) => `${dirName(name)}${end}`).join(''));
  return 0;
}
