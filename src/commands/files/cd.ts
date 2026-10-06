// cd: change the working directory, as bash's builtin does. `cd` alone goes to $HOME, `cd -` to
// $OLDPWD (printing it), and a near miss offers the folder that was probably meant (F023).

import { out, type Line } from '../../output/model';
import { editDistance } from '../../shell/registry';
import { defineCommand, type CommandContext, type ExitCode } from '../../shell/types';
import { strerror } from '../../vfs/errors';
import { basename, dirname } from '../../vfs/path';
import { VfsError } from '../../vfs/types';

/** A folder next to the one asked for that was probably meant: same name in another case, a prefix, or one or two typos away. */
export function nearMissFolder(ctx: CommandContext, typed: string): string | null {
  const resolved = ctx.resolve(typed);
  const parent = dirname(resolved);
  const wanted = basename(resolved);
  let names: string[];
  try {
    names = ctx.fs.readdir(parent, { all: wanted.startsWith('.') });
  } catch {
    return null;
  }
  const folders = names.filter((name) => {
    try {
      return ctx.fs.stat(`${parent === '/' ? '' : parent}/${name}`).type === 'directory';
    } catch {
      return false;
    }
  });
  const lower = wanted.toLowerCase();
  const pick =
    folders.find((name) => name.toLowerCase() === lower) ??
    folders.find((name) => lower.length >= 2 && name.toLowerCase().startsWith(lower)) ??
    folders
      .map((name) => ({ name, distance: editDistance(lower, name.toLowerCase()) }))
      .filter(({ distance }) => distance <= (lower.length <= 3 ? 1 : 2))
      .sort((a, b) => a.distance - b.distance || (a.name < b.name ? -1 : 1))[0]?.name;
  if (pick === undefined) return null;
  // The suggestion keeps what was typed before the last name: `cd docs/Linux` offers docs/linux.
  const slash = typed.replace(/\/+$/, '').lastIndexOf('/');
  return slash === -1 ? pick : `${typed.slice(0, slash + 1)}${pick}`;
}

/** Words safe to put in a tappable suggestion as they are. */
const PLAIN = /^[\w.,:@%+=/~-]+$/;

async function failed(ctx: CommandContext, typed: string, error: VfsError): Promise<ExitCode> {
  const lines: Line[] = [[out.span(`cd: ${typed}: ${strerror(error.code)}`, { fg: 'error' })]];
  const near = error.code === 'ENOENT' ? nearMissFolder(ctx, typed) : null;
  if (near !== null && PLAIN.test(near)) {
    lines.push([out.span('Did you mean ', { fg: 'muted' }), out.run(near, `cd ${near}`, { fg: 'accent' }), out.span('?', { fg: 'muted' })]);
  }
  for (const line of lines) await ctx.stderr.line(...line);
  return 1;
}

export default defineCommand({
  name: 'cd',
  category: 'files',
  summary: 'change the working directory',
  synopsis: ['cd [-L|-P] [DIR]', 'cd -'],
  description:
    "Changes the shell's working directory to DIR, or to $HOME when there is none. 'cd -' returns to the previous directory ($OLDPWD) and prints it. The prompt shows where you are.",
  builtin: true,
  posixArgs: true,
  flags: [
    { short: 'L', description: 'keep symbolic links in the path (the default)' },
    { short: 'P', description: 'use the physical directory, with links resolved' },
  ],
  args: [{ name: 'DIR', source: { kind: 'path', accept: 'dir', includeParent: true }, optional: true }],
  examples: [
    { line: 'cd documents', note: 'go into a folder', offline: true },
    { line: 'cd ..', note: 'up one level', offline: true },
    { line: 'cd ~', note: 'home', offline: true },
    { line: 'cd -', note: 'back to the previous folder', offline: true },
  ],
  seeAlso: ['pwd', 'ls'],
  async run(ctx) {
    if (ctx.args.length > 1) return ctx.fail('too many arguments');
    let typed = ctx.args[0];
    let announce = false;
    if (typed === undefined) {
      typed = ctx.env.get('HOME');
      if (typed === undefined || typed === '') return ctx.fail('HOME not set');
    } else if (typed === '-') {
      typed = ctx.env.get('OLDPWD');
      if (typed === undefined || typed === '') return ctx.fail('OLDPWD not set');
      announce = true;
    } else if (typed === '') {
      return 0;
    }
    try {
      ctx.shell.chdir(typed);
      if (ctx.opts.P === true) ctx.shell.chdir(ctx.fs.realpath(ctx.shell.cwd()));
    } catch (error) {
      if (error instanceof VfsError) return failed(ctx, typed, error);
      throw error;
    }
    if (announce) await ctx.stdout.write(`${ctx.shell.cwd()}\n`);
    return 0;
  },
});
