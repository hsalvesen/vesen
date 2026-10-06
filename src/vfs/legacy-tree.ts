// Migration only: the Vfs contract over the legacy file tree (src/utils/virtualFileSystem.ts),
// until src/vfs/vfs.ts replaces both in the next step. The legacy commands keep walking the tree
// themselves; the shell kernel uses this adapter for redirections, globbing, `<` and ctx.fs, so
// `echo hi > f; cat f` works through either.
//
// It is deliberately small: one user, no permissions, no symbolic links, nothing executable.
// Child lookups use own properties only, so a name like `constructor` is never found (F031).

import { glob as globPaths, type GlobFs } from '../shell/glob';
import { VfsError, type BoundVfs, type NodeType, type Stat } from './types';

/** The legacy tree's node shape (src/utils/virtualFileSystem.ts, VirtualFile). */
export interface LegacyNode {
  name: string;
  type: 'file' | 'directory';
  content?: string;
  /** A file the legacy cat fetches from the site, such as /README.md. */
  filePath?: string;
  format?: 'html';
  children?: Record<string, LegacyNode>;
}

export interface LegacyTreeOptions {
  /** The tree's root. Its children may be swapped by `restore`, so they are read on every call. */
  readonly root: LegacyNode;
  /** The legacy commands' current folder as path segments; the adapter reads and writes it in place. */
  readonly cwd: string[];
  /** Puts the seed files back, for `reset`. */
  readonly restore?: () => void;
  readonly now?: () => number;
}

/** The quota usage() reports, as the persistence overlay will enforce it. */
const QUOTA = 512 * 1024;

const GUEST_UID = 1000;

function own(children: Record<string, LegacyNode> | undefined, name: string): LegacyNode | undefined {
  if (children === undefined || !Object.prototype.hasOwnProperty.call(children, name)) return undefined;
  return children[name];
}

function bytes(text: string): number {
  let count = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    count += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return count;
}

/** Splits an absolute path into segments; '' and '.' are dropped and '..' climbs, stopping at /. */
export function segments(path: string): string[] {
  const out: string[] = [];
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') out.pop();
    else out.push(segment);
  }
  return out;
}

function join(parts: readonly string[]): string {
  return `/${parts.join('/')}`;
}

/** Resolves a path against a folder and a home folder: `~`, `~/x`, absolute, or relative. */
export function resolvePath(path: string, cwd: string, home: string): string {
  let full: string;
  if (path === '~' || path.startsWith('~/')) full = `${home}/${path.slice(2)}`;
  else if (path.startsWith('/')) full = path;
  else full = `${cwd}/${path}`;
  return join(segments(full));
}

export class LegacyTreeFs implements BoundVfs {
  readonly uid = GUEST_UID;
  private readonly mtimes = new WeakMap<LegacyNode, number>();
  private readonly listeners = new Set<(paths: readonly string[]) => void>();
  private readonly bootTime: number;

  constructor(private readonly options: LegacyTreeOptions) {
    this.bootTime = this.now();
  }

  // ── The legacy mirror ──

  /** The legacy commands' current folder. */
  legacyCwd(): string {
    return join(this.options.cwd);
  }

  /** Moves the legacy commands' current folder, after the shell's cd or reset. */
  setLegacyCwd(path: string): void {
    const parts = segments(path);
    this.options.cwd.length = 0;
    this.options.cwd.push(...parts);
  }

  // No isExecutable: the legacy tree has no permission bits, so the shell runs registry commands
  // only. Scripts on $PATH arrive with the VFS and its executable bit.

  restore(): void {
    this.options.restore?.();
    this.emit(['/']);
  }

  // ── Vfs ──

  resolve(path: string, cwd: string, home: string): string {
    return resolvePath(path, cwd, home);
  }

  realpath(path: string): string {
    this.find(path, 'realpath');
    return join(segments(path));
  }

  stat(path: string): Stat {
    const node = this.find(path, 'stat');
    return this.statOf(join(segments(path)), node);
  }

  lstat(path: string): Stat {
    return this.stat(path);
  }

  exists(path: string): boolean {
    return this.lookup(path) !== undefined;
  }

  readdir(path: string, options: { all?: boolean } = {}): string[] {
    const node = this.find(path, 'scandir');
    if (node.type !== 'directory') throw new VfsError('ENOTDIR', path, 'scandir');
    return Object.keys(node.children ?? {}).filter((name) => options.all || !name.startsWith('.'));
  }

  readFile(path: string): string {
    const node = this.find(path, 'open');
    if (node.type === 'directory') throw new VfsError('EISDIR', path, 'read');
    return node.content ?? '';
  }

  readStyled(): null {
    return null;
  }

  writeFile(path: string, data: string, options: { append?: boolean; mode?: number; noclobber?: boolean } = {}): void {
    const { parent, name } = this.parentOf(path, 'open');
    const existing = own(parent.children, name);
    if (existing?.type === 'directory') throw new VfsError('EISDIR', path, 'open');
    if (existing !== undefined && options.noclobber) throw new VfsError('EEXIST', path, 'open');
    if (existing !== undefined && options.append) {
      existing.content = (existing.content ?? '') + data;
      this.written(existing, path);
      return;
    }
    if (existing !== undefined) {
      // The owner's documents stop being fetched once they are written to.
      delete existing.filePath;
      delete existing.format;
      existing.content = data;
      this.written(existing, path);
      return;
    }
    const file: LegacyNode = { name, type: 'file', content: data };
    this.children(parent)[name] = file;
    this.written(file, path);
  }

  mkdir(path: string, options: { parents?: boolean; mode?: number } = {}): void {
    const parts = segments(path);
    if (parts.length === 0) throw new VfsError('EEXIST', path, 'mkdir');
    let node = this.options.root;
    for (let i = 0; i < parts.length; i += 1) {
      const name = parts[i] ?? '';
      const last = i === parts.length - 1;
      const child = own(node.children, name);
      if (child === undefined) {
        if (!last && !options.parents) throw new VfsError('ENOENT', path, 'mkdir');
        const dir: LegacyNode = { name, type: 'directory', children: {} };
        this.children(node)[name] = dir;
        this.written(dir, join(parts.slice(0, i + 1)));
        node = dir;
        continue;
      }
      if (child.type !== 'directory') throw new VfsError(last ? 'EEXIST' : 'ENOTDIR', path, 'mkdir');
      if (last && !options.parents) throw new VfsError('EEXIST', path, 'mkdir');
      node = child;
    }
  }

  rmdir(path: string): void {
    const { parent, name, node } = this.entry(path, 'rmdir');
    if (node.type !== 'directory') throw new VfsError('ENOTDIR', path, 'rmdir');
    if (Object.keys(node.children ?? {}).length > 0) throw new VfsError('ENOTEMPTY', path, 'rmdir');
    delete this.children(parent)[name];
    this.emit([join(segments(path))]);
  }

  rm(path: string, options: { recursive?: boolean; force?: boolean } = {}): void {
    if (segments(path).length === 0) throw new VfsError('EPERM', path, 'unlink');
    const found = this.lookupEntry(path);
    if (found === undefined) {
      if (options.force) return;
      throw new VfsError('ENOENT', path, 'unlink');
    }
    if (found.node.type === 'directory' && !options.recursive) throw new VfsError('EISDIR', path, 'unlink');
    delete this.children(found.parent)[found.name];
    this.emit([join(segments(path))]);
  }

  rename(from: string, to: string): void {
    const source = this.entry(from, 'rename');
    const target = this.parentOf(to, 'rename');
    const fromParts = segments(from);
    const toParts = segments(to);
    if (toParts.length > fromParts.length && fromParts.every((part, i) => toParts[i] === part)) {
      throw new VfsError('EINVAL', to, 'rename');
    }
    const existing = own(target.parent.children, target.name);
    if (existing?.type === 'directory' && source.node.type !== 'directory') throw new VfsError('EISDIR', to, 'rename');
    delete this.children(source.parent)[source.name];
    source.node.name = target.name;
    this.children(target.parent)[target.name] = source.node;
    this.emit([join(fromParts), join(toParts)]);
  }

  copy(from: string, to: string, options: { recursive?: boolean } = {}): void {
    const source = this.find(from, 'open');
    if (source.type === 'directory' && !options.recursive) throw new VfsError('EISDIR', from, 'open');
    const target = this.parentOf(to, 'open');
    const clone = (node: LegacyNode, name: string): LegacyNode => {
      const copy: LegacyNode = { ...node, name };
      if (node.children !== undefined) {
        const children: Record<string, LegacyNode> = {};
        for (const key of Object.keys(node.children)) {
          const child = own(node.children, key);
          if (child !== undefined) children[key] = clone(child, key);
        }
        copy.children = children;
      }
      return copy;
    };
    const copied = clone(source, target.name);
    this.children(target.parent)[target.name] = copied;
    this.written(copied, join(segments(to)));
  }

  symlink(_target: string, path: string): void {
    throw new VfsError('EPERM', path, 'symlink');
  }

  readlink(path: string): string {
    this.find(path, 'readlink');
    throw new VfsError('EINVAL', path, 'readlink');
  }

  chmod(path: string): void {
    this.find(path, 'chmod');
  }

  chown(path: string): void {
    this.find(path, 'chown');
    throw new VfsError('EPERM', path, 'chown');
  }

  touch(path: string, mtime?: number): void {
    const existing = this.lookup(path);
    if (existing !== undefined) {
      this.mtimes.set(existing, mtime ?? this.now());
      this.emit([join(segments(path))]);
      return;
    }
    this.writeFile(path, '');
    const created = this.lookup(path);
    if (created !== undefined && mtime !== undefined) this.mtimes.set(created, mtime);
  }

  glob(pattern: string, cwd: string): string[] {
    return globPaths(pattern, cwd, this.globFs());
  }

  *walk(path: string): Iterable<[string, Stat]> {
    const start = this.find(path, 'scandir');
    const base = join(segments(path));
    const visit = function* (this: LegacyTreeFs, at: string, node: LegacyNode): Generator<[string, Stat]> {
      yield [at, this.statOf(at, node)];
      if (node.type !== 'directory') return;
      for (const name of Object.keys(node.children ?? {})) {
        const child = own(node.children, name);
        if (child !== undefined) yield* visit.call(this, at === '/' ? `/${name}` : `${at}/${name}`, child);
      }
    };
    yield* visit.call(this, base, start);
  }

  usage(): { used: number; quota: number } {
    let used = 0;
    for (const [, stat] of this.walk('/')) if (stat.type === 'file') used += stat.size;
    return { used, quota: QUOTA };
  }

  onChange(listener: (paths: readonly string[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  access(path: string): boolean {
    return this.exists(path);
  }

  /** The adapter as the glob matcher sees a file system. */
  globFs(): GlobFs {
    return {
      readdir: (path) => {
        const node = this.lookup(path);
        return node?.type === 'directory' ? Object.keys(node.children ?? {}) : null;
      },
      exists: (path) => this.exists(path),
      isDirectory: (path) => this.lookup(path)?.type === 'directory',
    };
  }

  // ── Internals ──

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private children(node: LegacyNode): Record<string, LegacyNode> {
    if (node.children === undefined) node.children = {};
    return node.children;
  }

  private lookup(path: string): LegacyNode | undefined {
    let node: LegacyNode | undefined = this.options.root;
    for (const segment of segments(path)) {
      if (node.type !== 'directory') return undefined;
      node = own(node.children, segment);
      if (node === undefined) return undefined;
    }
    return node;
  }

  private find(path: string, syscall: string): LegacyNode {
    let node: LegacyNode = this.options.root;
    for (const segment of segments(path)) {
      if (node.type !== 'directory') throw new VfsError('ENOTDIR', path, syscall);
      const child = own(node.children, segment);
      if (child === undefined) throw new VfsError('ENOENT', path, syscall);
      node = child;
    }
    return node;
  }

  private parentOf(path: string, syscall: string): { parent: LegacyNode; name: string } {
    const parts = segments(path);
    const name = parts.pop();
    if (name === undefined) throw new VfsError('EISDIR', path, syscall);
    let parent: LegacyNode = this.options.root;
    for (const segment of parts) {
      const child = own(parent.children, segment);
      if (child === undefined) throw new VfsError('ENOENT', path, syscall);
      if (child.type !== 'directory') throw new VfsError('ENOTDIR', path, syscall);
      parent = child;
    }
    return { parent, name };
  }

  private lookupEntry(path: string): { parent: LegacyNode; name: string; node: LegacyNode } | undefined {
    try {
      return this.entry(path, 'lookup');
    } catch {
      return undefined;
    }
  }

  private entry(path: string, syscall: string): { parent: LegacyNode; name: string; node: LegacyNode } {
    const { parent, name } = this.parentOf(path, syscall);
    const node = own(parent.children, name);
    if (node === undefined) throw new VfsError('ENOENT', path, syscall);
    return { parent, name, node };
  }

  private statOf(path: string, node: LegacyNode): Stat {
    const type: NodeType = node.type;
    return {
      path,
      type,
      mode: type === 'directory' ? 0o755 : 0o644,
      owner: 'guest',
      group: 'guest',
      uid: GUEST_UID,
      gid: GUEST_UID,
      size: type === 'directory' ? 4096 : bytes(node.content ?? ''),
      mtime: this.mtimes.get(node) ?? this.bootTime,
      nlink: type === 'directory' ? 2 : 1,
    };
  }

  private written(node: LegacyNode, path: string): void {
    this.mtimes.set(node, this.now());
    this.emit([join(segments(path))]);
  }

  private emit(paths: readonly string[]): void {
    for (const listener of [...this.listeners]) listener(paths);
  }
}

/**
 * Gives the legacy tree the visitor's real home folder: /home/guest, sharing its contents with
 * /home/user, so either path reaches the same files until the VFS makes /home/user a symlink.
 */
export function addGuestHome(root: LegacyNode, home = '/home/guest', legacyHome = '/home/user'): void {
  const homeParts = segments(home);
  const legacyParts = segments(legacyHome);
  const parentOf = (parts: readonly string[]): LegacyNode | undefined => {
    let node: LegacyNode | undefined = root;
    for (const part of parts.slice(0, -1)) node = node ? own(node.children, part) : undefined;
    return node;
  };
  const legacy = parentOf(legacyParts);
  const target = parentOf(homeParts);
  const legacyName = legacyParts[legacyParts.length - 1] ?? '';
  const name = homeParts[homeParts.length - 1] ?? '';
  const existing = legacy ? own(legacy.children, legacyName) : undefined;
  if (existing === undefined || target === undefined || own(target.children, name) !== undefined) return;
  if (existing.children === undefined) existing.children = {};
  // A second node over the same children object: a change through either path shows in both.
  const alias: LegacyNode = { name, type: 'directory', children: existing.children };
  if (target.children === undefined) target.children = {};
  target.children[name] = alias;
}

/** A tree with only the visitor's home folder, for a shell without the legacy files. */
export function emptyHome(): LegacyTreeFs {
  return new LegacyTreeFs({
    root: {
      name: '',
      type: 'directory',
      children: { home: { name: 'home', type: 'directory', children: { guest: { name: 'guest', type: 'directory', children: {} } } } },
    },
    cwd: [],
  });
}
