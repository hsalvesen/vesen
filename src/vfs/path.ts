// The one path module (F021): every command and the VFS resolve paths here, so `..` after `/`
// or `~/` works the same everywhere. Paths typed at the prompt are resolved lexically, as bash's
// `cd` does: `..` removes the segment before it, whatever that segment is. realpath() follows
// symbolic links instead, as realpath(3) does, with the ELOOP limit.

import { VfsError } from './types';

/** Symbolic links followed in one lookup before it fails with ELOOP, as on Linux. */
export const MAX_SYMLINK_HOPS = 40;

/** The segments of a path, with '' and '.' dropped and '..' climbing; never above the root. */
export function segments(path: string): string[] {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return out;
}

/** An absolute path from segments. */
export function fromSegments(parts: readonly string[]): string {
  return `/${parts.join('/')}`;
}

/** The absolute form of a path: one slash between segments, no `.` or `..`, no trailing slash. */
export function normalise(path: string): string {
  return fromSegments(segments(path));
}

/**
 * Resolves a path typed at the prompt to an absolute path: `~` and `~/x` from `home`, an
 * absolute path as it is, anything else from `cwd`. `.` and `..` are resolved in all three.
 */
export function resolve(path: string, cwd: string, home: string): string {
  if (path === '~' || path.startsWith('~/')) return normalise(`${home}/${path.slice(1)}`);
  if (path.startsWith('/')) return normalise(path);
  return normalise(`${cwd}/${path}`);
}

/** Joins path segments, as `path.join` would, then normalises. */
export function join(...parts: readonly string[]): string {
  return normalise(parts.join('/'));
}

/** The folder a path is in: dirname('/a/b') is '/a', and dirname('/') is '/'. */
export function dirname(path: string): string {
  const parts = segments(path);
  parts.pop();
  return fromSegments(parts);
}

/** The last segment of a path, ignoring trailing slashes: basename('/a/b/') is 'b', basename('/') is '/'. */
export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  if (trimmed === '') return path === '' ? '' : '/';
  return trimmed.slice(trimmed.lastIndexOf('/') + 1);
}

/** True when `path` is `ancestor` or inside it. Both absolute and normalised. */
export function isWithin(path: string, ancestor: string): boolean {
  return ancestor === '/' || path === ancestor || path.startsWith(`${ancestor}/`);
}

/** What realpath needs to know about one path: what is there, without following it. */
export type LinkReader = (path: string) => { readonly type: string; readonly target?: string };

/**
 * The real path of an absolute path, as realpath(3) gives it: every symbolic link followed, a
 * relative target from the folder the link is in, and `..` after a link climbing from where the
 * link really points. `lstat` throws for a part that is missing; past 40 links, ELOOP.
 */
export function realpath(path: string, lstat: LinkReader): string {
  let resolved: string[] = [];
  let pending = path.split('/').filter((part) => part !== '' && part !== '.');
  let hops = 0;
  while (pending.length > 0) {
    const part = pending.shift() as string;
    if (part === '..') {
      resolved.pop();
      continue;
    }
    const candidate = fromSegments([...resolved, part]);
    const node = lstat(candidate);
    if (node.type !== 'symlink') {
      resolved.push(part);
      continue;
    }
    hops += 1;
    if (hops > MAX_SYMLINK_HOPS) throw new VfsError('ELOOP', path, 'realpath');
    const target = node.target ?? '';
    if (target.startsWith('/')) resolved = [];
    pending = [...target.split('/').filter((piece) => piece !== '' && piece !== '.'), ...pending];
  }
  return fromSegments(resolved);
}
