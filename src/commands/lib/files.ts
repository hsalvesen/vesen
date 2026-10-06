// What the file commands share: VFS errors in coreutils' words, paths kept as the visitor typed
// them (coreutils quote operands as typed, not resolved), quiet stat calls, and the near-miss
// file or folder offered after a typo.

import { out, type Line } from '../../output/model';
import { editDistance } from '../../shell/registry';
import type { CommandContext } from '../../shell/types';
import { strerror } from '../../vfs/errors';
import { basename, dirname, isWithin } from '../../vfs/path';
import { VfsError, type Stat, type VfsCode } from '../../vfs/types';

/** The code of a VFS error; anything else is rethrown. */
export function errorCode(error: unknown): VfsCode {
  if (error instanceof VfsError) return error.code;
  throw error;
}

/** Linux's words for a VFS error, such as "No such file or directory"; anything else is rethrown. */
export function reason(error: unknown): string {
  return strerror(errorCode(error));
}

/** lstat, or null when there is nothing there (or it cannot be reached). */
export function tryLstat(ctx: CommandContext, path: string): Stat | null {
  try {
    return ctx.fs.lstat(path);
  } catch (error) {
    errorCode(error);
    return null;
  }
}

/** stat, following symbolic links, or null when there is nothing there. */
export function tryStat(ctx: CommandContext, path: string): Stat | null {
  try {
    return ctx.fs.stat(path);
  } catch (error) {
    errorCode(error);
    return null;
  }
}

/** The real path of something, with links followed, or the path itself when it cannot be resolved. */
export function realOrSelf(ctx: CommandContext, path: string): string {
  try {
    return ctx.fs.realpath(path);
  } catch {
    return path;
  }
}

/**
 * Where the thing at `path` itself is, with links on the way followed but not a link at the end:
 * two paths are the same file to mv when these agree.
 */
export function entryPath(ctx: CommandContext, path: string): string {
  const name = basename(path);
  const folder = realOrSelf(ctx, dirname(path));
  return folder === '/' ? `/${name}` : `${folder}/${name}`;
}

/** A path inside a folder, written the way the folder was typed: `docs` and `a` give `docs/a`. */
export function childPath(typed: string, name: string): string {
  if (typed === '') return name;
  return typed.endsWith('/') ? `${typed}${name}` : `${typed}/${name}`;
}

/** Words safe to put in a tappable suggestion as they are. */
const PLAIN = /^[\w.,:@%+=/~-]+$/;

/**
 * Something next to the path asked for that was probably meant: the same name in another case,
 * a name it begins, or one or two typos away. `dir` offers only folders. The suggestion keeps
 * what was typed before the last name: `cat docs/Linux.txt` offers docs/linux.txt.
 */
export function nearMiss(ctx: CommandContext, typed: string, want: 'any' | 'dir' = 'any'): string | null {
  const resolved = ctx.resolve(typed);
  const parent = dirname(resolved);
  const wanted = basename(resolved);
  let names: string[];
  try {
    names = ctx.fs.readdir(parent, { all: wanted.startsWith('.') });
  } catch {
    return null;
  }
  const candidates = names.filter((name) => {
    if (want === 'any') return true;
    try {
      return ctx.fs.stat(`${parent === '/' ? '' : parent}/${name}`).type === 'directory';
    } catch {
      return false;
    }
  });
  const lower = wanted.toLowerCase();
  const pick =
    candidates.find((name) => name.toLowerCase() === lower) ??
    candidates.find((name) => lower.length >= 2 && name.toLowerCase().startsWith(lower)) ??
    candidates
      .map((name) => ({ name, distance: editDistance(lower, name.toLowerCase()) }))
      .filter(({ distance }) => distance <= (lower.length <= 3 ? 1 : 2))
      .sort((a, b) => a.distance - b.distance || (a.name < b.name ? -1 : 1))[0]?.name;
  if (pick === undefined || pick === wanted) return null;
  const slash = typed.replace(/\/+$/, '').lastIndexOf('/');
  return slash === -1 ? pick : `${typed.slice(0, slash + 1)}${pick}`;
}

/** Said under "No such file or directory" for one of the original files the visitor removed. */
export const RESTORE_HINT = "It was removed; 'reset' restores the original files.";

/**
 * For a path under ~ that the seed has and that is gone, the muted line saying `reset` brings it
 * back, since removals last across visits. Only on a terminal. True when it said so.
 */
export async function suggestRestore(ctx: CommandContext, typed: string): Promise<boolean> {
  if (!ctx.stderr.isTTY) return false;
  const path = ctx.resolve(typed);
  if (!isWithin(path, ctx.user.home) || ctx.fs.seeded?.(path) !== true || ctx.fs.exists(path)) return false;
  await ctx.stderr.line(out.span(RESTORE_HINT, { fg: 'muted' }));
  return true;
}

/**
 * The muted "Did you mean X?" line under an error, with X a tappable `command X`, or for an
 * original file the visitor removed, how to get it back. Only on a terminal: a script or a file
 * gets the error alone, as from coreutils.
 */
export async function suggestNearMiss(ctx: CommandContext, typed: string, command: string, want: 'any' | 'dir' = 'any'): Promise<void> {
  if (!ctx.stderr.isTTY) return;
  if (await suggestRestore(ctx, typed)) return;
  const near = nearMiss(ctx, typed, want);
  if (near === null || !PLAIN.test(near)) return;
  const line: Line = [out.span('Did you mean ', { fg: 'muted' }), out.run(near, `${command} ${near}`, { fg: 'accent' }), out.span('?', { fg: 'muted' })];
  await ctx.stderr.line(...line);
}

/** The visitor's yes: a line starting with y or Y, as coreutils' yesno() reads it. */
export async function ask(ctx: CommandContext, prompt: string): Promise<boolean> {
  const answer = await ctx.tty.readLine({ prompt });
  return answer !== null && /^\s*[yY]/.test(answer);
}
