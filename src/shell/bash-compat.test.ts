// Bash compatibility found in review: each case here once differed from /bin/bash. They run
// through the app's shell with every real spec (tests/harness.ts), as a visitor would type them.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../tests/harness';

/** Runs lines in one session and gives the last result. */
async function lines(...typed: string[]) {
  const s = await session({ tty: false });
  try {
    let last = await s.run(typed[0] ?? '');
    for (const line of typed.slice(1)) last = await s.run(line);
    return { last, s };
  } finally {
    s.stop();
  }
}

describe('subshells: $( ), backticks and the stages of a pipeline', () => {
  it('keep a cd to themselves, and the prompt stays where it was', async () => {
    const s = await session({ tty: false });
    expect((await s.run('X=$(cd /etc && pwd); pwd; echo $X')).stdoutPlain).toBe('/home/guest\n/etc');
    expect((await s.run('X=`cd /tmp; pwd`; pwd; echo $X')).stdoutPlain).toBe('/home/guest\n/tmp');
    expect((await s.run('cd / | true; pwd')).stdoutPlain).toBe('/home/guest');
    expect(s.app.shell.cwd.get()).toBe('/home/guest');
    // A single command is not a subshell: cd there moves the shell.
    expect((await s.run('cd /tmp; pwd')).stdoutPlain).toBe('/tmp');
    s.stop();
  });

  it('keep variables, exports, aliases and options to themselves', async () => {
    const s = await session({ tty: false });
    expect((await s.run('X=5 | true; echo "[$X]"')).stdoutPlain).toBe('[]');
    expect(await s.run('export Q=1 | true; printenv Q')).toMatchObject({ status: 1, stdoutPlain: '' });
    expect((await s.run("echo $(alias q='echo q'); alias q")).status).toBe(1);
    await s.run('echo $(set -o noclobber)');
    expect((await s.run('echo a > f; echo b > f; cat f')).stdoutPlain).toBe('b');
    // Inside, they see what the shell has, and change their own copy.
    expect((await s.run('Y=1; echo $(Y=2; echo $Y) $Y')).stdoutPlain).toBe('2 1');
    s.stop();
  });

  it('leave the history and the files alone when they clear or reset', async () => {
    const s = await session({ tty: false });
    await s.run('echo one');
    await s.run('history -c | cat');
    expect((await s.run('history')).stdoutPlain).toContain('echo one');
    await s.run('touch keep');
    await s.run('reset | cat');
    expect(await s.run('ls keep')).toMatchObject({ status: 0, stdoutPlain: 'keep' });
    expect((await s.run('echo $(history -c); history')).stdoutPlain).toContain('touch keep');
    s.stop();
  });

  it('end with their own exit, leaving the shell running', async () => {
    const { last } = await lines('echo $(exit 3; echo no) $?', 'exit 4 | true; echo still $?');
    expect(last.stdoutPlain).toBe('still 0');
  });
});

describe('file descriptor numbers and the other bash redirections', () => {
  it('reads 1>, 1>>, 1>&2 and 0< as >, >>, >&2 and <', async () => {
    const { last } = await lines('echo hi 1>f; echo there 1>>f; cat f');
    expect(last.stdoutPlain).toBe('hi\nthere');
    expect(await runLine('echo err 1>&2', { tty: false })).toMatchObject({ stdoutPlain: '', stderrPlain: 'err' });
    expect((await runLine('cat 0< .profile', { tty: false })).stdoutPlain).toContain('~/.profile');
  });

  it('refuses a descriptor other than 0, 1 and 2, before running anything', async () => {
    expect(await runLine('echo x 3>f; echo after', { tty: false })).toMatchObject({
      status: 2,
      stdoutPlain: '',
      stderrPlain: 'vesen: 3: file descriptors other than 0, 1 and 2 are not supported',
    });
    expect(await runLine('echo x >&3', { tty: false })).toMatchObject({ status: 2, stderrPlain: 'vesen: 3: file descriptors other than 0, 1 and 2 are not supported' });
    expect(await runLine('cat 4< f', { tty: false })).toMatchObject({ status: 2, stderrPlain: 'vesen: 4: file descriptors other than 0, 1 and 2 are not supported' });
  });

  it('writes through noclobber with >|, appends both streams with &>>, and pipes stderr with |&', async () => {
    expect((await lines('set -o noclobber; echo a > f; echo c >| f; cat f')).last.stdoutPlain).toBe('c');
    expect((await lines('echo hi &>> log; cat nope &>> log; cat log')).last.stdoutPlain).toBe('hi\ncat: nope: No such file or directory');
    expect(await runLine('cat nope |& cat -n', { tty: false })).toMatchObject({
      stdoutPlain: '     1\tcat: nope: No such file or directory',
      stderrPlain: '',
    });
    expect((await lines('echo x >& f; cat f')).last.stdoutPlain).toBe('x');
    expect((await lines('echo y >&f; cat f')).last.stdoutPlain).toBe('y');
  });
});

describe('brace expansion', () => {
  it('expands lists, nested lists and sequences', async () => {
    expect((await runLine('echo {a,b} x{1,2}y {1..3} {a,{b,c}}d', { tty: false })).stdoutPlain).toBe('a b x1y x2y 1 2 3 ad bd cd');
    expect((await runLine('echo {01..03} {c..a} {1..10..4} {5..1..2}', { tty: false })).stdoutPlain).toBe('01 02 03 c b a 1 5 9 5 3 1');
  });

  it('leaves quoted and escaped braces, ${…}, {} and a lone { alone', async () => {
    expect((await runLine('echo "{a,b}" \\{a,b\\} ${HOME} {} { a{b}c {a..} x{,}', { tty: false })).stdoutPlain).toBe(
      '{a,b} {a,b} /home/guest {} { a{b}c {a..} x x',
    );
  });

  it('makes several operands for a command', async () => {
    const { last } = await lines('mkdir -p proj/{src,test}', 'echo hi > notes.txt; cp notes.txt{,.bak}', 'ls proj; ls notes*');
    expect(last.stdoutPlain).toBe('src\ntest\nnotes.txt\nnotes.txt.bak');
  });

  it('refuses a sequence too long to build', async () => {
    expect(await runLine('echo {1..1000000}; echo after', { tty: false })).toMatchObject({
      status: 1,
      stdoutPlain: '',
      stderrPlain: 'vesen: {1..1000000}: brace expansion makes too many words',
    });
  });
});

describe('aliases in $( ), backticks and sourced files', () => {
  it('expand, as in interactive bash', async () => {
    expect((await runLine('echo $(ll -d /)', { tty: false })).stdoutPlain).toMatch(/^drwxr-xr-x .* \/$/);
    expect((await lines('alias e=echo', 'e $(e sub) `e tick`')).last.stdoutPlain).toBe('sub tick');
    expect((await lines("echo 'll -d /tmp' > s.sh; source s.sh")).last.stdoutPlain).toMatch(/^drwxrwxrwt .* \/tmp$/);
  });

  it('do not expand in a script run as a program, as in non-interactive bash', async () => {
    // cp keeps the seeded script's mode, so the copy is executable.
    const { last } = await lines("cp ~/bin/deploy ~/bin/x; printf '#!/bin/sh\\nll -d /tmp\\n' > ~/bin/x; x");
    expect(last.status).toBe(127);
    expect(last.stderrPlain.split('\n')[0]).toBe('vesen: ll: command not found');
  });
});

describe('export and declaration arguments', () => {
  it('keeps the spaces in export NAME=$VAR, with no splitting or globbing', async () => {
    const { last } = await lines("Y='a b'; export X=$Y; printenv X; printenv b; echo $?");
    expect(last.stdoutPlain).toBe('a b\n1');
    expect((await lines('export P=*.md; printenv P')).last.stdoutPlain).toBe('*.md');
  });

  it('remembers export NAME before NAME has a value', async () => {
    expect((await lines('export X; X=5; printenv X')).last.stdoutPlain).toBe('5');
    expect((await lines('export X; env')).last.stdoutPlain).not.toMatch(/^X=/m);
  });

  it('runs export and unset with their prefix assignments in the shell itself', async () => {
    expect((await lines('A=1 export B=2; printenv B; echo "[$A]"')).last.stdoutPlain).toBe('2\n[]');
    expect((await lines('X=1; A=2 unset X; echo "[$X]"')).last.stdoutPlain).toBe('[]');
    // Anything else gets them in its own environment only.
    expect((await lines('A=1 printenv A; echo "[$A]"')).last.stdoutPlain).toBe('1\n[]');
  });

  it('makes assignments with no command left to right', async () => {
    expect((await runLine('A=1 B=$A; echo "[$B]"', { tty: false })).stdoutPlain).toBe('[1]');
  });
});

describe('history modifiers', () => {
  it('substitutes with :s and :gs, and repeats with :&', async () => {
    const s = await session();
    await s.run('echo a b a');
    expect(await s.run('!!:s/a/c/')).toMatchObject({ stdoutPlain: 'echo c b a\nc b a' });
    await s.run('echo foo foo');
    expect((await s.run('!!:gs/foo/bar/')).stdoutPlain).toBe('echo bar bar\nbar bar');
    await s.run('echo foo x');
    expect((await s.run('!!:&')).stdoutPlain).toBe('echo bar x\nbar x');
    expect(await s.run('!!:s/nomatch/y/')).toMatchObject({ status: 1, stderrPlain: 'vesen: :s/nomatch/y/: substitution failed' });
    s.stop();
  });

  it('takes paths apart with :h :t :r :e, and quotes with :q', async () => {
    const s = await session();
    await s.run('echo /x/y/file.tar.gz');
    expect((await s.run('echo !$:h')).stdoutPlain).toBe('echo /x/y\n/x/y');
    expect((await s.run('echo !-2:$:t:r')).stdoutPlain).toBe('echo file.tar\nfile.tar');
    expect((await s.run('echo !-3:$:e')).stdoutPlain).toBe('echo .gz\n.gz');
    await s.run('echo "a b"');
    expect((await s.run('echo !$:q')).stdoutPlain).toBe(`echo '"a b"'\n"a b"`);
    s.stop();
  });

  it('only prints a line with :p, and keeps it in history', async () => {
    const s = await session();
    await s.run('touch precious');
    await s.run('echo one');
    const shown = await s.run('!to:p');
    expect(shown).toMatchObject({ status: 0, stdoutPlain: 'touch precious' });
    await s.run('rm precious');
    expect((await s.run('ls precious')).status).toBe(2);
    await s.run('!rm:p');
    expect(s.app.shell.history.list().map((entry) => entry.line).slice(-1)).toEqual(['rm precious']);
    expect((await s.run('touch precious; !rm:p; ls precious')).status).toBe(0);
    s.stop();
  });

  it('reads !:N as word N of the last line, and refuses a modifier it does not know', async () => {
    const s = await session();
    await s.run('echo one two');
    expect((await s.run('echo !:2')).stdoutPlain).toBe('echo two\ntwo');
    expect(await s.run('echo !!:z')).toMatchObject({ status: 1, stderrPlain: 'vesen: z: unrecognized history modifier' });
    s.stop();
  });
});

describe('syntax vesen does not have fails loudly', () => {
  it('refuses a ( ) subshell and <( ) process substitution with status 2', async () => {
    expect(await runLine('(cd /tmp; pwd)', { tty: false })).toMatchObject({ status: 2, stderrPlain: 'vesen: (: not supported in vesen', stdoutPlain: '' });
    expect(await runLine('cat <(ls)', { tty: false })).toMatchObject({ status: 2, stderrPlain: 'vesen: <(: not supported in vesen' });
    expect(await runLine('cat >(ls)', { tty: false })).toMatchObject({ status: 2, stderrPlain: 'vesen: >(: not supported in vesen' });
  });

  it('still prints parentheses elsewhere', async () => {
    expect((await runLine('echo :) "(a)" x\\(', { tty: false })).stdoutPlain).toBe(':) (a) x(');
  });
});

describe('$_, OLDPWD and an expansion error', () => {
  it('sets $_ to the last word of the command before', async () => {
    expect((await lines('mkdir newdir && cd $_; pwd')).last.stdoutPlain).toBe('/home/guest/newdir');
    expect((await runLine('echo hi; echo $_', { tty: false })).stdoutPlain).toBe('hi\nhi');
    expect((await runLine('true; echo "[$_]"', { tty: false })).stdoutPlain).toBe('[true]');
  });

  it('has no OLDPWD until the first cd, and sets it on every cd', async () => {
    expect(await runLine('cd -', { tty: false })).toMatchObject({ status: 1, stderrPlain: 'vesen: cd: OLDPWD not set' });
    expect((await runLine('echo ~-', { tty: false })).stdoutPlain).toBe('~-');
    expect((await lines('cd /tmp; cd /tmp; cd -')).last.stdoutPlain).toBe('/tmp');
    expect((await lines('cd /tmp; cd -')).last.stdoutPlain).toBe('/home/guest');
  });

  it('abandons the rest of the line after an expansion error', async () => {
    expect(await runLine('echo $((1/0)); echo $?', { tty: false })).toMatchObject({ status: 1, stdoutPlain: '' });
    expect(await runLine('touch f; echo ${}; rm f', { tty: false })).toMatchObject({ status: 1, stderrPlain: 'vesen: ${}: bad substitution' });
    const { last } = await lines('touch f; echo ${}; rm f', 'ls f');
    expect(last).toMatchObject({ status: 0, stdoutPlain: 'f' });
    // A redirection that fails ends only its command.
    expect(await runLine('cat < nope; echo next', { tty: false })).toMatchObject({ stdoutPlain: 'next' });
  });
});

describe('the seeded dotfiles', () => {
  it('puts ~/bin on PATH once', async () => {
    expect((await runLine('echo $PATH', { tty: false })).stdoutPlain).toBe('/home/guest/bin:/usr/local/bin:/usr/bin:/bin');
  });

  it('sources ~/.profile without an error', async () => {
    expect(await runLine('source ~/.profile; echo $?; echo $EDITOR', { tty: false })).toMatchObject({ stdoutPlain: '0\nvim', stderrPlain: '' });
  });
});

describe('small builtins', () => {
  it('has :, which does nothing and succeeds', async () => {
    expect((await runLine(': ; echo $?', { tty: false })).stdoutPlain).toBe('0');
    expect((await runLine(': --anything; echo $?', { tty: false })).stdoutPlain).toBe('0');
    expect((await lines('echo old > log; : > log; cat log; echo $?')).last.stdoutPlain).toBe('0');
    expect((await runLine('type :', { tty: false })).stdoutPlain).toBe(': is a shell builtin');
  });

  it('exits 255 for exit -1', async () => {
    expect((await runLine('exit -1')).status).toBe(255);
    expect((await runLine('exit -2')).status).toBe(254);
  });

  it('reads a file with $(< file)', async () => {
    expect((await lines('printf "one\\ntwo\\n" > f; echo "$(< f)"')).last.stdoutPlain).toBe('one\ntwo');
    expect(await runLine('echo "[$(< nope)]"', { tty: false })).toMatchObject({ stdoutPlain: '[]', stderrPlain: 'vesen: nope: No such file or directory' });
  });

  it('gives printf -v and %q, as bash’s builtin has them', async () => {
    expect((await runLine("printf -v X '%s-%s' a b; echo $X", { tty: false })).stdoutPlain).toBe('a-b');
    expect((await runLine("printf '%q\\n' 'a b' \"it's\" '' '~x'", { tty: false })).stdoutPlain).toBe("a\\ b\nit\\'s\n''\n\\~x");
    expect((await runLine("printf '%q\\n' $'tab\\there'", { tty: false })).stdoutPlain).toBe("$'tab\\there'");
    expect(await runLine("printf -v 1x '%s' a", { tty: false })).toMatchObject({ status: 2, stderrPlain: "vesen: printf: `1x': not a valid identifier" });
  });
});

describe('a script’s #! line', () => {
  it('refuses an interpreter vesen does not have, as Linux does', async () => {
    expect(await runLine('./scripts/setup.py', { tty: false })).toMatchObject({
      status: 127,
      stdoutPlain: '',
      stderrPlain: "/usr/bin/env: 'python3': No such file or directory",
    });
  });
});

describe('budgets on expansion', () => {
  it('stops a glob that would match too many paths, quickly, instead of freezing the page', async () => {
    const s = await session({ tty: false });
    await s.run('mkdir ~/t; cd ~/t; ln -s . a; ln -s . b; ln -s . c; ln -s . d');
    expect((await s.run('echo */*/* | wc -w')).stdoutPlain).toBe('64');
    const started = Date.now();
    expect(await s.run('echo */*/*/*/*/*/*/*/*/*/*/*; echo after')).toMatchObject({
      status: 1,
      stdoutPlain: '',
      stderrPlain: 'vesen: argument list too long',
    });
    expect(Date.now() - started).toBeLessThan(1000);
    s.stop();
  });
});
