import { describe, expect, it } from 'vitest';
import { strerror, vfsMessage } from './errors';
import { LegacyTreeFs, addGuestHome, emptyHome, resolvePath, segments, type LegacyNode } from './legacy-tree';
import { VfsError } from './types';

function tree(): LegacyNode {
  return {
    name: '',
    type: 'directory',
    children: {
      home: {
        name: 'home',
        type: 'directory',
        children: {
          user: {
            name: 'user',
            type: 'directory',
            children: {
              'README.md': { name: 'README.md', type: 'file', filePath: '/README.md', format: 'html' },
              'notes.txt': { name: 'notes.txt', type: 'file', content: 'héllo\n' },
              '.bashrc': { name: '.bashrc', type: 'file', content: '' },
              docs: { name: 'docs', type: 'directory', children: { 'a.txt': { name: 'a.txt', type: 'file', content: 'a' } } },
            },
          },
        },
      },
      etc: { name: 'etc', type: 'directory', children: {} },
    },
  };
}

function fs(root = tree(), cwd: string[] = ['home', 'user']): LegacyTreeFs {
  return new LegacyTreeFs({ root, cwd, now: () => 5000 });
}

function code(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof VfsError) return error.code;
    throw error;
  }
  return undefined;
}

describe('paths', () => {
  it('resolve ~, absolute and relative paths, and .. past the root', () => {
    expect(resolvePath('~', '/etc', '/home/guest')).toBe('/home/guest');
    expect(resolvePath('~/a/../b', '/etc', '/home/guest')).toBe('/home/guest/b');
    expect(resolvePath('/../../x/./y/', '/etc', '/h')).toBe('/x/y');
    expect(resolvePath('docs/..', '/home/user', '/h')).toBe('/home/user');
    expect(segments('/a//b/./c/..')).toEqual(['a', 'b']);
  });
});

describe('LegacyTreeFs', () => {
  it('reads files and folders, with dotfiles only when asked', () => {
    const files = fs();
    expect(files.readFile('/home/user/notes.txt')).toBe('héllo\n');
    expect(files.readdir('/home/user')).toEqual(['README.md', 'notes.txt', 'docs']);
    expect(files.readdir('/home/user', { all: true })).toContain('.bashrc');
    expect(files.exists('/home/user/docs/a.txt')).toBe(true);
    expect(files.stat('/home/user/notes.txt')).toMatchObject({ type: 'file', size: 7, mode: 0o644, owner: 'guest', uid: 1000 });
    expect(files.stat('/home/user/docs')).toMatchObject({ type: 'directory', mode: 0o755 });
    expect(files.readStyled()).toBeNull();
  });

  it('reports errors as coreutils does', () => {
    const files = fs();
    expect(code(() => files.readFile('/home/user/nope'))).toBe('ENOENT');
    expect(code(() => files.readFile('/home/user/docs'))).toBe('EISDIR');
    expect(code(() => files.readdir('/home/user/notes.txt'))).toBe('ENOTDIR');
    expect(code(() => files.readFile('/home/user/notes.txt/x'))).toBe('ENOTDIR');
    expect(strerror('ENOENT')).toBe('No such file or directory');
    expect(vfsMessage(new VfsError('EACCES', '/etc/shadow'))).toBe('/etc/shadow: Permission denied');
  });

  it('never finds an inherited name', () => {
    const files = fs();
    for (const name of ['constructor', '__proto__', 'toString']) {
      expect(files.exists(`/home/user/${name}`), name).toBe(false);
      expect(code(() => files.readFile(`/${name}`))).toBe('ENOENT');
    }
  });

  it('writes, appends and refuses to clobber, and stops fetching an owner document once written', () => {
    const root = tree();
    const files = fs(root);
    files.writeFile('/home/user/new.txt', 'a');
    files.writeFile('/home/user/new.txt', 'b', { append: true });
    expect(files.readFile('/home/user/new.txt')).toBe('ab');
    expect(code(() => files.writeFile('/home/user/new.txt', 'c', { noclobber: true }))).toBe('EEXIST');
    expect(code(() => files.writeFile('/nope/x', 'c'))).toBe('ENOENT');
    expect(code(() => files.writeFile('/home/user/docs', 'c'))).toBe('EISDIR');
    files.writeFile('/home/user/README.md', 'mine');
    expect(root.children?.home?.children?.user?.children?.['README.md']).toEqual({ name: 'README.md', type: 'file', content: 'mine' });
  });

  it('makes folders, with parents when asked', () => {
    const files = fs();
    files.mkdir('/home/user/x');
    expect(code(() => files.mkdir('/home/user/x'))).toBe('EEXIST');
    expect(code(() => files.mkdir('/home/user/y/z'))).toBe('ENOENT');
    files.mkdir('/home/user/y/z', { parents: true });
    files.mkdir('/home/user/y/z', { parents: true });
    expect(files.stat('/home/user/y/z').type).toBe('directory');
  });

  it('removes files and folders, refusing / and a folder without recursion', () => {
    const files = fs();
    expect(code(() => files.rm('/home/user/docs'))).toBe('EISDIR');
    expect(code(() => files.rmdir('/home/user/docs'))).toBe('ENOTEMPTY');
    files.rm('/home/user/docs', { recursive: true });
    expect(files.exists('/home/user/docs')).toBe(false);
    expect(code(() => files.rm('/home/user/nope'))).toBe('ENOENT');
    files.rm('/home/user/nope', { force: true });
    expect(code(() => files.rm('/'))).toBe('EPERM');
    files.mkdir('/home/user/empty');
    files.rmdir('/home/user/empty');
    expect(files.exists('/home/user/empty')).toBe(false);
  });

  it('renames and copies, and refuses to move a folder into itself', () => {
    const files = fs();
    files.rename('/home/user/notes.txt', '/etc/notes');
    expect(files.readFile('/etc/notes')).toBe('héllo\n');
    files.copy('/home/user/docs', '/etc/docs', { recursive: true });
    files.writeFile('/etc/docs/a.txt', 'changed');
    expect(files.readFile('/home/user/docs/a.txt')).toBe('a');
    expect(code(() => files.copy('/home/user/docs', '/etc/again'))).toBe('EISDIR');
    expect(code(() => files.rename('/home/user/docs', '/home/user/docs/inner'))).toBe('EINVAL');
  });

  it('touches, globs, walks and reports usage and changes', () => {
    const files = fs();
    const changed: string[] = [];
    const stop = files.onChange((paths) => changed.push(...paths));
    files.touch('/home/user/t.txt');
    files.touch('/home/user/t.txt', 42);
    stop();
    files.touch('/home/user/u.txt');
    expect(files.stat('/home/user/t.txt').mtime).toBe(42);
    expect(changed).toEqual(['/home/user/t.txt', '/home/user/t.txt']);
    expect(files.glob('*.txt', '/home/user')).toEqual(['notes.txt', 't.txt', 'u.txt']);
    expect([...files.walk('/home/user/docs')].map(([path]) => path)).toEqual(['/home/user/docs', '/home/user/docs/a.txt']);
    expect(files.usage()).toEqual({ used: 8, quota: 512 * 1024 });
  });

  it('has no symbolic links and no owners to change', () => {
    const files = fs();
    expect(code(() => files.symlink('/a', '/home/user/l'))).toBe('EPERM');
    expect(code(() => files.readlink('/home/user/notes.txt'))).toBe('EINVAL');
    expect(code(() => files.chown('/home/user/notes.txt'))).toBe('EPERM');
    expect(files.access('/home/user/notes.txt')).toBe(true);
  });

  it('mirrors the legacy current folder both ways', () => {
    const cwd = ['home', 'user'];
    const files = fs(tree(), cwd);
    expect(files.legacyCwd()).toBe('/home/user');
    files.setLegacyCwd('/etc/../home');
    expect(cwd).toEqual(['home']);
  });

  it('puts the seed back on restore', () => {
    const root = tree();
    const files = new LegacyTreeFs({ root, cwd: [], restore: () => (root.children = tree().children) });
    files.rm('/home', { recursive: true });
    files.restore();
    expect(files.exists('/home/user/notes.txt')).toBe(true);
  });
});

describe('the guest home', () => {
  it('shares its files with /home/user, so either path reaches them', () => {
    const root = tree();
    addGuestHome(root);
    addGuestHome(root);
    const files = fs(root);
    expect(files.readdir('/home')).toEqual(['user', 'guest']);
    files.writeFile('/home/guest/both.txt', 'x');
    expect(files.readFile('/home/user/both.txt')).toBe('x');
    expect(files.readFile('/home/guest/notes.txt')).toBe('héllo\n');
  });

  it('exists on its own for a shell without the legacy files', () => {
    expect(emptyHome().readdir('/home/guest')).toEqual([]);
  });
});
