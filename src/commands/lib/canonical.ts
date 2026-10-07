// Canonical paths, as realpath and readlink -f, -e and -m make them: absolute, with every symbolic
// link followed, `.` and `..` resolved where they really lead, and no doubled or trailing slash.
// How much must exist is the caller's choice, as GNU's canonicalize_filename_mode has it:
//
//   existing      every part (realpath -e, readlink -e)
//   all-but-last  every part but the last (realpath, readlink -f)
//   missing       none (realpath -m, readlink -m)

import type { CommandContext } from '../../shell/types';
import { MAX_SYMLINK_HOPS, fromSegments, normalise } from '../../vfs/path';
import { VfsError } from '../../vfs/types';
import { errorCode } from './files';

export type Existence = 'existing' | 'all-but-last' | 'missing';

/** `typed` as an absolute path, still with its `..` and links: from the working directory or ~. */
function absolute(ctx: CommandContext, typed: string): string {
  if (typed === '~' || typed.startsWith('~/')) return ctx.resolve(typed);
  return typed.startsWith('/') ? typed : `${ctx.cwd}/${typed}`;
}

/**
 * The canonical form of `typed`. Throws a VfsError (ENOENT, ENOTDIR, EACCES, ELOOP) when a part
 * that must exist does not, or cannot be reached. With `physical` false, links are left as they
 * are and `..` removes the part before it, as realpath -s does.
 */
export function canonical(ctx: CommandContext, typed: string, existence: Existence, physical = true): string {
  if (typed === '') throw new VfsError('ENOENT', typed, 'realpath');
  let resolved: string[] = [];
  let pending = absolute(ctx, typed)
    .split('/')
    .filter((part) => part !== '' && part !== '.');
  if (!physical) {
    const path = normalise(pending.join('/'));
    check(ctx, path, existence);
    return path;
  }
  let hops = 0;
  // Once a part is missing, the rest (for -m) is only joined on.
  let missing = false;
  while (pending.length > 0) {
    const part = pending.shift() as string;
    if (part === '..') {
      resolved.pop();
      continue;
    }
    const candidate = fromSegments([...resolved, part]);
    if (missing) {
      resolved.push(part);
      continue;
    }
    let type: string;
    try {
      type = ctx.fs.lstat(candidate).type;
    } catch (error) {
      const code = errorCode(error);
      const absent = code === 'ENOENT' || (code === 'ENOTDIR' && existence === 'missing');
      if (absent && (existence === 'missing' || (existence === 'all-but-last' && pending.length === 0))) {
        missing = true;
        resolved.push(part);
        continue;
      }
      throw new VfsError(code, typed, 'realpath');
    }
    if (type === 'symlink') {
      hops += 1;
      if (hops > MAX_SYMLINK_HOPS) throw new VfsError('ELOOP', typed, 'realpath');
      const target = ctx.fs.readlink(candidate);
      if (target.startsWith('/')) resolved = [];
      pending = [...target.split('/').filter((piece) => piece !== '' && piece !== '.'), ...pending];
      continue;
    }
    if (type !== 'directory' && pending.length > 0) {
      if (existence !== 'missing') throw new VfsError('ENOTDIR', typed, 'realpath');
      missing = true;
    }
    resolved.push(part);
  }
  return fromSegments(resolved);
}

/** For -s: what must exist of a path that is not followed. */
function check(ctx: CommandContext, path: string, existence: Existence): void {
  if (existence === 'missing') return;
  const target = existence === 'existing' ? path : normalise(`${path}/..`);
  try {
    ctx.fs.lstat(target);
  } catch (error) {
    throw new VfsError(errorCode(error), path, 'realpath');
  }
}
