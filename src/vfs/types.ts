// The virtual file system contract that commands see through `ctx.fs`.
// See docs/plan/designs/shell-architecture.md ("src/vfs/types.ts"); paths are absolute and
// already resolved unless a method says otherwise.

import type { Line } from '../output/model';
import type { SysSnapshot } from '../services/types';

export type NodeType = 'file' | 'directory' | 'symlink' | 'device';
export type DeviceName = 'null' | 'zero' | 'random' | 'urandom' | 'tty';

/** What a generated file (/proc) is made from each time it is read. */
export interface GenerateContext {
  /** Milliseconds since the epoch. */
  readonly now: number;
  /** When the page booted, in milliseconds since the epoch. */
  readonly bootTime: number;
  /** The device's facts; null when they are not known. */
  readonly sys: SysSnapshot | null;
  /** A number in [0, 1). */
  random(): number;
}

/**
 * One node of the file tree: the shape of the legacy tree literal (name, type, content,
 * children), plus the fields the VFS fills with defaults when it adopts a tree. Children are
 * null-prototype records, so `children['constructor']` is never an inherited function (F031).
 */
export interface VirtualFile {
  name: string;
  type: NodeType;
  content?: string;
  children?: Record<string, VirtualFile>;
  /** A symbolic link's target, as written: relative to the link's folder, or absolute. */
  target?: string;
  /** Permission bits, such as 0o644; 0o1777 for a sticky folder. */
  mode?: number;
  owner?: string;
  group?: string;
  /** Milliseconds since the epoch. */
  mtime?: number;
  /** The owner's styled version of a seed document, for cat on a terminal; cleared on any write. */
  styled?: readonly Line[];
  /** /proc: made on every read, never stored or persisted. */
  generate?: (context: GenerateContext) => string;
  /** /dev: what reading and writing it does. */
  device?: DeviceName;
  /** /usr/bin: the registry command this stub stands for. */
  builtin?: string;
}

export interface Stat {
  readonly path: string;
  readonly type: NodeType;
  /** Permission bits, such as 0o644. */
  readonly mode: number;
  readonly owner: string;
  readonly group: string;
  readonly uid: number;
  readonly gid: number;
  /** Bytes of UTF-8 content. */
  readonly size: number;
  /** Milliseconds since the epoch. */
  readonly mtime: number;
  readonly nlink: number;
  readonly target?: string;
}

export type VfsCode =
  | 'ENOENT'
  | 'ENOTDIR'
  | 'EISDIR'
  | 'EEXIST'
  | 'EACCES'
  | 'EPERM'
  | 'ENOTEMPTY'
  | 'ELOOP'
  | 'EINVAL'
  | 'ENOSPC'
  | 'ENAMETOOLONG';

/** A failed file operation, worded by the caller the way coreutils would word it. */
export class VfsError extends Error {
  readonly code: VfsCode;
  readonly path: string;
  readonly syscall: string;

  constructor(code: VfsCode, path: string, syscall = '') {
    super(`${code}: ${path}`);
    this.name = 'VfsError';
    this.code = code;
    this.path = path;
    this.syscall = syscall;
  }
}

export interface Vfs {
  /** Resolves `path` against `cwd`, expanding a leading `~` to `home`; does not follow the last symlink. */
  resolve(path: string, cwd: string, home: string): string;
  realpath(path: string): string;
  stat(path: string): Stat;
  lstat(path: string): Stat;
  exists(path: string): boolean;
  readdir(path: string, options?: { all?: boolean }): string[];
  readFile(path: string): string;
  /** The owner's styled version of a seed document, or null once it has been written to. */
  readStyled(path: string): readonly Line[] | null;
  writeFile(path: string, data: string, options?: { append?: boolean; mode?: number; noclobber?: boolean }): void;
  mkdir(path: string, options?: { parents?: boolean; mode?: number }): void;
  rmdir(path: string): void;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  rename(from: string, to: string): void;
  copy(from: string, to: string, options?: { recursive?: boolean }): void;
  symlink(target: string, path: string): void;
  readlink(path: string): string;
  chmod(path: string, mode: number): void;
  chown(path: string, owner: string, group?: string): void;
  touch(path: string, mtime?: number): void;
  glob(pattern: string, cwd: string): string[];
  walk(path: string): Iterable<[string, Stat]>;
  usage(): { used: number; quota: number };
  /** Calls `listener` with the changed paths after each write; returns an unsubscribe function. */
  onChange(listener: (paths: readonly string[]) => void): () => void;
  /** True when the seed has something at `path` (absolute): `reset` would bring it back. */
  seeded?(path: string): boolean;
}

/** The file system as one user sees it: every call is checked against that user's permissions. */
export interface BoundVfs extends Vfs {
  readonly uid: number;
  access(path: string, want: 'r' | 'w' | 'x'): boolean;
}

/** What `vesen:fs:v1` holds: the changes under `~` on top of the seed. */
export interface PersistedFs {
  readonly v: 1;
  /** The seed the overlay applies to; a new seed version discards incompatible entries. */
  readonly seedVersion: string;
  readonly savedAt: number;
  readonly overlay: Readonly<
    Record<
      string,
      | { readonly type: NodeType; readonly mode: number; readonly mtime: number; readonly content?: string; readonly target?: string }
      | { readonly whiteout: true }
    >
  >;
}
