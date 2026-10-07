// sed against GNU sed's behaviour: substitution and its flags, addresses and ranges, the other
// commands, the hold space, jumps, in-place editing, error messages and exit statuses.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../../tests/harness';

const pipe = { tty: false } as const;

describe('sed', () => {
  it.each([
    ['echo hello | sed s/l/L/', 'heLlo'],
    ['echo hello | sed s/l/L/g', 'heLLo'],
    ['echo hello | sed s/l/L/2', 'helLo'],
    ['echo aaaa | sed s/a/b/2g', 'abbb'],
    ['echo Hello | sed s/hello/bye/I', 'bye'],
    ["echo 'hello world' | sed 's/o/[&]/g'", 'hell[o] w[o]rld'],
    ["echo 'a&b' | sed 's/&/\\&\\&/'", 'a&&b'],
    ["echo abc | sed 's/\\(b\\)\\(c\\)/\\2\\1/'", 'acb'],
    ["echo abc | sed -E 's/(b)(c)/\\2\\1/'", 'acb'],
    ["echo aaa | sed -r 's/a+/X/'", 'X'],
    ["echo hello | sed 's/.*/\\U&/'", 'HELLO'],
    ["echo 'hello world' | sed 's/\\w\\+/\\u&/g'", 'Hello World'],
    ["echo 'HELLO World' | sed 's/\\(.*\\) \\(.*\\)/\\L\\1\\E \\2/'", 'hello World'],
    ["echo abc | sed 's/b*/x/g'", 'xaxcx'],
    ["echo hello | sed 's/l*/-/g'", '-h-e-o-'],
    ["echo 'a b' | sed 's/ /\\n/'", 'a\nb'],
    ["echo /usr/bin | sed 's|/usr|/opt|'", '/opt/bin'],
    ["echo 'a|b' | sed 's|a\\|b|x|'", 'x'],
    ["echo one | sed -e 's/one/two/' -e 's/two/three/'", 'three'],
    ["echo hello | sed 'y/abcdefghij/ABCDEFGHIJ/'", 'HEllo'],
    ['seq 5 | sed -n 2p', '2'],
    ["seq 5 | sed -n '2,4p'", '2\n3\n4'],
    ["seq 5 | sed '2,4d'", '1\n5'],
    ["seq 5 | sed -n '$p'", '5'],
    ["seq 5 | sed '1~2d'", '2\n4'],
    ["seq 5 | sed -n '/3/,$p'", '3\n4\n5'],
    ["seq 5 | sed -n '2,+1p'", '2\n3'],
    ["seq 10 | sed -n '5,~4p'", '5\n6\n7\n8'],
    ["seq 5 | sed '2!d'", '2'],
    ["seq 5 | sed -n '4,2p'", '4'],
    ["seq 5 | sed -n '0,/1/p'", '1'],
    ["seq 5 | sed -n '1,/1/p'", '1\n2\n3\n4\n5'],
    ["seq 5 | sed -n '/2/,/4/{/3/!p}'", '2\n4'],
    ["printf 'a\\nb\\n' | sed =", '1\na\n2\nb'],
    ["printf 'a\\nb\\n' | sed '1a after'", 'a\nafter\nb'],
    ["printf 'a\\nb\\n' | sed '2i\\\nbefore'", 'a\nbefore\nb'],
    ["seq 3 | sed '2c changed'", '1\nchanged\n3'],
    ["seq 5 | sed '2,4c X'", '1\nX\n5'],
    ['seq 5 | sed 2q', '1\n2'],
    ["seq 5 | sed -n '3{p;q}'", '3'],
    ['seq 5 | sed 3Q', '1\n2'],
    ["seq 3 | sed -n '1!G;h;$p'", '3\n2\n1'],
    ["seq 4 | sed 'N;s/\\n/-/'", '1-2\n3-4'],
    ["seq 3 | sed 'N;s/\\n/-/'", '1-2\n3'],
    ["seq 4 | sed -n 'N;P'", '1\n3'],
    ["printf 'a\\nb\\nc\\n' | sed '$!N;$!D'", 'b\nc'],
    ["seq 4 | sed -n 'n;p'", '2\n4'],
    ["printf 'a b c\\n' | sed ':a;s/ /_/;ta'", 'a_b_c'],
    ["printf 'x\\ny\\n' | sed '/x/b skip;s/./Z/;:skip'", 'x\nZ'],
    ["printf 'ab\\ncd\\n' | sed 's/a/A/;T;s/$/!/'", 'Ab!\ncd'],
    ["printf 'a\\tb\\n' | sed -n l", 'a\\tb$'],
    ['echo x | sed z', ''],
    ["printf 'a' | sed p", 'a\na'],
    ["printf 'a\\nb' | sed 's/b/c/'", 'a\nc'],
    ["printf 'one\\n' | sed -n '/one/{s/one/1/p}'", '1'],
    ["printf '#n\\np\\n' > s.sed; echo hi | sed -f s.sed", 'hi'],
    ["echo hi | sed -s 'F'", '-\nhi'],
  ])('%s', async (line, expected) => {
    const result = await runLine(line, pipe);
    expect(result.stderrPlain).toBe('');
    expect(result.stdoutPlain).toBe(expected);
  });

  it('exits with the status q and Q give', async () => {
    expect(await runLine('seq 3 | sed q5', pipe)).toMatchObject({ status: 5, stdoutPlain: '1' });
    expect(await runLine('seq 3 | sed 2Q7', pipe)).toMatchObject({ status: 7, stdoutPlain: '1' });
  });

  it('edits files in place, with a backup when given a suffix', async () => {
    const s = await session(pipe);
    expect((await s.run("sed -i 's/dark/light/' config/app.conf")).status).toBe(0);
    expect(s.app.vfs.readFile('/home/guest/config/app.conf')).toContain('theme=light');
    await s.run("sed -i.bak -e '1d' config/app.conf");
    expect(s.app.vfs.readFile('/home/guest/config/app.conf').startsWith('theme=light')).toBe(true);
    expect(s.app.vfs.readFile('/home/guest/config/app.conf.bak').startsWith('# Application')).toBe(true);
    // Each file separately: $ is each one's last line.
    await s.run("printf 'a\\nb\\n' > one; printf 'c\\nd\\n' > two");
    await s.run("sed -i '$d' one two");
    expect(s.app.vfs.readFile('/home/guest/one')).toBe('a\n');
    expect(s.app.vfs.readFile('/home/guest/two')).toBe('c\n');
    expect(await s.run("sed -i 's/a/b/' documents")).toMatchObject({ status: 4, stderrPlain: "sed: couldn't edit documents: not a regular file" });
    expect(await s.run("sed -i 's/a/b/'")).toMatchObject({ status: 1, stderrPlain: 'sed: no input files' });
    s.stop();
  });

  it('writes with w and reads with r', async () => {
    const s = await session(pipe);
    await s.run("seq 4 | sed -n '/[24]/w even.txt'");
    expect(s.app.vfs.readFile('/home/guest/even.txt')).toBe('2\n4\n');
    expect((await s.run("echo first | sed 'r even.txt'")).stdoutPlain).toBe('first\n2\n4');
    s.stop();
  });

  it.each([
    ["sed 's/a/b'", "sed: -e expression #1, char 5: unterminated `s' command", 1],
    ['sed k', "sed: -e expression #1, char 1: unknown command: `k'", 1],
    ["sed 's/a/b/x'", "sed: -e expression #1, char 7: unknown option to `s'", 1],
    ["sed -n '/x/{p'", "sed: -e expression #1, char 0: unmatched `{'", 1],
    ["sed -n 'p}'", "sed: -e expression #1, char 2: unexpected `}'", 1],
    ["sed 'y/ab/c/'", "sed: -e expression #1, char 7: strings for `y' command are different lengths", 1],
    ["sed 's/a/\\1/'", "sed: -e expression #1, char 7: invalid reference \\1 on `s' command's RHS", 1],
    ["sed 'b nowhere'", "sed: can't find label for jump to `nowhere'", 1],
    ["sed -e p -e 'p q'", 'sed: -e expression #2, char 3: extra characters after command', 1],
    ['sed p nope', "sed: can't read nope: No such file or directory", 2],
  ] as const)('%s fails in GNU words', async (line, message, status) => {
    const result = await runLine(line, pipe);
    expect(result.stderrPlain).toBe(message);
    expect(result.status).toBe(status);
  });

  it('refuses a runaway pattern', async () => {
    const result = await runLine("echo aaaa | sed -E 's/(a+)+$/x/'", pipe);
    expect(result.status).toBe(1);
    expect(result.stderrPlain).toMatch(/^sed: -e expression #1, char \d+: a repeated group with a repetition inside it/);
  });

  it('ends a pipe at once', async () => {
    expect(await runLine('yes | sed s/y/n/ | head -n 2', pipe)).toMatchObject({ status: 0, stdoutPlain: 'n\nn' });
  });
});
