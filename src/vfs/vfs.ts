// The virtual file system (docs/plan/designs/shell-architecture.md, section 5): one class over
// the legacy tree's literal shape, so unported legacy code that walks `children` keeps working.
//
// - Children are null-prototype records, and names are checked (validateName), so no path can
//   reach an inherited property such as `constructor` (F031).
// - Every node has a mode, an owner, a group and an mtime, filled with defaults when a tree is
//   adopted.
// - Simple POSIX permissions for one set of credentials (the visitor, uid 1000): owner, group
//   and other rwx bits; a folder needs x to be passed through and w to create or delete in it;
//   the sticky bit (/tmp) keeps others' files; only root bypasses them (F082).
// - Symbolic links, followed up to 40 times before ELOOP; devices (/dev); generated files (/proc,
//   made on every read); builtin stubs (/usr/bin).
// - A quota on the visitor's files (512 KB), past which writes fail with ENOSPC, so the
//   persisted overlay always fits in storage.
// Errors are VfsErrors with Linux codes; commands word them (vfs/errors.ts).

import { glob as globPaths, type GlobFs } from '../shell/glob';
import { GUEST, gidOf, uidOf } from './identity';
import { MAX_SYMLINK_HOPS, fromSegments, isWithin, join, normalise, realpath, resolve as resolvePath, segments } from './path';
import type { Line } from '../output/model';
import { VfsError, type BoundVfs, type GenerateContext, type NodeType, type Stat, type VirtualFile } from './types';

/** The most bytes the visitor's files may hold, so the overlay fits in localStorage. */
export const DEFAULT_QUOTA = 512 * 1024;

/** New files are 644 and folders 755, as with a umask of 022. */
export const UMASK = 0o022;

/** Who the file system acts for. */
export interface Credentials {
  readonly name: string;
  readonly uid: number;
  readonly gid: number;
  readonly group: string;
  readonly groups: readonly number[];
}

export const GUEST_CREDENTIALS: Credentials = {
  name: GUEST.name,
  uid: GUEST.uid,
  gid: GUEST.gid,
  group: GUEST.name,
  groups: GUEST.groups,
};

export interface VfsOptions {
  /** A fresh copy of the seed tree, built at start and again for `reset`. */
  readonly seed: () => VirtualFile;
  /** The object to keep the tree in. The legacy shim hands in its own, so its walks see this tree. */
  readonly root?: VirtualFile;
  readonly credentials?: Credentials;
  readonly now?: () => number;
  /** What generated files are made from; defaults to the clock and no device facts. */
  readonly context?: () => GenerateContext;
  readonly quota?: number;
}

/** An open file that `>` or `>>` writes to. */
export interface FileHandle {
  write(text: string): void;
  close(): void;
}

interface Found {
  readonly node: VirtualFile;
  /** The physical path, with every symbolic link on the way followed. */
  readonly path: string;
  readonly parent: VirtualFile | null;
  readonly name: string;
}

interface Slot {
  readonly dir: VirtualFile;
  readonly dirPath: string;
  readonly name: string;
  readonly node: VirtualFile | undefined;
}

function own(children: Record<string, VirtualFile> | undefined, name: string): VirtualFile | undefined {
  if (children === undefined || !Object.prototype.hasOwnProperty.call(children, name)) return undefined;
  return children[name];
}

function emptyChildren(): Record<string, VirtualFile> {
  return Object.create(null) as Record<string, VirtualFile>;
}

/** UTF-8 bytes in a string. */
export function byteLength(text: string): number {
  let count = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) count += 1;
    else if (code < 0x800) count += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      count += 4;
      i += 1;
    } else count += 3;
  }
  return count;
}

/** Rejects names no file may have: '', '.', '..' and anything with a '/'. */
export function validateName(name: string, path: string = name): void {
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\0')) {
    throw new VfsError('EINVAL', path, 'validate');
  }
}

function defaultMode(type: NodeType): number {
  switch (type) {
    case 'directory':
      return 0o755;
    case 'symlink':
      return 0o777;
    case 'device':
      return 0o666;
    case 'file':
      return 0o644;
  }
}

/**
 * Makes a tree safe and complete: null-prototype children, checked names, and a mode, owner,
 * group and mtime on every node. Returns the same object.
 */
export function adopt(node: VirtualFile, mtime: number, owner = 'root', group = owner): VirtualFile {
  node.mode ??= defaultMode(node.type);
  node.owner ??= owner;
  node.group ??= node.owner === owner ? group : node.owner;
  node.mtime ??= mtime;
  if (node.type === 'directory') {
    const children = emptyChildren();
    for (const key of Object.keys(node.children ?? {})) {
      const child = own(node.children, key);
      if (child === undefined) continue;
      validateName(key);
      child.name = key;
      children[key] = adopt(child, mtime, node.owner, node.group);
    }
    node.children = children;
  }
  return node;
}

/** An error from a step on the way, worded with the path the caller asked about. */
function withPath(error: unknown, path: string): unknown {
  return error instanceof VfsError ? new VfsError(error.code, path, error.syscall) : error;
}

/** The literal a symbolic link at `dirPath` with `target` points to. */
function linkTarget(dirPath: string, target: string): string {
  return target.startsWith('/') ? normalise(target) : normalise(`${dirPath}/${target}`);
}

/** Printable bytes for /dev/random: no control characters, so nothing reads as an escape. */
function randomText(random: () => number, length: number): string {
  let text = '';
  for (let i = 0; i < length; i += 1) {
    const code = 0x21 + Math.floor(random() * 94);
    text += String.fromCharCode(code);
  }
  return text;
}

export class Vfs implements BoundVfs {
  readonly root: VirtualFile;
  private readonly credentials: Credentials;
  private readonly listeners = new Set<(paths: readonly string[]) => void>();
  private readonly sizes = new WeakMap<VirtualFile, number>();
  private used: number | null = null;
  readonly quota: number;

  constructor(private readonly options: VfsOptions) {
    this.credentials = options.credentials ?? GUEST_CREDENTIALS;
    this.quota = options.quota ?? DEFAULT_QUOTA;
    this.root = options.root ?? { name: '', type: 'directory', children: emptyChildren() };
    this.install(options.seed());
  }

  get uid(): number {
    return this.credentials.uid;
  }

  // ── Whole trees ──

  /** Replaces everything with `tree` (adopted first), as `reset` and a restored overlay do. */
  replace(tree: VirtualFile): void {
    this.install(tree);
    this.emit(['/']);
  }

  /** `reset`: the seed files again. */
  restore(): void {
    this.replace(this.options.seed());
  }

  private install(tree: VirtualFile): void {
    const adopted = adopt(tree, this.now());
    this.root.name = '';
    this.root.type = 'directory';
    this.root.mode = adopted.mode ?? 0o755;
    this.root.owner = adopted.owner ?? 'root';
    this.root.group = adopted.group ?? 'root';
    this.root.mtime = adopted.mtime ?? this.now();
    this.root.children = adopted.children ?? emptyChildren();
    this.used = null;
  }

  // ── Paths ──

  resolve(path: string, cwd: string, home: string): string {
    return resolvePath(path, cwd, home);
  }

  realpath(path: string): string {
    // Each part is looked up on a prefix that is already real, so permissions are checked on the way.
    try {
      return realpath(normalise(path), (prefix) => this.lookup(prefix, false, 'realpath').node);
    } catch (error) {
      throw withPath(error, path);
    }
  }

  // ── Reading ──

  stat(path: string): Stat {
    const found = this.lookup(path, true, 'stat');
    return this.statOf(found.path, found.node);
  }

  lstat(path: string): Stat {
    const found = this.lookup(path, false, 'lstat');
    return this.statOf(found.path, found.node);
  }

  exists(path: string): boolean {
    try {
      this.lookup(path, true, 'stat');
      return true;
    } catch {
      return false;
    }
  }

  readdir(path: string, options: { all?: boolean } = {}): string[] {
    const { node } = this.lookup(path, true, 'scandir');
    if (node.type !== 'directory') throw new VfsError('ENOTDIR', path, 'scandir');
    if (!this.can(node, 'r')) throw new VfsError('EACCES', path, 'scandir');
    return Object.keys(node.children ?? {}).filter((name) => options.all || !name.startsWith('.'));
  }

  readFile(path: string): string {
    const { node } = this.lookup(path, true, 'open');
    if (node.type === 'directory') throw new VfsError('EISDIR', path, 'read');
    if (!this.can(node, 'r')) throw new VfsError('EACCES', path, 'open');
    return this.contentOf(node);
  }

  readStyled(path: string): readonly Line[] | null {
    try {
      const { node } = this.lookup(path, true, 'open');
      if (node.type !== 'file' || !this.can(node, 'r')) return null;
      return node.styled ?? null;
    } catch {
      return null;
    }
  }

  /** True when `path` is a file the visitor may run. */
  isExecutable(path: string): boolean {
    try {
      const { node } = this.lookup(path, true, 'execve');
      return node.type === 'file' && this.can(node, 'x');
    } catch {
      return false;
    }
  }

  /** The registry command a /usr/bin stub stands for, if `path` is one. */
  builtinAt(path: string): string | undefined {
    try {
      return this.lookup(path, true, 'execve').node.builtin;
    } catch {
      return undefined;
    }
  }

  access(path: string, want: 'r' | 'w' | 'x'): boolean {
    try {
      return this.can(this.lookup(path, true, 'access').node, want);
    } catch {
      return false;
    }
  }

  // ── Writing ──

  writeFile(path: string, data: string, options: { append?: boolean; mode?: number; noclobber?: boolean } = {}): void {
    const slot = this.slotFor(path, 'open');
    const existing = slot.node;
    const full = join(slot.dirPath, slot.name);
    if (existing === undefined) {
      this.checkCreate(slot.dir, path);
      validateName(slot.name, path);
      const file: VirtualFile = {
        name: slot.name,
        type: 'file',
        content: '',
        mode: (options.mode ?? 0o666) & ~UMASK & 0o7777,
        owner: this.credentials.name,
        group: this.credentials.group,
        mtime: this.now(),
      };
      this.setContent(file, data, path);
      this.children(slot.dir)[slot.name] = file;
      slot.dir.mtime = this.now();
      this.emit([full]);
      return;
    }
    if (existing.type === 'directory') throw new VfsError('EISDIR', path, 'open');
    if (options.noclobber && existing.type === 'file') throw new VfsError('EEXIST', path, 'open');
    if (!this.can(existing, 'w')) throw new VfsError('EACCES', path, 'open');
    if (existing.type === 'device') return;
    if (existing.generate !== undefined) throw new VfsError('EACCES', path, 'open');
    const next = options.append ? (existing.content ?? '') + data : data;
    this.setContent(existing, next, path, options.append ? byteLength(data) : undefined);
    delete existing.styled;
    existing.mtime = this.now();
    this.emit([full]);
  }

  /**
   * Opens a file for a redirection: creates it, empties it unless `append`, and refuses an
   * existing file with `noclobber`. Each write then appends.
   */
  openWrite(path: string, options: { append: boolean; noclobber: boolean }): FileHandle {
    this.writeFile(path, '', options.append ? { append: true } : { noclobber: options.noclobber });
    const slot = this.slotFor(path, 'open');
    const real = join(slot.dirPath, slot.name);
    let closed = false;
    return {
      write: (text) => {
        if (!closed && text !== '') this.writeFile(real, text, { append: true });
      },
      close: () => {
        closed = true;
      },
    };
  }

  mkdir(path: string, options: { parents?: boolean; mode?: number } = {}): void {
    const parts = segments(path);
    if (parts.length === 0) {
      if (options.parents) return;
      throw new VfsError('EEXIST', path, 'mkdir');
    }
    if (options.parents) {
      for (let i = 1; i <= parts.length; i += 1) {
        const prefix = fromSegments(parts.slice(0, i));
        let found: Found | null = null;
        try {
          found = this.lookup(prefix, true, 'mkdir');
        } catch (error) {
          if (!(error instanceof VfsError) || error.code !== 'ENOENT') throw withPath(error, path);
        }
        if (found === null) this.createDirectory(prefix, options.mode, path);
        else if (found.node.type !== 'directory') throw new VfsError(i === parts.length ? 'EEXIST' : 'ENOTDIR', path, 'mkdir');
      }
      return;
    }
    const slot = this.slotFor(path, 'mkdir', false);
    if (slot.node !== undefined) throw new VfsError('EEXIST', path, 'mkdir');
    this.createDirectory(path, options.mode, path);
  }

  rmdir(path: string): void {
    if (segments(path).length === 0) throw new VfsError('EPERM', path, 'rmdir');
    const found = this.lookup(path, false, 'rmdir');
    if (found.node.type !== 'directory') throw new VfsError('ENOTDIR', path, 'rmdir');
    if (Object.keys(found.node.children ?? {}).length > 0) throw new VfsError('ENOTEMPTY', path, 'rmdir');
    this.detach(found, path, 'rmdir');
  }

  rm(path: string, options: { recursive?: boolean; force?: boolean } = {}): void {
    if (segments(path).length === 0) throw new VfsError('EPERM', path, 'unlink');
    let found: Found;
    try {
      found = this.lookup(path, false, 'unlink');
    } catch (error) {
      if (options.force && error instanceof VfsError && error.code === 'ENOENT') return;
      throw error;
    }
    if (found.node.type === 'directory') {
      if (!options.recursive) throw new VfsError('EISDIR', path, 'unlink');
      this.checkTree(found.node, found.path);
    }
    this.detach(found, path, 'unlink');
  }

  rename(from: string, to: string): void {
    if (segments(from).length === 0 || segments(to).length === 0) throw new VfsError('EPERM', to, 'rename');
    const source = this.lookup(from, false, 'rename');
    const slot = this.slotFor(to, 'rename', false);
    const target = join(slot.dirPath, slot.name);
    if (target === source.path) return;
    if (source.node.type === 'directory' && isWithin(target, source.path)) throw new VfsError('EINVAL', to, 'rename');
    validateName(slot.name, to);
    const existing = slot.node;
    if (existing !== undefined) {
      if (existing.type === 'directory') {
        if (source.node.type !== 'directory') throw new VfsError('EISDIR', to, 'rename');
        if (Object.keys(existing.children ?? {}).length > 0) throw new VfsError('ENOTEMPTY', to, 'rename');
      } else if (source.node.type === 'directory') {
        throw new VfsError('ENOTDIR', to, 'rename');
      }
      this.checkRemove(slot.dir, existing, to);
    }
    if (source.parent === null) throw new VfsError('EPERM', from, 'rename');
    this.checkRemove(source.parent, source.node, from);
    this.checkCreate(slot.dir, to);
    delete this.children(source.parent)[source.name];
    source.node.name = slot.name;
    this.children(slot.dir)[slot.name] = source.node;
    source.parent.mtime = this.now();
    slot.dir.mtime = this.now();
    this.used = null;
    this.emit([source.path, target]);
  }

  copy(from: string, to: string, options: { recursive?: boolean } = {}): void {
    const source = this.lookup(from, true, 'open');
    if (source.node.type === 'directory' && !options.recursive) throw new VfsError('EISDIR', from, 'open');
    const slot = this.slotFor(to, 'open');
    const target = join(slot.dirPath, slot.name);
    if (source.node.type === 'directory' && isWithin(target, source.path)) throw new VfsError('EINVAL', to, 'copy');
    const existing = slot.node;
    if (existing !== undefined) {
      if (existing.type === 'directory') throw new VfsError(source.node.type === 'directory' ? 'EEXIST' : 'EISDIR', to, 'open');
      if (source.node.type === 'directory') throw new VfsError('ENOTDIR', to, 'open');
      this.writeFile(target, this.readFile(source.path));
      return;
    }
    this.checkCreate(slot.dir, to);
    validateName(slot.name, to);
    const clone = this.cloneTree(source.node, slot.name, source.path);
    const added = this.countedBytes(clone);
    if (added > 0 && this.usage().used + added > this.quota) throw new VfsError('ENOSPC', to, 'write');
    this.children(slot.dir)[slot.name] = clone;
    slot.dir.mtime = this.now();
    this.used = null;
    this.emit([target]);
  }

  symlink(target: string, path: string): void {
    const slot = this.slotFor(path, 'symlink', false);
    if (slot.node !== undefined) throw new VfsError('EEXIST', path, 'symlink');
    this.checkCreate(slot.dir, path);
    validateName(slot.name, path);
    this.children(slot.dir)[slot.name] = {
      name: slot.name,
      type: 'symlink',
      target,
      mode: 0o777,
      owner: this.credentials.name,
      group: this.credentials.group,
      mtime: this.now(),
    };
    slot.dir.mtime = this.now();
    this.emit([join(slot.dirPath, slot.name)]);
  }

  readlink(path: string): string {
    const { node } = this.lookup(path, false, 'readlink');
    if (node.type !== 'symlink') throw new VfsError('EINVAL', path, 'readlink');
    return node.target ?? '';
  }

  chmod(path: string, mode: number): void {
    const found = this.lookup(path, true, 'chmod');
    if (this.credentials.uid !== 0 && this.ownerUid(found.node) !== this.credentials.uid) {
      throw new VfsError('EPERM', path, 'chmod');
    }
    found.node.mode = mode & 0o7777;
    this.emit([found.path]);
  }

  chown(path: string, owner: string, group?: string): void {
    const found = this.lookup(path, true, 'chown');
    if (this.credentials.uid !== 0) {
      // Only root gives files away; an owner may change the group to one of their own.
      const keepsOwner = uidOf(owner) === this.ownerUid(found.node) && this.ownerUid(found.node) === this.credentials.uid;
      const ownGroup = group === undefined || this.credentials.groups.includes(gidOf(group));
      if (!keepsOwner || !ownGroup) throw new VfsError('EPERM', path, 'chown');
    }
    found.node.owner = owner;
    if (group !== undefined) found.node.group = group;
    this.used = null;
    this.emit([found.path]);
  }

  touch(path: string, mtime?: number): void {
    const slot = this.slotFor(path, 'utimensat');
    if (slot.node === undefined) {
      this.writeFile(path, '');
      if (mtime !== undefined) {
        const created = own(slot.dir.children, slot.name);
        if (created !== undefined) created.mtime = mtime;
      }
      return;
    }
    const node = slot.node;
    const owns = this.credentials.uid === 0 || this.ownerUid(node) === this.credentials.uid;
    if (!owns && (mtime !== undefined || !this.can(node, 'w'))) throw new VfsError('EACCES', path, 'utimensat');
    node.mtime = mtime ?? this.now();
    this.emit([join(slot.dirPath, slot.name)]);
  }

  // ── Listing ──

  glob(pattern: string, cwd: string): string[] {
    return globPaths(pattern, cwd, this.globFs());
  }

  /** The VFS as the glob matcher sees a file system: unreadable folders list nothing. */
  globFs(): GlobFs {
    return {
      readdir: (path) => {
        try {
          return this.readdir(path, { all: true });
        } catch {
          return null;
        }
      },
      exists: (path) => this.exists(path),
      isDirectory: (path) => {
        try {
          return this.lookup(path, true, 'stat').node.type === 'directory';
        } catch {
          return false;
        }
      },
    };
  }

  /** Every node under `path`, depth first, with lstat; folders that cannot be read are not entered. */
  *walk(path: string): Iterable<[string, Stat]> {
    const start = this.lookup(path, true, 'scandir');
    const visit = function* (this: Vfs, at: string, node: VirtualFile): Generator<[string, Stat]> {
      yield [at, this.statOf(at, node)];
      if (node.type !== 'directory' || !this.can(node, 'r') || !this.can(node, 'x')) return;
      for (const name of Object.keys(node.children ?? {})) {
        const child = own(node.children, name);
        if (child !== undefined) yield* visit.call(this, at === '/' ? `/${name}` : `${at}/${name}`, child);
      }
    };
    yield* visit.call(this, start.path, start.node);
  }

  usage(): { used: number; quota: number } {
    if (this.used === null) this.used = this.countedBytes(this.root);
    return { used: this.used, quota: this.quota };
  }

  onChange(listener: (paths: readonly string[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  // ── Permissions ──

  private ownerUid(node: VirtualFile): number {
    return uidOf(node.owner ?? 'root');
  }

  /** Whether the credentials may read, write or execute (search, for a folder) the node. */
  private can(node: VirtualFile, want: 'r' | 'w' | 'x'): boolean {
    const mode = node.mode ?? defaultMode(node.type);
    if (this.credentials.uid === 0) return want !== 'x' || node.type === 'directory' || (mode & 0o111) !== 0;
    const shift =
      this.ownerUid(node) === this.credentials.uid ? 6 : this.credentials.groups.includes(gidOf(node.group ?? 'root')) ? 3 : 0;
    const bit = want === 'r' ? 4 : want === 'w' ? 2 : 1;
    return ((mode >> shift) & bit) !== 0;
  }

  private checkCreate(dir: VirtualFile, path: string): void {
    if (!this.can(dir, 'w') || !this.can(dir, 'x')) throw new VfsError('EACCES', path, 'open');
  }

  /** Deleting or replacing `node` in `dir`: w and x on the folder, and the sticky bit's rule. */
  private checkRemove(dir: VirtualFile, node: VirtualFile, path: string): void {
    this.checkCreate(dir, path);
    const sticky = ((dir.mode ?? 0) & 0o1000) !== 0;
    const me = this.credentials.uid;
    if (sticky && me !== 0 && this.ownerUid(node) !== me && this.ownerUid(dir) !== me) {
      throw new VfsError('EPERM', path, 'unlink');
    }
  }

  /** rm -r: every folder inside must be readable, searchable and writable. */
  private checkTree(node: VirtualFile, path: string): void {
    if (node.type !== 'directory') return;
    const names = Object.keys(node.children ?? {});
    if (names.length === 0) return;
    if (!this.can(node, 'r') || !this.can(node, 'w') || !this.can(node, 'x')) throw new VfsError('EACCES', path, 'unlink');
    for (const name of names) {
      const child = own(node.children, name);
      if (child !== undefined) this.checkTree(child, `${path}/${name}`);
    }
  }

  // ── Lookup ──

  /**
   * Finds the node at an absolute path. Each folder passed through needs x. Symbolic links on
   * the way are followed, and the last one too when `follow` is set; past 40 links, ELOOP.
   */
  private lookup(path: string, follow: boolean, syscall: string): Found {
    let pending = segments(path);
    const stack: { node: VirtualFile; name: string }[] = [{ node: this.root, name: '' }];
    let hops = 0;
    while (pending.length > 0) {
      const segment = pending.shift() as string;
      if (segment === '.' || segment === '') continue;
      if (segment === '..') {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const dir = (stack[stack.length - 1] as { node: VirtualFile }).node;
      if (dir.type !== 'directory') throw new VfsError('ENOTDIR', path, syscall);
      if (!this.can(dir, 'x')) throw new VfsError('EACCES', path, syscall);
      const child = own(dir.children, segment);
      if (child === undefined) throw new VfsError('ENOENT', path, syscall);
      if (child.type === 'symlink' && (pending.length > 0 || follow)) {
        hops += 1;
        if (hops > MAX_SYMLINK_HOPS) throw new VfsError('ELOOP', path, syscall);
        const target = child.target ?? '';
        if (target.startsWith('/')) stack.length = 1;
        // Kept as written, so a `..` in a target climbs from where the link really is.
        pending = [...target.split('/').filter((part) => part !== ''), ...pending];
        continue;
      }
      stack.push({ node: child, name: segment });
    }
    const top = stack[stack.length - 1] as { node: VirtualFile; name: string };
    const parent = stack.length > 1 ? (stack[stack.length - 2] as { node: VirtualFile }).node : null;
    return { node: top.node, parent, name: top.name, path: fromSegments(stack.slice(1).map((entry) => entry.name)) };
  }

  /**
   * The folder a path's last name lives in, and what is there now. With `follow` (the default),
   * a symbolic link in the last place is followed to where it points, as open() does.
   */
  private slotFor(path: string, syscall: string, follow = true): Slot {
    let current = path;
    for (let hops = 0; ; hops += 1) {
      const parts = segments(current);
      const name = parts.pop();
      if (name === undefined) return { dir: this.root, dirPath: '/', name: '', node: this.root };
      const parent = this.lookup(fromSegments(parts), true, syscall);
      if (parent.node.type !== 'directory') throw new VfsError('ENOTDIR', path, syscall);
      if (!this.can(parent.node, 'x')) throw new VfsError('EACCES', path, syscall);
      const node = own(parent.node.children, name);
      if (follow && node?.type === 'symlink') {
        if (hops >= MAX_SYMLINK_HOPS) throw new VfsError('ELOOP', path, syscall);
        current = linkTarget(parent.path, node.target ?? '');
        continue;
      }
      return { dir: parent.node, dirPath: parent.path, name, node };
    }
  }

  // ── Internals ──

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private children(node: VirtualFile): Record<string, VirtualFile> {
    if (node.children === undefined) node.children = emptyChildren();
    return node.children;
  }

  private createDirectory(path: string, mode: number | undefined, shown: string): void {
    const slot = this.slotFor(path, 'mkdir', false);
    this.checkCreate(slot.dir, shown);
    validateName(slot.name, shown);
    this.children(slot.dir)[slot.name] = {
      name: slot.name,
      type: 'directory',
      children: emptyChildren(),
      mode: (mode ?? 0o777) & ~UMASK & 0o7777,
      owner: this.credentials.name,
      group: this.credentials.group,
      mtime: this.now(),
    };
    slot.dir.mtime = this.now();
    this.emit([join(slot.dirPath, slot.name)]);
  }

  private detach(found: Found, path: string, syscall: string): void {
    if (found.parent === null) throw new VfsError('EPERM', path, syscall);
    this.checkRemove(found.parent, found.node, path);
    delete this.children(found.parent)[found.name];
    found.parent.mtime = this.now();
    this.used = null;
    this.emit([found.path]);
  }

  private contentOf(node: VirtualFile): string {
    if (node.type === 'device') {
      const random = this.options.context?.().random ?? Math.random;
      switch (node.device) {
        case 'zero':
          return '\0'.repeat(64);
        case 'random':
        case 'urandom':
          return randomText(random, 64);
        default:
          return '';
      }
    }
    if (node.generate !== undefined) return node.generate(this.context());
    return node.content ?? '';
  }

  private context(): GenerateContext {
    return this.options.context?.() ?? { now: this.now(), bootTime: this.now(), sys: null, random: Math.random };
  }

  /** Bytes the quota counts for a node: the visitor's own regular files. */
  private sizeOf(node: VirtualFile): number {
    if (node.type !== 'file' || node.generate !== undefined) return 0;
    let size = this.sizes.get(node);
    if (size === undefined) {
      size = byteLength(node.content ?? '');
      this.sizes.set(node, size);
    }
    return size;
  }

  private counts(node: VirtualFile): boolean {
    return node.type === 'file' && node.generate === undefined && this.ownerUid(node) === this.credentials.uid;
  }

  private countedBytes(node: VirtualFile): number {
    let total = this.counts(node) ? this.sizeOf(node) : 0;
    for (const name of Object.keys(node.children ?? {})) {
      const child = own(node.children, name);
      if (child !== undefined) total += this.countedBytes(child);
    }
    return total;
  }

  /** Sets a file's content within the quota. `appended` is the bytes added, when known. */
  private setContent(node: VirtualFile, content: string, path: string, appended?: number): void {
    const before = this.sizeOf(node);
    const after = appended === undefined ? byteLength(content) : before + appended;
    const counted = this.counts(node);
    if (counted && after > before && this.usage().used + (after - before) > this.quota) {
      throw new VfsError('ENOSPC', path, 'write');
    }
    node.content = content;
    this.sizes.set(node, after);
    if (counted && this.used !== null) this.used += after - before;
  }

  private cloneTree(node: VirtualFile, name: string, path: string): VirtualFile {
    if (!this.can(node, 'r')) throw new VfsError('EACCES', path, 'open');
    const base = {
      name,
      mode: (node.mode ?? defaultMode(node.type)) & ~UMASK & 0o7777,
      owner: this.credentials.name,
      group: this.credentials.group,
      mtime: this.now(),
    };
    if (node.type === 'directory') {
      const children = emptyChildren();
      for (const key of Object.keys(node.children ?? {})) {
        const child = own(node.children, key);
        if (child !== undefined) children[key] = this.cloneTree(child, key, `${path}/${key}`);
      }
      return { ...base, type: 'directory', children };
    }
    if (node.type === 'symlink') return { ...base, type: 'symlink', target: node.target ?? '', mode: 0o777 };
    const copy: VirtualFile = { ...base, type: 'file', content: this.contentOf(node) };
    if (node.styled !== undefined) copy.styled = node.styled;
    return copy;
  }

  private statOf(path: string, node: VirtualFile): Stat {
    const owner = node.owner ?? 'root';
    const group = node.group ?? 'root';
    let size = 0;
    if (node.type === 'directory') size = 4096;
    else if (node.type === 'symlink') size = byteLength(node.target ?? '');
    else if (node.type === 'file' && node.generate === undefined) size = this.sizeOf(node);
    const subdirs =
      node.type === 'directory'
        ? Object.keys(node.children ?? {}).filter((name) => own(node.children, name)?.type === 'directory').length
        : 0;
    return {
      path,
      type: node.type,
      mode: node.mode ?? defaultMode(node.type),
      owner,
      group,
      uid: uidOf(owner),
      gid: gidOf(group),
      size,
      mtime: node.type === 'file' && node.generate !== undefined ? this.now() : (node.mtime ?? this.now()),
      nlink: node.type === 'directory' ? 2 + subdirs : 1,
      ...(node.type === 'symlink' ? { target: node.target ?? '' } : {}),
    };
  }

  private emit(paths: readonly string[]): void {
    for (const listener of [...this.listeners]) listener(paths);
  }
}
