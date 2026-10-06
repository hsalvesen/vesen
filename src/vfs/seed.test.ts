import { describe, expect, it } from 'vitest';
import { GUEST } from './identity';
import { SEED_MTIME, seedTree, seedVersion } from './seed';
import { Vfs } from './vfs';

const options = { version: '2.0.0', commands: [{ name: 'ls', summary: 'list directory contents' }, { name: 'cat', summary: 'concatenate files' }], timeZone: 'Australia/Sydney' };

function fs(): Vfs {
  return new Vfs({ seed: () => seedTree(options), now: () => SEED_MTIME + 1 });
}

describe('the seed', () => {
  it('keeps the legacy home folder in its order, inside /home/guest', () => {
    expect(fs().readdir('/home/guest', { all: true })).toEqual([
      'README.md', 'history.txt', 'documents', 'projects', 'desktop', 'downloads', 'pictures', 'music', 'videos',
      'public', 'templates', 'bin', 'src', 'scripts', 'config', '.bashrc', '.profile', '.vimrc', '.gitconfig', '.ssh',
      '.local', '.bash_history',
    ]);
  });

  it('keeps the legacy root folders in their order', () => {
    expect(fs().readdir('/')).toEqual(['bin', 'usr', 'var', 'tmp', 'opt', 'lib', 'boot', 'dev', 'proc', 'sys', 'mnt', 'media', 'root', 'home', 'etc']);
  });

  it('describes one identity in /etc (F024)', () => {
    const tree = fs();
    expect(tree.readFile('/etc/passwd')).toContain(`guest:x:1000:1000:Guest:${GUEST.home}:/bin/vesh`);
    expect(tree.readFile('/etc/passwd')).toContain('has:x:1001:1001:Has Salvesen:/home/has:/bin/vesh');
    expect(tree.readFile('/etc/passwd')).toMatch(/^root:x:0:0:/);
    expect(tree.readFile('/etc/group')).toContain('shadow:x:42:');
    expect(tree.readFile('/etc/hostname')).toBe('vesen\n');
    expect(tree.readFile('/etc/os-release')).toContain('VERSION="2.0.0"');
    expect(tree.readFile('/etc/shells')).toContain('/bin/vesh');
    expect(tree.readFile('/etc/timezone')).toBe('Australia/Sydney\n');
    expect(tree.stat('/etc/shadow')).toMatchObject({ mode: 0o640, owner: 'root', group: 'shadow' });
  });

  it('gives the owner a read-only portfolio in /home/has', () => {
    const tree = fs();
    expect(tree.readdir('/home/has', { all: true })).toEqual(['about.md', 'projects.md', '.plan']);
    expect(tree.stat('/home/has')).toMatchObject({ owner: 'has', mode: 0o755 });
    expect(tree.stat('/home/has/about.md')).toMatchObject({ owner: 'has', mode: 0o644 });
    expect(tree.readFile('/home/has/about.md')).toContain('https://www.linkedin.com/in/harrysalvesen/');
    expect(tree.readFile('/home/has/.plan')).toContain('https://github.com/hsalvesen/vesen');
  });

  it('makes the visitor\'s scripts executable and their .bashrc define the aliases', () => {
    const tree = fs();
    expect(tree.isExecutable('/home/guest/bin/my-script')).toBe(true);
    expect(tree.isExecutable('/home/guest/README.md')).toBe(false);
    expect(tree.readFile('/home/guest/.bashrc')).toContain('alias ll="ls -la"');
    expect(tree.stat('/home/guest/README.md').mtime).toBe(SEED_MTIME);
  });

  it('builds new nodes every time, with a stable version', () => {
    const a = seedTree(options);
    const b = seedTree(options);
    expect(a).not.toBe(b);
    expect(a.children?.home).not.toBe(b.children?.home);
    expect(seedVersion(a)).toBe(seedVersion(b));
    expect(seedVersion(a)).toMatch(/^[0-9a-f]{8}$/);
    const changed = seedTree(options);
    const readme = changed.children?.home?.children?.guest?.children?.['README.md'];
    if (readme) readme.content = 'changed';
    expect(seedVersion(changed)).not.toBe(seedVersion(a));
    // Only the home folder counts: a new command does not invalidate a visitor's overlay.
    expect(seedVersion(seedTree({ ...options, commands: [] }))).toBe(seedVersion(a));
  });
});
