// basename, dirname, realpath and readlink: names worked out as text, and paths resolved through
// the VFS's links, as coreutils does.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../../tests/harness';
import { baseName } from './basename.run';
import { dirName } from './dirname.run';
import { relative } from './realpath.run';

describe('basename', () => {
  it.each([
    ['/usr/bin/ls', '', 'ls'],
    ['a/b/', '', 'b'],
    ['/', '', '/'],
    ['//', '', '/'],
    ['', '', ''],
    ['name', '', 'name'],
    ['linux.txt', '.txt', 'linux'],
    ['.txt', '.txt', '.txt'],
    ['a/b.tar.gz', '.gz', 'b.tar'],
  ])('basename %j %j is %j', (name, suffix, expected) => {
    expect(baseName(name, suffix)).toBe(expected);
  });

  it('takes NAME [SUFFIX], or many NAMEs with -a or -s', async () => {
    expect((await runLine('basename documents/linux.txt .txt', { tty: false })).stdoutPlain).toBe('linux');
    expect((await runLine('basename -a x/y z/', { tty: false })).stdoutPlain).toBe('y\nz');
    expect((await runLine('basename -s .sh scripts/backup.sh bin/deploy', { tty: false })).stdoutPlain).toBe('backup\ndeploy');
    expect((await runLine('basename -z a/b c', { tty: false })).stdoutPlain).toBe('b\0');
    expect(await runLine('basename', { tty: false })).toMatchObject({ status: 1, stderrPlain: "basename: missing operand\nTry 'basename --help' for more information." });
    expect(await runLine('basename a b c', { tty: false })).toMatchObject({ status: 1, stderrPlain: "basename: extra operand 'c'\nTry 'basename --help' for more information." });
  });
});

describe('dirname', () => {
  it.each([
    ['/usr/bin/ls', '/usr/bin'],
    ['documents/linux.txt', 'documents'],
    ['README.md', '.'],
    ['a/', '.'],
    ['a//b//', 'a'],
    ['/a', '/'],
    ['/', '/'],
    ['//', '/'],
    ['', '.'],
  ])('dirname %j is %j', (name, expected) => {
    expect(dirName(name)).toBe(expected);
  });

  it('takes several NAMEs', async () => {
    expect((await runLine('dirname /usr/bin/ls README.md', { tty: false })).stdoutPlain).toBe('/usr/bin\n.');
    expect((await runLine('dirname -z a/b', { tty: false })).stdoutPlain).toBe('a\0');
    expect(await runLine('dirname', { tty: false })).toMatchObject({ status: 1, stderrPlain: "dirname: missing operand\nTry 'dirname --help' for more information." });
  });
});

describe('realpath', () => {
  it('follows every link and resolves . and .. where they really lead', async () => {
    const s = await session({ tty: false });
    expect((await s.run('realpath . README.md /bin/ls')).stdoutPlain).toBe('/home/guest\n/home/guest/README.md\n/usr/bin/ls');
    expect((await s.run('realpath /home/user/../user/README.md')).stdoutPlain).toBe('/home/guest/README.md');
    await s.run('ln -s documents docs; cd /home/user');
    // The working directory went through a link: realpath gives where it really is.
    expect((await s.run('realpath . docs/linux.txt docs/..')).stdoutPlain).toBe('/home/guest\n/home/guest/documents/linux.txt\n/home/guest');
    s.stop();
  });

  it('needs all but the last part by default, all with -e, none with -m', async () => {
    const s = await session({ tty: false });
    expect(await s.run('realpath new.txt')).toMatchObject({ status: 0, stdoutPlain: '/home/guest/new.txt' });
    expect(await s.run('realpath nope/new.txt')).toMatchObject({ status: 1, stderrPlain: 'realpath: nope/new.txt: No such file or directory' });
    expect(await s.run('realpath -e new.txt')).toMatchObject({ status: 1, stderrPlain: 'realpath: new.txt: No such file or directory' });
    expect(await s.run('realpath -m nope/x/../y README.md/z')).toMatchObject({ status: 0, stdoutPlain: '/home/guest/nope/y\n/home/guest/README.md/z' });
    expect(await s.run('realpath README.md/x')).toMatchObject({ status: 1, stderrPlain: 'realpath: README.md/x: Not a directory' });
    expect(await s.run('realpath -q nope/x README.md')).toMatchObject({ status: 1, stdoutPlain: '/home/guest/README.md', stderrPlain: '' });
    s.stop();
  });

  it('tidies without following links with -s, and prints relative paths with --relative-to', async () => {
    expect((await runLine('realpath -s /home/user/../user/./README.md', { tty: false })).stdoutPlain).toBe('/home/user/README.md');
    expect((await runLine('realpath --relative-to=documents projects/vesen README.md', { tty: false })).stdoutPlain).toBe('../projects/vesen\n../README.md');
    expect(relative('/a/b', '/a/b')).toBe('.');
    expect(relative('/', '/etc')).toBe('etc');
    expect(relative('/home/guest/x', '/etc')).toBe('../../../etc');
  });

  it('stops at a loop of links', async () => {
    const s = await session({ tty: false });
    await s.run('ln -s two one; ln -s one two');
    expect(await s.run('realpath one')).toMatchObject({ status: 1, stderrPlain: 'realpath: one: Too many levels of symbolic links' });
    s.stop();
  });

  it('needs a FILE', async () => {
    expect(await runLine('realpath', { tty: false })).toMatchObject({ status: 1, stderrPlain: "realpath: missing operand\nTry 'realpath --help' for more information." });
  });
});

describe('readlink', () => {
  it('prints a link’s target as written, and nothing for what is not a link', async () => {
    expect(await runLine('readlink /bin /home/user', { tty: false })).toMatchObject({ status: 0, stdoutPlain: 'usr/bin\nguest' });
    expect(await runLine('readlink README.md nope', { tty: false })).toMatchObject({ status: 1, stdoutPlain: '', stderrPlain: '' });
    expect(await runLine('readlink -v README.md nope', { tty: false })).toMatchObject({
      status: 1,
      stderrPlain: 'readlink: README.md: Invalid argument\nreadlink: nope: No such file or directory',
    });
  });

  it('canonicalizes with -f, -e and -m', async () => {
    // .. after a link climbs from where the link leads: /bin is /usr/bin.
    expect((await runLine('readlink -f /home/user /bin/../etc', { tty: false })).stdoutPlain).toBe('/home/guest\n/usr/etc');
    expect(await runLine('readlink -f nope', { tty: false })).toMatchObject({ status: 0, stdoutPlain: '/home/guest/nope' });
    expect(await runLine('readlink -e nope', { tty: false })).toMatchObject({ status: 1, stdoutPlain: '' });
    expect(await runLine('readlink -m nope/x/../y', { tty: false })).toMatchObject({ status: 0, stdoutPlain: '/home/guest/nope/y' });
  });

  it('leaves out the newline with -n, unless there are several FILEs', async () => {
    expect((await runLine('readlink -n /bin', { tty: false })).stdoutPlain).toBe('usr/bin');
    expect(await runLine('readlink -nv /bin /home/user', { tty: false })).toMatchObject({
      stdoutPlain: 'usr/bin\nguest',
      stderrPlain: 'readlink: ignoring --no-newline with multiple arguments',
    });
    expect((await runLine('readlink -z /bin', { tty: false })).stdoutPlain).toBe('usr/bin\0');
  });
});
