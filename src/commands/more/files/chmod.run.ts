// The body of chmod; its spec, in chmod.ts, loads this the first time chmod runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { UMASK } from '../../../vfs/vfs';
import { applyMode, compileMode, describeMode, permString, type CompiledMode } from '../../lib/chmod-mode';
import { childPath, errorCode, reason } from '../../lib/files';
import { readOptions, type OptionTable } from '../../lib/raw-options';

/** What --help, help and man say about chmod, besides its spec (chmod.ts). */
export const doc: CommandDoc = {
  description:
    "Changes the permissions of each FILE to MODE: three octal digits (755) or letters (u+x, go-w, a=r). It prints nothing when it works; -v says what it did to each file, -c only what it changed. Only a file's owner may change its mode, so the visitor's own files under ~ can be changed and the system's cannot.",
  man: [
    {
      heading: 'MODES',
      body: "An octal MODE gives every bit: 4 read, 2 write and 1 execute, for the owner, the group and others, so 644 is rw-r--r--; a fourth digit in front adds 4 set-user-ID, 2 set-group-ID and 1 sticky. A symbolic MODE is one or more clauses, separated by commas: who ({accent}u{/} owner, {accent}g{/} group, {accent}o{/} others, {accent}a{/} all), an operator ({accent}+{/} adds, {accent}-{/} removes, {accent}={/} sets exactly) and the permissions ({accent}r w x{/}, {accent}X{/} execute only for folders and files someone may already run, {accent}s{/} set-ID, {accent}t{/} sticky), or {accent}u g o{/} to copy another class's bits. With no who, the clause applies to everyone except the bits the umask (022) holds back, so +w gives write to the owner alone.",
    },
    {
      heading: 'EXIT STATUS',
      body: "0 when every FILE was changed as asked, 1 otherwise: a FILE that is missing or not yours, a folder -R cannot read, or a mode starting with '-' that the umask kept from taking full effect.",
    },
  ],
};

const OPTIONS: OptionTable = {
  shorts: { c: 'changes', f: 'silent', v: 'verbose', R: 'recursive' },
  longs: {
    changes: 'changes',
    silent: 'silent',
    quiet: 'silent',
    verbose: 'verbose',
    recursive: 'recursive',
    reference: { key: 'reference', value: true },
    'preserve-root': 'preserve-root',
    'no-preserve-root': 'no-preserve-root',
  },
  // `chmod -w file`: a word of mode letters after a dash is a mode, as GNU chmod allows.
  modeChars: 'rwxXstugoa,+=-01234567',
};

interface Settings {
  readonly changes: boolean;
  readonly silent: boolean;
  readonly verbose: boolean;
  readonly recursive: boolean;
  /** The mode from --reference, used as it is. */
  readonly fixed: number | null;
  readonly mode: CompiledMode | null;
  /** A mode given as an option, such as -w: say when the umask held part of it back. */
  readonly diagnose: boolean;
}

/** The mode `settings` give a file now `old`. */
function target(settings: Settings, old: number, directory: boolean, umask: number): number {
  if (settings.fixed !== null) return settings.fixed;
  return settings.mode === null ? old : applyMode(settings.mode, old, directory, umask);
}

async function change(ctx: CommandContext, typed: string, path: string, settings: Settings, top: boolean): Promise<boolean> {
  if (ctx.signal.aborted) throw ctx.signal.reason;
  let stat;
  try {
    // A link named on the line is followed; one found inside a folder is left alone.
    stat = top ? ctx.fs.stat(path) : ctx.fs.lstat(path);
  } catch (error) {
    if (!settings.silent) {
      const dangling = top && errorCode(error) === 'ENOENT' && tryLink(ctx, path);
      await ctx.fail(dangling ? `cannot operate on dangling symlink '${typed}'` : `cannot access '${typed}': ${reason(error)}`);
    }
    return false;
  }
  if (stat.type === 'symlink') {
    if (settings.verbose) await ctx.stdout.write(`neither symbolic link '${typed}' nor referent has been changed\n`);
    return true;
  }
  const directory = stat.type === 'directory';
  const old = stat.mode & 0o7777;
  const next = target(settings, old, directory, UMASK);
  let ok = true;
  try {
    ctx.fs.chmod(path, next);
    if (next !== old ? settings.verbose || settings.changes : settings.verbose) {
      await ctx.stdout.write(
        next !== old ? `mode of '${typed}' changed from ${describeMode(old)} to ${describeMode(next)}\n` : `mode of '${typed}' retained as ${describeMode(old)}\n`,
      );
    }
    if (settings.diagnose) {
      const naive = target(settings, old, directory, 0);
      if ((next & ~naive) !== 0) {
        await ctx.fail(`${typed}: new permissions are ${permString(next)}, not ${permString(naive)}`);
        ok = false;
      }
    }
  } catch (error) {
    if (!settings.silent) await ctx.fail(`changing permissions of '${typed}': ${reason(error)}`);
    if (settings.verbose) await ctx.stdout.write(`failed to change mode of '${typed}' from ${describeMode(old)} to ${describeMode(next)}\n`);
    ok = false;
  }
  if (!directory || !settings.recursive) return ok;
  let names: string[];
  try {
    names = ctx.fs.readdir(path, { all: true });
  } catch (error) {
    if (!settings.silent) await ctx.fail(`cannot read directory '${typed}': ${reason(error)}`);
    return false;
  }
  for (const name of names) {
    if (!(await change(ctx, childPath(typed, name), `${path === '/' ? '' : path}/${name}`, settings, false))) ok = false;
  }
  return ok;
}

/** True when there is a symbolic link at `path`, whatever it points to. */
function tryLink(ctx: CommandContext, path: string): boolean {
  try {
    return ctx.fs.lstat(path).type === 'symlink';
  } catch {
    return false;
  }
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const read = readOptions(ctx.args, OPTIONS);
  if ('error' in read) return ctx.usage(read.error);
  const { flags, operands, modeWords } = read;
  const reference = typeof flags.reference === 'string' ? flags.reference : undefined;
  const words = [...operands];
  let text: string | undefined;
  if (reference === undefined) text = modeWords.length > 0 ? modeWords.join(',') : words.shift();
  if (text === undefined && reference === undefined) return ctx.usage('missing operand');
  if (words.length === 0) return ctx.usage(text === undefined ? 'missing operand' : `missing operand after '${text}'`);

  let fixed: number | null = null;
  let mode: CompiledMode | null = null;
  if (reference !== undefined) {
    try {
      fixed = ctx.fs.stat(ctx.resolve(reference)).mode & 0o7777;
    } catch (error) {
      return ctx.fail(`failed to get attributes of '${reference}': ${reason(error)}`);
    }
  } else {
    mode = compileMode(text ?? '');
    if (mode === null) return ctx.usage(`invalid mode: '${text ?? ''}'`);
  }
  const settings: Settings = {
    changes: flags.changes === true,
    silent: flags.silent === true,
    verbose: flags.verbose === true,
    recursive: flags.recursive === true,
    fixed,
    mode,
    diagnose: modeWords.length > 0 && mode?.usesUmask === true,
  };
  let status = 0;
  for (const typed of words) {
    if (!(await change(ctx, typed, ctx.resolve(typed), settings, true))) status = 1;
  }
  return status;
}
