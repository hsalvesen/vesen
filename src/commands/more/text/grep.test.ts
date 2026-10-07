// grep against GNU grep's behaviour: the three syntaxes, the selection and output options,
// context, recursion, names, colours, the exit status and the guard against runaway patterns.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../../tests/harness';

const pipe = { tty: false } as const;
const FRUIT = "printf 'apple\\nBanana\\ncherry\\n'";

describe('grep', () => {
  it.each([
    [`${FRUIT} | grep an`, 'Banana'],
    [`${FRUIT} | grep -i AN`, 'Banana'],
    [`${FRUIT} | grep -v an`, 'apple\ncherry'],
    [`${FRUIT} | grep -c an`, '1'],
    [`${FRUIT} | grep -n e`, '1:apple\n3:cherry'],
    [`${FRUIT} | grep -o an`, 'an\nan'],
    [`${FRUIT} | grep -e app -e che`, 'apple\ncherry'],
    [`${FRUIT} | grep -m 1 e`, 'apple'],
    [`${FRUIT} | grep -b err`, '13:cherry'],
    [`${FRUIT} | grep -c ''`, '3'],
    [`${FRUIT} | grep --label=fruit -H a`, 'fruit:apple\nfruit:Banana'],
    ["printf 'cat\\ncatalog\\nthe cat sat\\n' | grep -w cat", 'cat\nthe cat sat'],
    ["printf 'cat\\ncatalog\\n' | grep -x cat", 'cat'],
    ["printf 'aa\\na+\\n' | grep 'a+'", 'a+'],
    ["printf 'aa\\na+\\nb\\n' | grep 'a\\+'", 'aa\na+'],
    ["printf 'aa\\na+\\n' | grep -E 'a+$'", 'aa'],
    ["printf 'aa\\na+\\n' | grep -F 'a+'", 'a+'],
    ["printf 'abab\\nabba\\n' | grep '\\(ab\\)\\1'", 'abab'],
    ["printf 'abab\\nabba\\n' | grep -E '(b)\\1'", 'abba'],
    ["printf 'a\\naa\\naaa\\naaaa\\n' | grep -x 'a\\{2,3\\}'", 'aa\naaa'],
    ["printf 'cat\\ndog\\nemu\\n' | grep 'cat\\|dog'", 'cat\ndog'],
    ["printf 'cat\\ndog\\nemu\\n' | grep -E 'cat|emu'", 'cat\nemu'],
    ["printf 'a1\\nb\\n' | grep '[[:digit:]]'", 'a1'],
    ["printf 'The end\\nthe start\\n' | grep '\\<the\\>'", 'the start'],
    ["printf 'x.y\\nxzy\\n' | grep 'x\\.y'", 'x.y'],
    ['seq 10 | grep -C1 5', '4\n5\n6'],
    ['seq 10 | grep -A1 -e 2 -e 8', '2\n3\n--\n8\n9'],
    ['seq 10 | grep -B1 -n 5', '4-4\n5:5'],
    ['seq 20 | grep -2 -e 10', '8\n9\n10\n11\n12'],
    ['seq 10 | grep -m1 -A2 3', '3\n4\n5'],
    ['grep -n alias .bashrc .profile', '.bashrc:3:# User specific aliases and functions\n.bashrc:4:alias ll="ls -la"\n.bashrc:5:alias la="ls -A"\n.bashrc:6:alias l="ls -CF"'],
    ['grep -c alias .bashrc .profile', '.bashrc:4\n.profile:0'],
    ['grep -h EDITOR .bashrc .profile', 'export EDITOR=vim'],
    ['grep -l alias .bashrc .profile', '.bashrc'],
    ['grep -L alias .bashrc .profile', '.profile'],
    ['grep -H root /etc/passwd', '/etc/passwd:root:x:0:0:root:/root:/bin/vesh'],
    ['grep -r Hello projects', 'projects/learning/javascript-basics.js:console.log("Hello, World!");\nprojects/learning/javascript-basics.js:  return `Hello, ${name}!`;'],
    ['grep -rl Hello', 'projects/learning/javascript-basics.js\nsrc/main.c'],
    ['grep -rl --include=*.c Hello .', './src/main.c'],
    ['grep -rl --exclude=*.c --exclude-dir=learning Hello', ''],
    ['grep -r root /etc/passwd', 'root:x:0:0:root:/root:/bin/vesh'],
    ["printf 'a1\\nb22\\n' | grep -P '\\d{2}'", 'b22'],
    ["printf 'foobar\\nfoobaz\\n' | grep -oP 'foo(?=baz)'", 'foo'],
    ["printf 'aXbXc\\n' | grep -oP 'a.*?X'", 'aX'],
  ])('%s', async (line, expected) => {
    expect((await runLine(line, pipe)).stdoutPlain).toBe(expected);
  });

  it('exits 0 for a match, 1 for none and 2 for trouble, with GNU messages', async () => {
    expect((await runLine('grep -q alias .bashrc', pipe)).status).toBe(0);
    expect(await runLine('grep -q nothing-here .bashrc', pipe)).toMatchObject({ status: 1, stdoutPlain: '' });
    expect(await runLine('grep x nope', pipe)).toMatchObject({ status: 2, stderrPlain: 'grep: nope: No such file or directory' });
    expect(await runLine('grep -s x nope', pipe)).toMatchObject({ status: 2, stderrPlain: '' });
    expect(await runLine('grep x documents', pipe)).toMatchObject({ status: 2, stderrPlain: 'grep: documents: Is a directory' });
    // A match elsewhere does not hide the error, unless -q.
    expect((await runLine('grep alias nope .bashrc', pipe)).status).toBe(2);
    expect((await runLine('grep -q alias .bashrc nope', pipe)).status).toBe(0);
    expect(await runLine("grep '\\('", pipe)).toMatchObject({ status: 2, stderrPlain: 'grep: Unmatched ( or \\(' });
    expect(await runLine("grep '[:space:]' .bashrc", pipe)).toMatchObject({ status: 2, stderrPlain: 'grep: character class syntax is [[:space:]], not [:space:]' });
    expect(await runLine('grep', pipe)).toMatchObject({ status: 2, stderrPlain: "Usage: grep [OPTION]... PATTERNS [FILE]...\nTry 'grep --help' for more information." });
    expect(await runLine('grep --nope x', pipe)).toMatchObject({ status: 2 });
    expect(await runLine("grep -P '(?>a)' .profile", pipe)).toMatchObject({ status: 2 });
    expect(await runLine('grep -P -e a -e b .profile', pipe)).toMatchObject({ status: 2, stderrPlain: 'grep: the -P option only supports a single pattern' });
  });

  it('refuses (a+)+$ quickly, however long the line', async () => {
    const started = performance.now();
    const result = await runLine("printf 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa!\\n' | grep -E '(a+)+$'", pipe);
    expect(performance.now() - started).toBeLessThan(1000);
    expect(result).toMatchObject({ status: 2, stderrPlain: 'grep: a repeated group with a repetition inside it, as in (a+)+, can take forever to match' });
  });

  it('reports a line too long for the pattern and goes on', async () => {
    const s = await session(pipe);
    await s.run("printf '%20000s\\n' x > long.txt");
    const result = await s.run("grep 'a.*b' long.txt .bashrc");
    expect(result.status).toBe(2);
    expect(result.stderrPlain).toBe('grep: long.txt: line too long for this pattern (20000 characters, at most 14142); try a simpler pattern');
    // -F and plain patterns have no such limit.
    expect((await s.run('grep -c x long.txt')).stdoutPlain).toBe('1');
    s.stop();
  });

  it('colours matches, names and numbers as GNU does', async () => {
    const red = (text: string): string => `\u001b[01;31m\u001b[K${text}\u001b[m\u001b[K`;
    expect((await runLine('echo hello | grep --color=always ll', pipe)).stdoutPlain).toBe(`he${red('ll')}o`);
    expect((await runLine('echo hello | grep --color=never ll', pipe)).stdoutPlain).toBe('hello');
    expect((await runLine('echo hello | grep ll', pipe)).stdoutPlain).toBe('hello');
    const named = (await runLine('grep --color=always -Hn root /etc/passwd', pipe)).stdoutPlain;
    expect(named.startsWith('\u001b[35m\u001b[K/etc/passwd\u001b[m\u001b[K\u001b[36m\u001b[K:\u001b[m\u001b[K\u001b[32m\u001b[K1\u001b[m\u001b[K')).toBe(true);
    // On the terminal the escapes become styles, and the text is plain.
    const screen = await runLine('echo hello | grep ll');
    expect(screen.stdoutPlain).toBe('hello');
    const spans = screen.blocks.flatMap((block) => (block.type === 'lines' ? block.lines.flat() : []));
    expect(spans.find((span) => span.text === 'll')?.style).toMatchObject({ bold: true });
  });

  it('says a file with NUL bytes matches without printing it', async () => {
    expect(await runLine("grep '' /dev/zero", pipe)).toMatchObject({ status: 0, stdoutPlain: '', stderrPlain: 'grep: /dev/zero: binary file matches' });
  });

  it('searches the working folder with -r and no FILE, naming files from there', async () => {
    const s = await session(pipe);
    await s.run('cd projects');
    expect((await s.run('grep -r Hello')).stdoutPlain).toBe('learning/javascript-basics.js:console.log("Hello, World!");\nlearning/javascript-basics.js:  return `Hello, ${name}!`;');
    s.stop();
  });

  it('runs the pipeline from the plan', async () => {
    expect(await runLine('cat README.md | grep -i theme | wc -l', pipe)).toMatchObject({ status: 0, stdoutPlain: '1' });
  });

  it('ends a pipe at once', async () => {
    expect(await runLine('yes | grep y | head -n 2', pipe)).toMatchObject({ status: 0, stdoutPlain: 'y\ny' });
  });
});
