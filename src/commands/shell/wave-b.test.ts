// The shell built-ins as specs (docs/plan/08-shell-and-commands.md, wave B): aliases, variables,
// options, source, type, which, command, true, false, test and [, exit and logout, sleep and date.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLine, session } from '../../../tests/harness';
import { isTrustedAction, type Block } from '../../output/model';
import { formatDate, zoneName } from '../system/date.run';
import { setValue } from './set.run';
import { interval } from './sleep';
import { evaluate, TestError, type TestWorld } from './test.run';

afterEach(() => {
  vi.useRealTimers();
});

describe('aliases', () => {
  it('has ll, la and l from ~/.bashrc at login', async () => {
    const s = await session({ tty: false });
    expect((await s.run('alias ll')).stdoutPlain).toBe("alias ll='ls -la'");
    expect((await s.run('ll')).stdoutPlain).toMatch(/^total \d+$/m);
    expect((await s.run('ll')).stdoutPlain).toMatch(/ \.bashrc$/m);
    s.stop();
  });

  it('unalias removes one, all with -a, and says which it cannot find', async () => {
    const s = await session();
    expect(await s.run('unalias ll')).toMatchObject({ status: 0, stdoutPlain: '' });
    expect(await s.run('ll')).toMatchObject({ status: 127 });
    expect(await s.run('unalias ll')).toMatchObject({ status: 1, stderrPlain: 'vesen: unalias: ll: not found' });
    await s.run('unalias -a');
    expect(s.app.shell.aliases.size).toBe(0);
    expect(await s.run('unalias')).toMatchObject({ status: 2 });
    s.stop();
  });
});

describe('variables', () => {
  it('unset removes a variable, and refuses a name that is not one', async () => {
    const s = await session({ tty: false });
    await s.run('export NAME=Has');
    expect(await s.run('unset NAME; echo "[$NAME]"')).toMatchObject({ status: 0, stdoutPlain: '[]' });
    expect(await s.run('unset 1x')).toMatchObject({ status: 1, stderrPlain: "vesen: unset: `1x': not a valid identifier" });
    s.stop();
  });

  it('printenv prints exported variables only, and fails for one that is not', async () => {
    const s = await session({ tty: false });
    expect((await s.run('printenv HOME USER')).stdoutPlain).toBe('/home/guest\nguest');
    await s.run('LOCAL=1');
    expect(await s.run('printenv LOCAL')).toMatchObject({ status: 1, stdoutPlain: '' });
    expect((await s.run('printenv')).stdoutPlain).toMatch(/^HOME=\/home\/guest$/m);
    expect((await s.run('printenv')).stdoutPlain).not.toMatch(/^LOCAL=/m);
    s.stop();
  });

  it('env prints the environment, or runs a command with variables added for it alone', async () => {
    const s = await session({ tty: false });
    expect((await s.run('env')).stdoutPlain).toMatch(/^PATH=/m);
    expect((await s.run('env A=1 B="two words"')).stdoutPlain).toMatch(/^A=1$[\s\S]*^B=two words$/m);
    expect(await s.run('env GREETING=hi printenv GREETING')).toMatchObject({ status: 0, stdoutPlain: 'hi' });
    expect(await s.run('printenv GREETING')).toMatchObject({ status: 1 });
    expect(await s.run('env ll')).toMatchObject({ status: 127 });
    s.stop();
  });

  it('set lists every variable, quoted where it must be', async () => {
    const s = await session({ tty: false });
    await s.run("GREETING='hi there'");
    const listed = (await s.run('set')).stdoutPlain;
    expect(listed).toMatch(/^GREETING='hi there'$/m);
    expect(listed).toMatch(/^HOME=\/home\/guest$/m);
    expect(setValue("it's")).toBe(`'it'\\''s'`);
    s.stop();
  });
});

describe('set -o', () => {
  it('turns noclobber on and off, by name or letter, and lists the options', async () => {
    const s = await session({ tty: false });
    expect((await s.run('set -o')).stdoutPlain).toBe('noclobber      \toff\nnoglob         \toff');
    await s.run('set -o noclobber; echo one > f');
    expect(await s.run('echo two > f')).toMatchObject({ status: 1, stderrPlain: 'vesen: f: cannot overwrite existing file' });
    expect((await s.run('set +o')).stdoutPlain).toBe('set -o noclobber\nset +o noglob');
    await s.run('set +C');
    expect(await s.run('echo three > f; cat f')).toMatchObject({ status: 0, stdoutPlain: 'three' });
    await s.run('set -f');
    expect((await s.run('echo *.md')).stdoutPlain).toBe('*.md');
    s.stop();
  });

  it('refuses what it does not know, and positional parameters', async () => {
    expect(await runLine('set -o nope')).toMatchObject({ status: 2, stderrPlain: 'vesen: set: nope: invalid option name\nset: usage: set [-Cf] [-o option-name] [--] [arg ...]' });
    expect(await runLine('set -e')).toMatchObject({ status: 1, stderrPlain: 'vesen: set: -e: not supported in vesen' });
    expect(await runLine('set -- a b')).toMatchObject({ status: 1, stderrPlain: 'vesen: set: positional parameters are not supported in vesen' });
  });
});

describe('source and .', () => {
  it('runs a file in this shell, with its arguments as $1 and on', async () => {
    const s = await session({ tty: false });
    await s.run(`printf 'alias hi="echo hello"\\nGREETING=$1\\n' > setup.sh`);
    // As in bash, an alias works from the line after the one that defines it.
    expect(await s.run('source setup.sh world; echo $GREETING')).toMatchObject({ status: 0, stdoutPlain: 'world' });
    expect(await s.run('hi')).toMatchObject({ status: 0, stdoutPlain: 'hello' });
    await s.run('unalias hi');
    await s.run('. ./setup.sh');
    expect(await s.run('hi')).toMatchObject({ status: 0, stdoutPlain: 'hello' });
    expect(await s.run('source nope.sh')).toMatchObject({ status: 1, stderrPlain: 'vesen: nope.sh: No such file or directory' });
    expect(await s.run('source')).toMatchObject({ status: 2 });
    s.stop();
  });
});

describe('type, which and command -v', () => {
  it('type says what each name runs', async () => {
    const s = await session({ tty: false });
    expect((await s.run('type ls')).stdoutPlain).toBe('ls is /usr/bin/ls');
    expect((await s.run('type ll cd if')).stdoutPlain).toBe("ll is aliased to `ls -la'\ncd is a shell builtin\nif is a shell keyword");
    expect((await s.run('type -t ll cd ls if')).stdoutPlain).toBe('alias\nbuiltin\nfile\nkeyword');
    expect((await s.run('type -a ls')).stdoutPlain).toBe('ls is /usr/bin/ls\nls is /bin/ls');
    expect(await s.run('type nope')).toMatchObject({ status: 1, stderrPlain: 'vesen: type: nope: not found' });
    s.stop();
  });

  it('which finds the file on $PATH, and prints nothing for what is not there', async () => {
    const s = await session({ tty: false });
    expect(await s.run('which cat')).toMatchObject({ status: 0, stdoutPlain: '/usr/bin/cat' });
    expect((await s.run('which -a cat')).stdoutPlain).toBe('/usr/bin/cat\n/bin/cat');
    expect(await s.run('which nope')).toMatchObject({ status: 1, stdoutPlain: '', stderrPlain: '' });
    expect(await s.run('which ll')).toMatchObject({ status: 1 });
    s.stop();
  });

  it('command -v prints what runs, and command runs a command without its alias', async () => {
    const s = await session({ tty: false });
    expect((await s.run('command -v ls cd ll')).stdoutPlain).toBe("/usr/bin/ls\ncd\nalias ll='ls -la'");
    expect(await s.run('command -v nope')).toMatchObject({ status: 1, stdoutPlain: '' });
    expect((await s.run('command -V cd')).stdoutPlain).toBe('cd is a shell builtin');
    expect(await s.run('command ll')).toMatchObject({ status: 127 });
    expect((await s.run('command ls -d documents')).stdoutPlain).toBe('documents');
    s.stop();
  });
});

describe('true, false, test and [', () => {
  it('true and false set the status for && and ||', async () => {
    expect((await runLine('true && echo yes || echo no')).stdoutPlain).toBe('yes');
    expect((await runLine('false && echo yes || echo no')).stdoutPlain).toBe('no');
  });

  it('test answers questions about files, strings and numbers', async () => {
    const s = await session({ tty: false });
    const status = async (line: string) => (await s.run(line)).status;
    expect(await status('test -f README.md')).toBe(0);
    expect(await status('test -d README.md')).toBe(1);
    expect(await status('[ -d documents ]')).toBe(0);
    expect(await status('[ -e nope ]')).toBe(1);
    expect(await status('[ -r /etc/shadow ]')).toBe(1);
    expect(await status('[ -w /etc/hostname ]')).toBe(1);
    expect(await status('[ -L /home/user ]')).toBe(0);
    expect(await status('[ -s README.md ]')).toBe(0);
    expect(await status('[ -z "" ]')).toBe(0);
    expect(await status('[ abc = abc ] && [ abc != abd ]')).toBe(0);
    expect(await status('[ 10 -gt 9 -a 2 -le 2 ]')).toBe(0);
    expect(await status('[ ! -f nope ]')).toBe(0);
    expect(await status('[ \\( 1 -eq 2 \\) -o 3 -eq 3 ]')).toBe(0);
    expect(await status('test')).toBe(1);
    expect(await status('test -n')).toBe(0);
    s.stop();
  });

  it('exits 2 on a mistake, and [ needs its ]', async () => {
    expect(await runLine('[ -f README.md')).toMatchObject({ status: 2, stderrPlain: "[: missing `]'" });
    expect(await runLine('test abc -gt 1')).toMatchObject({ status: 2, stderrPlain: 'test: abc: integer expression expected' });
    expect(await runLine('test 1 2')).toMatchObject({ status: 2 });
  });

  it('evaluates as POSIX test does', () => {
    const world: TestWorld = {
      stat: () => null,
      lstat: () => null,
      access: () => false,
      realpath: () => null,
      isTerminal: (fd) => fd === 1,
      uid: 1000,
      gid: 1000,
    };
    expect(evaluate(['-t', '1'], world)).toBe(true);
    expect(evaluate(['!'], world)).toBe(true);
    expect(evaluate(['-f'], world)).toBe(true);
    expect(evaluate(['=', '=', '='], world)).toBe(true);
    expect(evaluate(['b', '<', 'a'], world)).toBe(false);
    expect(() => evaluate(['(', 'x'], world)).toThrow(TestError);
  });
});

describe('exit and logout', () => {
  it("print logout and [Process completed], with a chip that starts a new session, keeping files", async () => {
    const s = await session();
    await s.run('echo kept > kept.txt; export NAME=Has; unalias ll; cd /etc');
    // In a pipeline, exit ends only its own stage, quietly.
    expect(await s.run('true | exit 4')).toMatchObject({ status: 4, stdoutPlain: '' });
    expect((await s.run('echo $NAME')).stdoutPlain).toBe('Has');
    const result = await s.run('exit');
    expect(result.status).toBe(0);
    expect(result.stderrPlain).toBe('');
    expect(result.stdoutPlain.trimEnd()).toBe('logout\n\n[Process completed]');
    const chips = result.blocks.find((block): block is Extract<Block, { type: 'chips' }> => block.type === 'chips');
    const chip = chips?.items[0];
    expect(chip?.label).toBe('Start a new session');
    expect(isTrustedAction(chip?.action)).toBe(true);
    expect(chip?.action).toMatchObject({ kind: 'run', line: 'login' });

    // The chip runs its line: a new session, the files kept, the banner on a clear screen.
    const login = await s.app.shell.run(chip?.action.kind === 'run' ? chip.action.line : '', 'chip');
    expect(login.status).toBe(0);
    expect(login.screen).toBe('reset');
    expect(s.app.shell.cwd.get()).toBe('/home/guest');
    expect((await s.run('echo "[$NAME]"; cat kept.txt')).stdoutPlain).toBe('[]\nkept');
    expect((await s.run('alias ll')).stdoutPlain).toBe("alias ll='ls -la'");
    s.stop();
  });

  it('ends with the status given, or the last one', async () => {
    const s = await session({ tty: false });
    expect((await s.run('exit 3')).status).toBe(3);
    expect((await s.run('false; exit')).status).toBe(1);
    expect(await s.run('exit 1 2')).toMatchObject({ status: 1, stderrPlain: 'vesen: exit: too many arguments' });
    expect(await s.run('exit nope')).toMatchObject({ status: 2, stderrPlain: 'vesen: exit: nope: numeric argument required' });
    s.stop();
  });

  it('lets the next line typed start a new session, at the home prompt', async () => {
    const s = await session();
    await s.run('export NAME=Has; cd /etc');
    await s.run('logout');
    // The live prompt is already the next session's, so it says where the next line runs.
    expect(s.app.shell.renderPrompt().map((span) => span.text).join('')).toBe('guest@vesen:~$');
    expect((await s.run('echo "[$NAME] $PWD"')).stdoutPlain).toBe('[] /home/guest');
    expect((await s.run('alias ll')).status).toBe(0);
    s.stop();
  });

  it('ends only the subshell in a pipeline or $( ), and only the script in a script', async () => {
    const s = await session({ tty: false });
    expect((await s.run('exit 4 | cat; echo still here')).stdoutPlain).toBe('still here');
    expect((await s.run('true | exit 4; echo $?')).stdoutPlain).toBe('4');
    expect((await s.run('x=$(exit 5; echo no); echo "[$x] $?"')).stdoutPlain).toBe('[] 5');
    await s.run("printf '#!/bin/vesh\\necho one\\nexit 6\\necho two\\n' > script.sh; chmod 755 script.sh 2>/dev/null");
    s.app.vfs.chmod('/home/guest/script.sh', 0o755);
    expect(await s.run('./script.sh; echo after $?')).toMatchObject({ stdoutPlain: 'one\nafter 6' });
    s.stop();
  });
});

describe('sleep', () => {
  it('reads seconds, suffixes and fractions, and complains about the rest', async () => {
    expect([interval('2'), interval('1.5'), interval('.5'), interval('2m'), interval('1h'), interval('1d')]).toEqual([
      2000, 1500, 500, 120_000, 3_600_000, 86_400_000,
    ]);
    expect(interval('infinity')).toBe(Number.POSITIVE_INFINITY);
    expect(interval('x')).toBeNull();
    expect(await runLine('sleep')).toMatchObject({ status: 1, stderrPlain: "sleep: missing operand\nTry 'sleep --help' for more information." });
    expect(await runLine('sleep 1x')).toMatchObject({ status: 1, stderrPlain: "sleep: invalid time interval '1x'\nTry 'sleep --help' for more information." });
  });

  it('waits, and ^C ends it at once with 130', async () => {
    const s = await session();
    const started = Date.now();
    expect((await s.run('sleep 0.05')).status).toBe(0);
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
    const handle = s.app.shell.start('sleep 100');
    await new Promise((resolve) => setTimeout(resolve, 10));
    handle.abort();
    expect(await handle.done).toMatchObject({ status: 130, interrupted: true });
    s.stop();
  });
});

describe('date', () => {
  // 2026-10-06 09:00:00 UTC, a Tuesday: 20:00 in Sydney, on daylight time.
  const now = Date.UTC(2026, 9, 6, 9, 0, 0);

  it("prints date's own format in the visitor's zone, and UTC with -u", async () => {
    // The harness's clock moves a minute before each line.
    expect((await runLine('date')).stdoutPlain).toBe('Tue Oct  6 20:01:00 AEDT 2026');
    expect((await runLine('date -u')).stdoutPlain).toBe('Tue Oct  6 09:01:00 UTC 2026');
    expect((await runLine('TZ=Europe/Oslo date')).stdoutPlain).toBe('Tue Oct  6 11:01:00 CEST 2026');
    expect((await runLine('TZ=Nowhere/Land date +%H:%M')).stdoutPlain).toBe('09:01');
  });

  it('formats +FORMAT with the common conversions', () => {
    expect(formatDate('%Y-%m-%d %H:%M:%S', now, 'Australia/Sydney')).toBe('2026-10-06 20:00:00');
    expect(formatDate('%a %b %e %j %u %s %Z %%', now, 'UTC')).toBe(`Tue Oct  6 279 2 ${now / 1000} UTC %`);
    expect(formatDate('%A %B %y %z %:z %F %T %Q', now, 'Australia/Sydney')).toBe('Tuesday October 26 +1100 +11:00 2026-10-06 20:00:00 %Q');
    expect(formatDate('%u', Date.UTC(2026, 9, 4, 12), 'UTC')).toBe('7');
  });

  it("reads GNU's padding and case flags, widths, and the C locale's conversions", () => {
    expect(formatDate('%-d/%-m %_H|%^a|%#Z|%P|%k|%l|%C|%g|%G|%V|%U|%W', now, 'Australia/Sydney')).toBe('6/10 20|TUE|aedt|pm|20| 8|20|26|2026|41|40|40');
    expect(formatDate('%c|%x|%X|%r', now, 'Australia/Sydney')).toBe('Tue Oct  6 20:00:00 2026|10/06/26|20:00:00|08:00:00 PM');
    expect(formatDate('%N %3N %-N', now + 123, 'UTC')).toBe('123000000 123 123000000');
    expect(formatDate('%12s|%_5d|%05e|%3e', now, 'UTC')).toBe(`${String(now / 1000).padStart(12, '0')}|    6|00006|  6`);
    // ISO weeks: 1 January 2027 is a Friday, so it belongs to 2026's week 53.
    expect(formatDate('%G-W%V-%u', Date.UTC(2027, 0, 1, 12), 'UTC')).toBe('2026-W53-5');
    expect(formatDate('%-q %Ey', now, 'UTC')).toBe('%-q 26');
  });

  it('names zones as tzdata does, numerically where a zone has no letters', () => {
    expect(zoneName('Australia/Sydney', now, 660)).toBe('AEDT');
    expect(zoneName('UTC', now, 0)).toBe('UTC');
    expect(zoneName('America/Sao_Paulo', now, -180)).toBe('-03');
  });

  it('prints ISO 8601 with -I, and refuses an operand that is not a format', async () => {
    expect((await runLine('date -I')).stdoutPlain).toBe('2026-10-06');
    expect((await runLine('date -Iseconds')).stdoutPlain).toBe('2026-10-06T20:01:00+11:00');
    expect((await runLine('date -R')).stdoutPlain).toBe('Tue, 06 Oct 2026 20:01:00 +1100');
    expect(await runLine('date tomorrow')).toMatchObject({ status: 1, stderrPlain: "date: invalid date 'tomorrow'" });
  });
});
