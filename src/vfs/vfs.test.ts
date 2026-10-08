import { describe, expect, it } from 'vitest';
import { rmRefusal, strerror } from './errors';
import { seedTree } from './seed';
import { VfsError, type GenerateContext, type VfsCode, type VirtualFile } from './types';
import { DEFAULT_QUOTA, NODE_OVERHEAD, Vfs, validateName, type Credentials } from './vfs';

const NOW = Date.UTC(2026, 9, 6, 9, 0, 0);
const ROOT: Credentials = { name: 'root', uid: 0, gid: 0, group: 'root', groups: [0] };

function seeded(options: { credentials?: Credentials; quota?: number; context?: () => GenerateContext } = {}): Vfs {
  return new Vfs({
    seed: () => seedTree({ version: '9.9.9', commands: [{ name: 'ls', summary: 'list directory contents' }] }),
    now: () => NOW,
    ...options,
  });
}

/** The error code a call fails with, or 'ok'. */
function code(run: () => unknown): VfsCode | 'ok' {
  try {
    run();
    return 'ok';
  } catch (error) {
    if (error instanceof VfsError) return error.code;
    throw error;
  }
}

describe('the seed through the Vfs', () => {
  it('re-homes the visitor in /home/guest, with /home/user as a link to it (F003)', () => {
    const fs = seeded();
    expect(fs.readdir('/home')).toEqual(['guest', 'has', 'user']);
    expect(fs.lstat('/home/user')).toMatchObject({ type: 'symlink', target: 'guest' });
    expect(fs.realpath('/home/user/documents')).toBe('/home/guest/documents');
    expect(fs.readdir('/home/guest', { all: true })).toEqual(
      expect.arrayContaining(['README.md', 'documents', 'projects', '.bashrc', '.ssh', '.bash_history']),
    );
    expect(fs.stat('/home/guest/README.md')).toMatchObject({ owner: 'guest', group: 'guest', uid: 1000, mode: 0o644 });
  });

  it('keeps plain text for grep and styled lines for cat (F093)', () => {
    const fs = seeded();
    const text = fs.readFile('/home/guest/README.md');
    expect(text).toContain('The Terminal\nA terminal');
    expect(text).not.toMatch(/[<{]/);
    const styled = fs.readStyled('/home/guest/README.md');
    expect(styled?.some((line) => line.some((span) => span.text === 'The Terminal' && span.style?.fg === 'yellow'))).toBe(true);
    // Any write clears the styled lines.
    fs.writeFile('/home/guest/README.md', 'mine\n');
    expect(fs.readStyled('/home/guest/README.md')).toBeNull();
  });

  it('lists the registry in /usr/bin, and /bin is a link to it', () => {
    const fs = seeded();
    expect(fs.readdir('/bin')).toEqual(['ls']);
    expect(fs.builtinAt('/bin/ls')).toBe('ls');
    expect(fs.isExecutable('/usr/bin/ls')).toBe(true);
    expect(fs.readdir('/usr/share/man/man1')).toEqual(['ls.1']);
  });

  it('has null-prototype children, so inherited names are never found (F031)', () => {
    const fs = seeded();
    expect(fs.exists('/home/guest/constructor')).toBe(false);
    expect(fs.exists('/home/guest/__proto__')).toBe(false);
    expect(Object.getPrototypeOf(fs.root.children)).toBeNull();
  });
});

describe('names', () => {
  it.each(['', '.', '..', 'a/b'])('rejects %j', (name) => {
    expect(code(() => validateName(name))).toBe('EINVAL');
  });

  it('rejects a seed with a bad name', () => {
    const bad: VirtualFile = { name: '', type: 'directory', children: { '..': { name: '..', type: 'file', content: '' } } };
    expect(() => new Vfs({ seed: () => bad })).toThrow(VfsError);
  });
});

describe('permissions for guest (F082)', () => {
  // [operation, guest's result, root's result]
  const matrix: [string, (fs: Vfs) => unknown, VfsCode | 'ok', VfsCode | 'ok'][] = [
    ['touch /etc/x', (fs) => fs.touch('/etc/x'), 'EACCES', 'ok'],
    ['write /etc/passwd', (fs) => fs.writeFile('/etc/passwd', 'x'), 'EACCES', 'ok'],
    ['read /etc/passwd', (fs) => fs.readFile('/etc/passwd'), 'ok', 'ok'],
    ['read /etc/shadow', (fs) => fs.readFile('/etc/shadow'), 'EACCES', 'ok'],
    ['list /root', (fs) => fs.readdir('/root'), 'EACCES', 'ok'],
    ['stat /root/x through /root', (fs) => fs.stat('/root/x'), 'EACCES', 'ENOENT'],
    ['create in /tmp', (fs) => fs.writeFile('/tmp/mine', 'x'), 'ok', 'ok'],
    ['create in ~', (fs) => fs.writeFile('/home/guest/new.txt', 'x'), 'ok', 'ok'],
    ['create in /home', (fs) => fs.mkdir('/home/someone'), 'EACCES', 'ok'],
    ['write the owner\'s files', (fs) => fs.writeFile('/home/has/about.md', 'x'), 'EACCES', 'ok'],
    ['read the owner\'s files', (fs) => fs.readFile('/home/has/about.md'), 'ok', 'ok'],
    ['create in the owner\'s home', (fs) => fs.writeFile('/home/has/x', 'x'), 'EACCES', 'ok'],
    ['remove /etc/hostname', (fs) => fs.rm('/etc/hostname'), 'EACCES', 'ok'],
    ['remove the home folder', (fs) => fs.rm('/home/guest', { recursive: true }), 'EACCES', 'ok'],
    ['chmod a system file', (fs) => fs.chmod('/etc/motd', 0o777), 'EPERM', 'ok'],
    ['chown your own file to has', (fs) => fs.chown('/home/guest/README.md', 'has'), 'EPERM', 'ok'],
    ['write /proc/uptime', (fs) => fs.writeFile('/proc/uptime', '0'), 'EACCES', 'EACCES'],
    ['read the kernel', (fs) => fs.readFile('/boot/vmlinuz-6.6.0-vesen'), 'EACCES', 'ok'],
    ['write /dev/null', (fs) => fs.writeFile('/dev/null', 'gone'), 'ok', 'ok'],
  ];

  it.each(matrix)('%s', (_name, run, guest, root) => {
    expect(code(() => run(seeded())), 'as guest').toBe(guest);
    expect(code(() => run(seeded({ credentials: ROOT }))), 'as root').toBe(root);
  });

  it('needs x to pass through a folder and r to list it', () => {
    const fs = seeded();
    fs.mkdir('/home/guest/locked');
    fs.writeFile('/home/guest/locked/inside', 'secret');
    fs.chmod('/home/guest/locked', 0o600);
    expect(code(() => fs.readFile('/home/guest/locked/inside'))).toBe('EACCES');
    expect(fs.readdir('/home/guest/locked')).toEqual(['inside']);
    fs.chmod('/home/guest/locked', 0o300);
    expect(code(() => fs.readdir('/home/guest/locked'))).toBe('EACCES');
    expect(fs.readFile('/home/guest/locked/inside')).toBe('secret');
    expect(fs.access('/home/guest/locked', 'r')).toBe(false);
    expect(fs.access('/home/guest/locked', 'w')).toBe(true);
  });

  it('keeps the sticky /tmp: no one removes another user\'s file', () => {
    const asRoot = seeded({ credentials: ROOT });
    asRoot.writeFile('/tmp/roots', 'x');
    expect(asRoot.stat('/tmp').mode).toBe(0o1777);
    const guest = new Vfs({ seed: () => asRoot.root, now: () => NOW });
    expect(code(() => guest.rm('/tmp/roots'))).toBe('EPERM');
    guest.writeFile('/tmp/mine', 'y');
    expect(code(() => guest.rm('/tmp/mine'))).toBe('ok');
  });

  it('makes new files 644 and folders 755, owned by guest', () => {
    const fs = seeded();
    fs.writeFile('/home/guest/n.txt', 'x');
    fs.mkdir('/home/guest/d');
    expect(fs.stat('/home/guest/n.txt')).toMatchObject({ mode: 0o644, owner: 'guest', mtime: NOW, size: 1 });
    expect(fs.stat('/home/guest/d')).toMatchObject({ mode: 0o755, owner: 'guest', type: 'directory' });
  });

  it('words each code as Linux does', () => {
    expect(strerror('EACCES')).toBe('Permission denied');
    expect(strerror('ELOOP')).toBe('Too many levels of symbolic links');
    expect(strerror('ENOSPC')).toBe('No space left on device');
  });
});

describe('symbolic links', () => {
  it('follows links, relative and absolute, and lstat does not', () => {
    const fs = seeded();
    fs.symlink('documents/linux.txt', '/home/guest/notes');
    fs.symlink('/etc', '/home/guest/etc');
    expect(fs.readFile('/home/guest/notes')).toContain('Arch Linux');
    expect(fs.stat('/home/guest/notes').type).toBe('file');
    expect(fs.lstat('/home/guest/notes')).toMatchObject({ type: 'symlink', target: 'documents/linux.txt' });
    expect(fs.readlink('/home/guest/notes')).toBe('documents/linux.txt');
    expect(fs.readdir('/home/guest/etc')).toContain('hostname');
    expect(code(() => fs.readlink('/home/guest/README.md'))).toBe('EINVAL');
  });

  it('fails with ELOOP after 40 links', () => {
    const fs = seeded();
    fs.symlink('b', '/home/guest/a');
    fs.symlink('a', '/home/guest/b');
    expect(code(() => fs.readFile('/home/guest/a'))).toBe('ELOOP');
    expect(code(() => fs.realpath('/home/guest/a'))).toBe('ELOOP');

    // A chain of exactly 40 links resolves; 41 do not.
    const chain = seeded();
    chain.writeFile('/tmp/end', 'reached');
    chain.symlink('/tmp/end', '/tmp/l0');
    for (let i = 1; i < 41; i += 1) chain.symlink(`l${i - 1}`, `/tmp/l${i}`);
    expect(chain.readFile('/tmp/l39')).toBe('reached');
    expect(code(() => chain.readFile('/tmp/l40'))).toBe('ELOOP');
  });

  it('writes through a link, and removes the link rather than its target', () => {
    const fs = seeded();
    fs.symlink('target.txt', '/home/guest/link');
    fs.writeFile('/home/guest/link', 'via link');
    expect(fs.readFile('/home/guest/target.txt')).toBe('via link');
    fs.rm('/home/guest/link');
    expect(fs.exists('/home/guest/target.txt')).toBe(true);
    expect(fs.exists('/home/guest/link')).toBe(false);
  });
});

describe('rename and copy', () => {
  it('renames files and folders, and refuses to move a folder into itself', () => {
    const fs = seeded();
    fs.rename('/home/guest/README.md', '/home/guest/documents/readme.txt');
    expect(fs.exists('/home/guest/README.md')).toBe(false);
    expect(fs.readFile('/home/guest/documents/readme.txt')).toContain('The Terminal');
    expect(code(() => fs.rename('/home/guest/projects', '/home/guest/projects/vesen/inside'))).toBe('EINVAL');
    fs.rename('/home/guest/projects', '/home/guest/work');
    expect(fs.readdir('/home/guest/work')).toEqual(['vesen', 'portfolio', 'learning']);
  });

  it('will not put a file over a folder, or a folder over a non-empty one', () => {
    const fs = seeded();
    expect(code(() => fs.rename('/home/guest/README.md', '/home/guest/documents'))).toBe('EISDIR');
    expect(code(() => fs.rename('/home/guest/music', '/home/guest/documents'))).toBe('ENOTEMPTY');
    expect(code(() => fs.rename('/home/guest/music', '/home/guest/README.md'))).toBe('ENOTDIR');
    expect(code(() => fs.rename('/etc/motd', '/home/guest/motd'))).toBe('EACCES');
  });

  it('copies files and, with recursive, folders, as the visitor', () => {
    const fs = seeded();
    fs.copy('/etc/hostname', '/home/guest/hostname');
    expect(fs.stat('/home/guest/hostname')).toMatchObject({ owner: 'guest', mode: 0o644 });
    expect(fs.readFile('/home/guest/hostname')).toBe('vesen\n');
    expect(code(() => fs.copy('/home/guest/projects', '/home/guest/p2'))).toBe('EISDIR');
    fs.copy('/home/guest/projects', '/home/guest/p2', { recursive: true });
    expect(fs.readFile('/home/guest/p2/vesen/info.txt')).toContain('Vesen Terminal');
    expect(code(() => fs.copy('/home/guest/projects', '/home/guest/projects/again', { recursive: true }))).toBe('EINVAL');
    expect(code(() => fs.copy('/etc/shadow', '/home/guest/shadow'))).toBe('EACCES');
  });
});

describe('rm, rmdir and mkdir', () => {
  it('refuses . and .. and / in GNU rm words (F020)', () => {
    expect(rmRefusal('.', '/home/guest', true)).toEqual(["rm: refusing to remove '.' or '..' directory: skipping '.'"]);
    expect(rmRefusal('docs/..', '/home/guest', true)).toEqual(["rm: refusing to remove '.' or '..' directory: skipping 'docs/..'"]);
    expect(rmRefusal('./', '/home/guest', false)).toEqual(["rm: refusing to remove '.' or '..' directory: skipping './'"]);
    expect(rmRefusal('/', '/', true)).toEqual([
      "rm: it is dangerous to operate recursively on '/'",
      'rm: use --no-preserve-root to override this failsafe',
    ]);
    expect(rmRefusal('/', '/', false)).toEqual(["rm: cannot remove '/': Is a directory"]);
    expect(rmRefusal('notes', '/home/guest/notes', true)).toBeNull();
    const fs = seeded({ credentials: ROOT });
    expect(code(() => fs.rm('/', { recursive: true }))).toBe('EPERM');
  });

  it('removes files, folders with recursive, and is quiet about missing files with force', () => {
    const fs = seeded();
    expect(code(() => fs.rm('/home/guest/projects'))).toBe('EISDIR');
    fs.rm('/home/guest/projects', { recursive: true });
    expect(fs.exists('/home/guest/projects')).toBe(false);
    expect(code(() => fs.rm('/home/guest/nope'))).toBe('ENOENT');
    expect(code(() => fs.rm('/home/guest/nope', { force: true }))).toBe('ok');
  });

  it('leaves the cwd dangling when an ancestor goes', () => {
    const fs = seeded();
    fs.rm('/home/guest/documents', { recursive: true });
    expect(fs.exists('/home/guest/documents')).toBe(false);
  });

  it('makes parents with -p and refuses an existing name without it', () => {
    const fs = seeded();
    expect(code(() => fs.mkdir('/home/guest/a/b'))).toBe('ENOENT');
    fs.mkdir('/home/guest/a/b', { parents: true });
    fs.mkdir('/home/guest/a/b', { parents: true });
    expect(fs.stat('/home/guest/a/b').type).toBe('directory');
    expect(code(() => fs.mkdir('/home/guest/a'))).toBe('EEXIST');
    expect(code(() => fs.mkdir('/home/guest/README.md/x', { parents: true }))).toBe('ENOTDIR');
    expect(code(() => fs.rmdir('/home/guest/a'))).toBe('ENOTEMPTY');
    fs.rmdir('/home/guest/a/b');
    expect(code(() => fs.rmdir('/home/guest/README.md'))).toBe('ENOTDIR');
  });
});

describe('glob, walk and changes', () => {
  it('globs against the tree, hiding dotfiles unless asked', () => {
    const fs = seeded();
    expect(fs.glob('*.md', '/home/guest')).toEqual(['README.md']);
    expect(fs.glob('/home/guest/documents/*', '/')).toEqual(['/home/guest/documents/linux.txt']);
    expect(fs.glob('.b*', '/home/guest')).toEqual(['.bash_history', '.bashrc']);
    expect(fs.glob('/root/*', '/')).toEqual([]);
  });

  it('walks a folder depth first', () => {
    const paths = [...seeded().walk('/home/guest/projects')].map(([path]) => path);
    expect(paths).toEqual([
      '/home/guest/projects',
      '/home/guest/projects/vesen',
      '/home/guest/projects/vesen/info.txt',
      '/home/guest/projects/portfolio',
      '/home/guest/projects/portfolio/index.html',
      '/home/guest/projects/learning',
      '/home/guest/projects/learning/javascript-basics.js',
    ]);
  });

  it('tells listeners what changed', () => {
    const fs = seeded();
    const seen: string[][] = [];
    const stop = fs.onChange((paths) => seen.push([...paths]));
    fs.writeFile('/home/guest/a', 'x');
    fs.rename('/home/guest/a', '/home/guest/b');
    stop();
    fs.writeFile('/home/guest/c', 'x');
    expect(seen).toEqual([['/home/guest/a'], ['/home/guest/a', '/home/guest/b']]);
  });

  it('opens a file for a redirection, truncating, appending or refusing with noclobber', () => {
    const fs = seeded();
    const out = fs.openWrite('/home/guest/log', { append: false, noclobber: false });
    out.write('one\n');
    out.write('two\n');
    out.close();
    expect(fs.readFile('/home/guest/log')).toBe('one\ntwo\n');
    fs.openWrite('/home/guest/log', { append: true, noclobber: false }).write('three\n');
    expect(fs.readFile('/home/guest/log')).toBe('one\ntwo\nthree\n');
    expect(code(() => fs.openWrite('/home/guest/log', { append: false, noclobber: true }))).toBe('EEXIST');
    fs.openWrite('/home/guest/log', { append: false, noclobber: false });
    expect(fs.readFile('/home/guest/log')).toBe('');
  });

  it('restores the seed on reset', () => {
    const fs = seeded();
    fs.rm('/home/guest/README.md');
    fs.writeFile('/home/guest/new', 'x');
    fs.restore();
    expect(fs.exists('/home/guest/README.md')).toBe(true);
    expect(fs.exists('/home/guest/new')).toBe(false);
  });

  it('adds what the seed has gained to the folders named, and nothing else, when reseeded', () => {
    const commands = [{ name: 'ls', summary: 'list directory contents' }];
    const fs = new Vfs({ seed: () => seedTree({ version: '9.9.9', commands }), now: () => NOW });
    fs.writeFile('/home/guest/mine', 'kept');
    const stub = fs.stat('/usr/bin/ls');
    const changes: (readonly string[])[] = [];
    fs.onChange((paths) => changes.push(paths));
    // Commands registered after the session began: the catalogue arriving.
    commands.push({ name: 'rev', summary: 'reverse the characters of each line' });
    fs.reseed(['/usr/bin', '/usr/share/man/man1']);
    expect(fs.readdir('/usr/bin')).toEqual(['ls', 'rev']);
    expect(fs.readdir('/usr/share/man/man1')).toEqual(['ls.1', 'rev.1']);
    expect(fs.stat('/usr/bin/rev')).toMatchObject({ owner: 'root', mode: 0o755 });
    expect(fs.builtinAt('/bin/rev')).toBe('rev');
    expect(fs.stat('/usr/bin/ls')).toEqual(stub);
    expect(fs.readFile('/home/guest/mine')).toBe('kept');
    expect(changes).toEqual([['/usr/bin/rev', '/usr/share/man/man1/rev.1']]);
    // Nothing new: nothing changes.
    fs.reseed(['/usr/bin', '/nowhere']);
    expect(changes).toHaveLength(1);
  });
});

describe('the quota', () => {
  it('fails writes past 512 KB with ENOSPC, and frees space when files go', () => {
    const fs = seeded();
    expect(fs.usage().quota).toBe(DEFAULT_QUOTA);
    const seedBytes = fs.usage().used;
    expect(seedBytes).toBeGreaterThan(0);
    const chunk = 'x'.repeat(64 * 1024);
    const out = fs.openWrite('/home/guest/big', { append: false, noclobber: false });
    // A new file costs its path and a fixed overhead, as well as its content.
    const created = '/home/guest/big'.length + NODE_OVERHEAD;
    expect(fs.usage().used).toBe(seedBytes + created);
    let written = 0;
    expect(
      code(() => {
        for (;;) {
          out.write(chunk);
          written += chunk.length;
        }
      }),
    ).toBe('ENOSPC');
    expect(fs.usage().used).toBe(seedBytes + created + written);
    expect(fs.usage().used).toBeLessThanOrEqual(DEFAULT_QUOTA);
    expect(code(() => fs.copy('/home/guest/big', '/home/guest/big2'))).toBe('ENOSPC');
    fs.rm('/home/guest/big');
    expect(fs.usage().used).toBe(seedBytes);
    expect(code(() => fs.writeFile('/home/guest/small', 'ok'))).toBe('ok');
  });

  it('counts names and paths too, and refuses names and paths longer than Linux allows', () => {
    const fs = seeded({ quota: 64 * 1024 });
    expect(code(() => fs.writeFile(`/home/guest/${'n'.repeat(256)}`, ''))).toBe('ENAMETOOLONG');
    expect(code(() => fs.writeFile(`/home/guest/${'n'.repeat(255)}`, ''))).toBe('ok');
    // A deep chain of folders costs its paths: the quota stops it long before PATH_MAX would.
    expect(code(() => fs.mkdir(`/home/guest/${'d/'.repeat(2100)}`, { parents: true }))).toBe('ENOSPC');
    const roomy = seeded({ quota: 64 * 1024 * 1024 });
    expect(code(() => roomy.mkdir(`/home/guest/${'d/'.repeat(2100)}`, { parents: true }))).toBe('ENAMETOOLONG');
    fs.rm('/home/guest/d', { recursive: true });
    // Empty folders are not free: enough of them fill the quota.
    let made = 0;
    const result = code(() => {
      for (;;) fs.mkdir(`/home/guest/folder-${made++}`);
    });
    expect(result).toBe('ENOSPC');
    expect(made).toBeLessThan(1000);
    expect(fs.usage().used).toBeLessThanOrEqual(64 * 1024);
  });

  it('counts bytes, not characters', () => {
    const fs = seeded({ quota: 1024 * 1024 });
    fs.writeFile('/tmp/u', '🙂é');
    expect(fs.stat('/tmp/u').size).toBe(6);
  });
});

describe('devices and generated files', () => {
  it('reads /dev/null as empty, and /dev/urandom as printable noise', () => {
    const fs = seeded({ context: () => ({ now: NOW, bootTime: NOW, sys: null, random: () => 0.5 }) });
    expect(fs.readFile('/dev/null')).toBe('');
    expect(fs.readFile('/dev/urandom')).toMatch(/^[!-~]{64}$/);
    expect(fs.stat('/dev/tty')).toMatchObject({ type: 'device', group: 'tty' });
  });

  it('makes /proc on every read', () => {
    let now = NOW + 90_000;
    const fs = seeded({ context: () => ({ now, bootTime: NOW, sys: null, random: () => 0 }) });
    expect(fs.readFile('/proc/uptime')).toMatch(/^90\.00 /);
    now += 1000;
    expect(fs.readFile('/proc/uptime')).toMatch(/^91\.00 /);
    expect(fs.stat('/proc/uptime').size).toBe(0);
    // With no process table there is no process to show, and no self.
    expect(fs.readdir('/proc')).toEqual(['cpuinfo', 'meminfo', 'version', 'uptime', 'loadavg', 'mounts']);
  });

  it("makes a folder in /proc for each process in the table, as it is at each lookup, and self for the one reading", () => {
    const init = { pid: 1, ppid: 0, uid: 0, name: 'init', argv: ['/sbin/init'], startedAt: NOW };
    const shell = { pid: 4242, ppid: 1, uid: 1000, name: 'vesh', argv: ['-vesh'], startedAt: NOW };
    const cat = { pid: 4243, ppid: 4242, uid: 1000, name: 'cat', argv: ['cat', '/proc/self/status'], startedAt: NOW + 60_000 };
    let processes = [init, shell, cat];
    let self = 4243;
    const fs = seeded({ context: () => ({ now: NOW + 90_000, bootTime: NOW, sys: null, random: () => 0, processes, self }) });
    expect(fs.readdir('/proc')).toEqual(['1', '4242', '4243', 'cpuinfo', 'meminfo', 'version', 'uptime', 'loadavg', 'mounts', 'self']);
    expect(fs.readlink('/proc/self')).toBe('4243');
    expect(fs.readFile('/proc/self/status')).toMatch(/^Name:\tcat\nState:\tR \(running\)\nPid:\t4243\nPPid:\t4242\n/);
    expect(fs.readFile('/proc/4242/status')).toContain('State:\tS (sleeping)');
    expect(fs.readFile('/proc/4243/cmdline')).toBe('cat\0/proc/self/status\0');
    expect(fs.readFile('/proc/1/comm')).toBe('init\n');
    expect(fs.readlink('/proc/4243/exe')).toBe('/usr/bin/cat');
    // Owned as the process is, started when it started, and read-only to everyone.
    expect(fs.stat('/proc/1')).toMatchObject({ type: 'directory', owner: 'root', mode: 0o555, mtime: NOW });
    expect(fs.stat('/proc/4243')).toMatchObject({ owner: 'guest', group: 'guest', mtime: NOW + 60_000 });
    expect(fs.stat('/proc').nlink).toBe(5);
    expect(code(() => fs.writeFile('/proc/4243/status', 'x'))).toBe('EACCES');
    expect(code(() => fs.mkdir('/proc/9'))).toBe('EACCES');
    expect([...fs.walk('/proc/4242')].map(([path]) => path)).toEqual(['/proc/4242', '/proc/4242/status', '/proc/4242/comm', '/proc/4242/cmdline', '/proc/4242/exe']);
    // When the command has ended, its folder is gone; /proc/self follows whoever reads next.
    processes = [init, shell];
    self = 4242;
    expect(fs.exists('/proc/4243')).toBe(false);
    expect(code(() => fs.readFile('/proc/4243/status'))).toBe('ENOENT');
    expect(fs.readFile('/proc/self/comm')).toBe('vesh\n');
  });
});
