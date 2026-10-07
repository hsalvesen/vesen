// truncate and sync.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../../tests/harness';
import { parseSize } from './truncate.run';

describe('parseSize', () => {
  it('reads numbers with operators and units', () => {
    expect(parseSize('100')).toEqual({ op: '', n: 100 });
    expect(parseSize('1K')).toEqual({ op: '', n: 1024 });
    expect(parseSize('1KB')).toEqual({ op: '', n: 1000 });
    expect(parseSize('2KiB')).toEqual({ op: '', n: 2048 });
    expect(parseSize('+1M')).toEqual({ op: '+', n: 1024 ** 2 });
    expect(parseSize('-10')).toEqual({ op: '-', n: 10 });
    expect(parseSize('%4k')).toEqual({ op: '%', n: 4096 });
    expect(parseSize('<5')).toEqual({ op: '<', n: 5 });
    expect(parseSize('1G')).toEqual({ op: '', n: 1024 ** 3 });
    for (const bad of ['', 'x', '1Q', '-', '1.5K', '99999999999999E']) expect(parseSize(bad), bad).toBeNull();
  });
});

describe('truncate', () => {
  it('sets sizes, cutting the end off or adding NUL bytes, and creates files unless -c', async () => {
    const s = await session({ tty: false });
    await s.run("printf 'This is a file' > t.txt");
    expect(await s.run('truncate -s 5 t.txt')).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect(s.app.vfs.readFile('/home/guest/t.txt')).toBe('This ');
    await s.run('truncate -s +3 t.txt');
    expect(s.app.vfs.readFile('/home/guest/t.txt')).toBe('This \0\0\0');
    await s.run('truncate -s 1K new.bin');
    expect(s.app.vfs.stat('/home/guest/new.bin').size).toBe(1024);
    await s.run('truncate -s %1000 new.bin');
    expect(s.app.vfs.stat('/home/guest/new.bin').size).toBe(2000);
    await s.run('truncate -s /1500 new.bin');
    expect(s.app.vfs.stat('/home/guest/new.bin').size).toBe(1500);
    await s.run('truncate -s "<10" new.bin; truncate -s ">12" new.bin');
    expect(s.app.vfs.stat('/home/guest/new.bin').size).toBe(12);
    await s.run('truncate -s -100 new.bin');
    expect(s.app.vfs.stat('/home/guest/new.bin').size).toBe(0);
    expect(await s.run('truncate -c -s 5 ghost')).toMatchObject({ status: 0 });
    expect(s.app.vfs.exists('/home/guest/ghost')).toBe(false);
    s.stop();
  });

  it('cuts UTF-8 text on a whole character', async () => {
    const s = await session({ tty: false });
    await s.run("printf 'é€x' > u.txt");
    await s.run('truncate -s 4 u.txt');
    expect(s.app.vfs.readFile('/home/guest/u.txt')).toBe('é');
    s.stop();
  });

  it('takes the size of a --reference, or adjusts it', async () => {
    const s = await session({ tty: false });
    await s.run('truncate -r README.md copy; truncate -r README.md -s +1 copy2');
    expect(s.app.vfs.stat('/home/guest/copy').size).toBe(850);
    expect(s.app.vfs.stat('/home/guest/copy2').size).toBe(851);
    expect(await s.run('truncate -r README.md -s 5 copy')).toMatchObject({
      status: 1,
      stderrPlain: "truncate: you must specify a relative '--size' with '--reference'\nTry 'truncate --help' for more information.",
    });
    s.stop();
  });

  it('refuses to grow past the quota, without making the bytes first', async () => {
    const s = await session({ tty: false });
    expect(await s.run('truncate -s 1G big')).toMatchObject({ status: 1, stderrPlain: "truncate: failed to truncate 'big' at 1073741824 bytes: No space left on device" });
    expect(s.app.vfs.exists('/home/guest/big')).toBe(false);
    s.stop();
  });

  it.each([
    ['truncate x', "truncate: you must specify either '--size' or '--reference'\nTry 'truncate --help' for more information."],
    ['truncate -s 1', "truncate: missing file operand\nTry 'truncate --help' for more information."],
    ['truncate -s abc x', "truncate: Invalid number: 'abc'"],
    ['truncate -s /0 x', 'truncate: division by zero'],
    ['truncate -s 5 documents', "truncate: cannot open 'documents' for writing: Is a directory"],
    ['truncate -s 5 /etc/passwd', "truncate: cannot open '/etc/passwd' for writing: Permission denied"],
    ['truncate -s 5 /etc/new', "truncate: cannot open '/etc/new' for writing: Permission denied"],
    ['truncate -s 5 nope/x', "truncate: cannot open 'nope/x' for writing: No such file or directory"],
    ['truncate -r nope x', "truncate: cannot stat 'nope': No such file or directory"],
  ])('%s fails with status 1', async (line, stderr) => {
    expect(await runLine(line, { tty: false })).toMatchObject({ status: 1, stderrPlain: stderr });
  });
});

describe('sync', () => {
  it('has nothing to wait for, and checks its FILEs exist', async () => {
    expect(await runLine('sync', { tty: false })).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: '' });
    expect(await runLine('sync -f README.md', { tty: false })).toMatchObject({ status: 0, stderrPlain: '' });
    expect(await runLine('sync README.md nope', { tty: false })).toMatchObject({ status: 1, stderrPlain: "sync: error opening 'nope': No such file or directory" });
  });
});
