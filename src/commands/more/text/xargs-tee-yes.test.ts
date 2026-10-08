// xargs, tee and yes against their Linux behaviour: batching, quoting, -I, -0, -d, -r and -t, and
// xargs' exit statuses; tee's files and -a; yes ending with its reader.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../../tests/harness';
import { shellWord, splitItems } from './xargs.run';

const pipe = { tty: false } as const;
const out = async (line: string): Promise<string> => (await runLine(line, pipe)).stdoutPlain;

describe('xargs', () => {
  it.each([
    ['echo a b c | xargs', 'a b c'],
    ['echo a b c d e | xargs -n2', 'a b\nc d\ne'],
    ['seq 6 | xargs -n 2', '1 2\n3 4\n5 6'],
    ['ls | xargs -n1 echo', 'bin\nconfig\ndesktop\ndocuments\ndownloads\nhistory.txt\nmusic\npictures\nprojects\npublic\nREADME.md\nscripts\nsrc\ntemplates\nvideos'],
    ["printf 'a\\nb\\n' | xargs -I {} echo 'item {}'", 'item a\nitem b'],
    ["printf 'a\\nb\\n' | xargs -I X echo X-X", 'a-a\nb-b'],
    ["printf '  lead\\n' | xargs -I {} echo '[{}]'", '[lead]'],
    ["printf \"one 'two three' four\\n\" | xargs -n1", 'one\ntwo three\nfour'],
    ["printf 'a\\\\ b c\\n' | xargs -n1", 'a b\nc'],
    ["printf 'a\\0b c\\0' | xargs -0 -n1 echo", 'a\nb c'],
    ["printf 'x,y,z' | xargs -d , -n1", 'x\ny\nz'],
    ["printf '1\\n2\\n3\\n' | xargs -L 2", '1 2\n3'],
    ['echo | xargs echo something', 'something'],
    ['echo | xargs -r echo nothing', ''],
    ["echo '$HOME *' | xargs echo", '$HOME *'],
    ['echo a=b | xargs', 'a=b'],
    // wc's width comes from the files' total size in bytes, four digits here.
    ['echo README.md .profile | xargs wc -l', '  21 README.md\n   6 .profile\n  27 total'],
  ])('%s', async (line, expected) => {
    expect(await out(line)).toBe(expected);
  });

  it('prints each command first with -t', async () => {
    expect(await runLine('echo a b | xargs -t echo', pipe)).toMatchObject({ status: 0, stdoutPlain: 'a b', stderrPlain: 'echo a b' });
  });

  it('exits as GNU xargs does', async () => {
    expect((await runLine('echo a | xargs false', pipe)).status).toBe(123);
    expect(await runLine('echo a | xargs nosuchcmd', pipe)).toMatchObject({ status: 127, stderrPlain: 'xargs: nosuchcmd: No such file or directory' });
    // A file that is there but cannot be run is 126, said once, as timeout and nohup say it.
    expect(await runLine('echo a | xargs /etc/hosts', pipe)).toMatchObject({ status: 126, stderrPlain: 'xargs: /etc/hosts: Permission denied' });
    expect(await runLine("echo \"it's\" | xargs echo", pipe)).toMatchObject({
      status: 1,
      stderrPlain: 'xargs: unmatched single quote; by default quotes are special to xargs unless you use the -0 option',
    });
    expect(await runLine('xargs -n 0 echo', pipe)).toMatchObject({ status: 1, stderrPlain: 'xargs: value 0 for -n option should be >= 1' });
  });

  it('reads items from a file with -a', async () => {
    const s = await session(pipe);
    await s.run("printf 'one\\ntwo\\n' > list.txt");
    expect((await s.run('xargs -a list.txt echo got')).stdoutPlain).toBe('got one two');
    expect(await s.run('xargs -a nope echo')).toMatchObject({ status: 1, stderrPlain: "xargs: Cannot open input file 'nope': No such file or directory" });
    s.stop();
  });

  it('splits and quotes words so each reaches the command as read', () => {
    expect(splitItems(`a "b c" 'd e' f\\ g`)).toEqual(['a', 'b c', 'd e', 'f g']);
    expect(splitItems('  ')).toEqual([]);
    expect(shellWord('plain.txt')).toBe('plain.txt');
    expect(shellWord('a b')).toBe("'a b'");
    expect(shellWord("it's")).toBe("'it'\\''s'");
    expect(shellWord('x=1')).toBe("'x=1'");
    expect(shellWord('~')).toBe("'~'");
  });

  it('ends a pipe at once', async () => {
    expect(await runLine('yes | xargs -n1 echo | head -n 2', pipe)).toMatchObject({ status: 0, stdoutPlain: 'y\ny' });
  });
});

describe('tee', () => {
  it('copies standard input to each FILE and to standard output', async () => {
    const s = await session(pipe);
    expect(await s.run('echo one two | tee out1.txt out2.txt')).toMatchObject({ status: 0, stdoutPlain: 'one two' });
    expect(s.app.vfs.readFile('/home/guest/out1.txt')).toBe('one two\n');
    expect(s.app.vfs.readFile('/home/guest/out2.txt')).toBe('one two\n');
    await s.run('echo more | tee -a out1.txt > /dev/null');
    expect(s.app.vfs.readFile('/home/guest/out1.txt')).toBe('one two\nmore\n');
    await s.run('echo fresh | tee out1.txt > /dev/null');
    expect(s.app.vfs.readFile('/home/guest/out1.txt')).toBe('fresh\n');
    expect((await s.run('seq 3 | tee -a log.txt | wc -l')).stdoutPlain).toBe('3');
    s.stop();
  });

  it('writes the FILEs it can, says which it cannot, and exits 1', async () => {
    const s = await session(pipe);
    expect(await s.run('echo hi | tee /etc/x ok.txt')).toMatchObject({ status: 1, stdoutPlain: 'hi', stderrPlain: 'tee: /etc/x: Permission denied' });
    expect(s.app.vfs.readFile('/home/guest/ok.txt')).toBe('hi\n');
    s.stop();
  });

  it('creates its FILEs even when nothing arrives', async () => {
    const s = await session(pipe);
    await s.run('printf "" | tee empty.txt');
    expect(s.app.vfs.readFile('/home/guest/empty.txt')).toBe('');
    s.stop();
  });
});

describe('yes', () => {
  it.each([
    ['yes | head -n 3', 'y\ny\ny'],
    ['yes no | head -n 2', 'no\nno'],
    ['yes a b | head -n 2', 'a b\na b'],
    ['yes -- -n | head -n 1', '-n'],
    ['yes | head -c 5', 'y\ny\ny'],
  ])('%s', async (line, expected) => {
    expect(await runLine(line, pipe)).toMatchObject({ status: 0, stdoutPlain: expected });
  });
});
