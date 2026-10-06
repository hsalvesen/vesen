// Migration only: what the legacy code still imports from the old virtual file system, now a
// thin shim over the VFS (src/vfs/vfs.ts), deleted with the last legacy command.
//
// - `virtualFileSystem` is the VFS's own tree: the object it keeps its nodes in, so the legacy
//   walks over `children` see the same files the shell does. It is
//   empty until the shell's chunk has loaded and the VFS has filled it.
// - `currentPath` mirrors the shell's cwd store, as segments of the real path, with symbolic
//   links resolved, so those walks never stop at one.
// - `resolvePath` resolves with HOME = /home/guest, and follows links the same way.
// - `legacyFs()` is the VFS itself, for the legacy commands that read and write files.
//
// This module is in the first chunk the page loads, so it imports no VFS code, only types.

import type { BoundVfs, VirtualFile as VfsNode } from '../vfs/types';

/** A node of the tree, as the legacy code walks it. */
export type VirtualFile = VfsNode;

/** The visitor's home; the identity module (src/vfs/identity.ts) says the same. */
const HOME = '/home/guest';

/** The VFS's tree. Filled when the shell has loaded (bindLegacyVfs). */
export const virtualFileSystem: VirtualFile = { name: '', type: 'directory', children: Object.create(null) as Record<string, VirtualFile> };

/** The working directory as segments of its real path, kept in step with the shell's cwd. */
export const currentPath: string[] = HOME.split('/').filter(Boolean);

/** The VFS, with the paths it can resolve; set when the shell has loaded. */
let bound: BoundVfs | null = null;

/** Hands the shim the VFS whose tree `virtualFileSystem` is. */
export function bindLegacyVfs(vfs: BoundVfs): void {
  bound = vfs;
}

/** The VFS, for the legacy commands. Throws until the shell has loaded, which runs them. */
export function legacyFs(): BoundVfs {
  if (bound === null) throw new Error('the file system has not started yet');
  return bound;
}

/** The working directory as an absolute path. */
export function currentDirectory(): string {
  return `/${currentPath.join('/')}`;
}

/** Moves the mirror to the shell's new cwd: its real path when the VFS can resolve it. */
export function mirrorCwd(cwd: string): void {
  let real = cwd;
  try {
    if (bound !== null) real = bound.realpath(cwd);
  } catch {
    // A folder that has gone: the mirror keeps the path as it was.
  }
  currentPath.length = 0;
  currentPath.push(...real.split('/').filter(Boolean));
}

function lexical(path: string): string[] {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return out;
}

/** The node for a directory path, or null. */
export function getCurrentDirectory(): VirtualFile | null {
  let current: VirtualFile | undefined = virtualFileSystem;
  for (const segment of currentPath) {
    const children: Record<string, VirtualFile> | undefined = current?.children;
    current = children !== undefined && Object.prototype.hasOwnProperty.call(children, segment) ? children[segment] : undefined;
    if (current === undefined) return null;
  }
  return current ?? null;
}

/**
 * Resolves a path to segments: `~` and `~/x` from /home/guest, an absolute path as it is,
 * anything else from the working directory. The folder it is in is followed through symbolic
 * links, so walking `children` reaches it; the last name is kept as typed.
 */
export function resolvePath(path: string): string[] {
  let absolute: string;
  if (path === '~' || path.startsWith('~/')) absolute = `${HOME}/${path.slice(1)}`;
  else if (path.startsWith('/')) absolute = path;
  else absolute = `${currentDirectory()}/${path}`;
  const parts = lexical(absolute);
  if (bound === null || parts.length === 0) return parts;
  const name = parts.pop() as string;
  try {
    const parent = bound.realpath(`/${parts.join('/')}`);
    return [...parent.split('/').filter(Boolean), name];
  } catch {
    return [...parts, name];
  }
}
