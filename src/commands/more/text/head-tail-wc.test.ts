// head, tail and wc against GNU coreutils' behaviour: counts, suffixes, negative and +N counts,
// headers, standard input, the error wording and the exit status.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../../tests/harness';

const pipe = { tty: false } as const;
const out = async (line: string): Promise<string> => (await runLine(line, pipe)).stdoutPlain;

describe('head', () => {
  it.each([
    ['seq 20 | head', '1\n2\n3\n4\n5\n6\n7\n8\n9\n10'],
    ['seq 20 | head -n 3', '1\n2\n3'],
    ['seq 20 | head -3', '1\n2\n3'],
    ['seq 20 | head --lines=2', '1\n2'],
    ['seq 5 | head -n -3', '1\n2'],
    ['seq 5 | head -n -9', ''],
    ['seq 5 | head -n 0', ''],
    ['printf abcdef | head -c 3', 'abc'],
    ['printf abcdef | head -c -2', 'abcd'],
    ["printf 'héllo' | head -c 2", 'h'],
    ["printf 'a\\nb' | head -n 5", 'a\nb'],
    ['seq 3 | head -n 1 - .profile', '==> standard input <==\n1\n\n==> .profile <==\n# ~/.profile: executed by the command interpreter for login shells'],
    ['head -qn1 .bashrc .profile', '# ~/.bashrc: executed by bash(1) for non-login shells\n# ~/.profile: executed by the command interpreter for login shells'],
    ['echo x | head -v', '==> standard input <==\nx'],
  ])('%s', async (line, expected) => {
    expect(await out(line)).toBe(expected);
  });

  it('reads a multiplier suffix', async () => {
    expect((await out('yes | head -c 1K')).length).toBe(1023);
    expect((await out('yes | head -n 1kB | wc -l')).trim()).toBe('1000');
  });

  it('says what it cannot read in GNU words, carries on, and exits 1', async () => {
    const result = await runLine('head -n1 nope documents .profile', pipe);
    expect(result.status).toBe(1);
    expect(result.stderrPlain).toBe("head: cannot open 'nope' for reading: No such file or directory\nhead: error reading 'documents': Is a directory");
    // A header only for what opens: a folder opens, then cannot be read.
    expect(result.stdoutPlain).toBe('==> documents <==\n\n==> .profile <==\n# ~/.profile: executed by the command interpreter for login shells');
    expect(await runLine('head -n x .profile', pipe)).toMatchObject({ status: 1, stderrPlain: "head: invalid number of lines: 'x'" });
    expect(await runLine('head -c 2Q .profile', pipe)).toMatchObject({ status: 1, stderrPlain: "head: invalid number of bytes: '2Q'" });
  });

  it('ends a pipe at once', async () => {
    expect(await runLine('yes | head -n 2', pipe)).toMatchObject({ status: 0, stdoutPlain: 'y\ny' });
  });
});

describe('tail', () => {
  it.each([
    ['seq 20 | tail', '11\n12\n13\n14\n15\n16\n17\n18\n19\n20'],
    ['seq 20 | tail -n 2', '19\n20'],
    ['seq 20 | tail -3', '18\n19\n20'],
    ['seq 5 | tail -n +4', '4\n5'],
    ['seq 5 | tail -n +1', '1\n2\n3\n4\n5'],
    ['seq 5 | tail -n 0', ''],
    ['printf abcdef | tail -c 2', 'ef'],
    ['printf abcdef | tail -c +3', 'cdef'],
    ["printf 'a\\nb' | tail -n 1", 'b'],
    ['tail -n1 .bashrc .profile', '==> .bashrc <==\nexport PS1="\\u@\\h:\\w$ "\n==> .profile <==\nexport EDITOR=vim'],
  ])('%s', async (line, expected) => {
    expect(await out(line)).toBe(expected);
  });

  it('prints the end once for -f and says following is not supported', async () => {
    const result = await runLine('tail -f -n1 .profile', pipe);
    expect(result).toMatchObject({ status: 0, stdoutPlain: 'export EDITOR=vim' });
    expect(result.stderrPlain).toMatch(/^tail: following is not supported in vesen/);
    expect((await runLine('echo x | tail -f', pipe)).stderrPlain).toBe('');
  });

  it('words its errors as GNU does', async () => {
    expect(await runLine('tail nope', pipe)).toMatchObject({ status: 1, stderrPlain: "tail: cannot open 'nope' for reading: No such file or directory" });
    expect(await runLine('tail -n1 nope .profile', pipe)).toMatchObject({ status: 1, stdoutPlain: '==> .profile <==\nexport EDITOR=vim' });
    expect(await runLine('tail -n z .profile', pipe)).toMatchObject({ status: 1, stderrPlain: "tail: invalid number of lines: 'z'" });
  });
});

describe('wc', () => {
  it.each([
    ['echo hello world | wc', '      1       2      12'],
    ['echo a b | wc -w', '2'],
    ["printf 'x' | wc -c", '1'],
    ["printf 'héllo\\n' | wc -c", '7'],
    ["printf 'héllo\\n' | wc -m", '6'],
    ["printf 'a\\tb\\nlonger line\\n' | wc -L", '11'],
    ["printf 'one\\ntwo' | wc -l", '1'],
    ['wc -l .profile', '6 .profile'],
    ['wc .profile', '  6  33 206 .profile'],
    ['wc -l .profile .bashrc', '  6 .profile\n 11 .bashrc\n 17 total'],
    ['echo x | wc -l - .profile', '      1 -\n      6 .profile\n      7 total'],
    ['wc -l --total=only .profile .bashrc', '17'],
    ['wc -c --total=never .profile .bashrc', '206 .profile\n236 .bashrc'],
  ])('%s', async (line, expected) => {
    expect(await out(line)).toBe(expected);
  });

  it('counts a folder as nothing after saying it is one', async () => {
    const result = await runLine('wc documents', pipe);
    expect(result).toMatchObject({ status: 1, stderrPlain: 'wc: documents: Is a directory', stdoutPlain: '      0       0       0 documents' });
    expect(await runLine('wc nope', pipe)).toMatchObject({ status: 1, stderrPlain: 'wc: nope: No such file or directory', stdoutPlain: '' });
  });

  it('counts the pipeline from the plan', async () => {
    expect(await out('cat README.md | grep -i theme | wc -l')).toBe('1');
  });

  it('counts a file written in the session', async () => {
    const s = await session(pipe);
    await s.run("printf 'one two\\nthree\\n' > f.txt");
    expect((await s.run('wc f.txt')).stdoutPlain).toBe(' 2  3 14 f.txt');
    s.stop();
  });
});
