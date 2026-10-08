// Wave C's built-ins and the commands that run other commands: read (with the prompt answered by
// a fake terminal), time's report, timeout, watch, nohup, kill, and the honest no-job-control
// answers of jobs, fg, bg and wait.
import { describe, expect, it } from 'vitest';
import { FROZEN_NOW, runLine, session, TIME_ZONE } from '../../../../tests/harness';
import { createAppShell } from '../../../app/shell';
import { createClock } from '../../../services/clock';
import { createScreen } from '../../../stores/screen';
import { screenText, stubCommands } from '../../../testing/shell-harness';
import { splitFields, unescape } from './read.run';
import { DEFAULT_TIMEFORMAT, formatTimes } from './time.run';

describe('read', () => {
  it('splits a line on IFS: a word to each NAME, the rest to the last', async () => {
    const s = await session({ tty: false });
    await s.run("read A B C <<< '  one   two three four  '");
    expect((await s.run('echo "[$A] [$B] [$C]"')).stdoutPlain).toBe('[one] [two] [three four]');
    await s.run("IFS=: read USER_ HOME_ <<< 'guest:/home/guest:/bin/vesh'");
    expect((await s.run('echo "$USER_ $HOME_"')).stdoutPlain).toBe('guest /home/guest:/bin/vesh');
    await s.run("read X Y <<< 'only'");
    expect((await s.run('echo "[$X] [$Y]"')).stdoutPlain).toBe('[only] []');
    s.stop();
  });

  it('puts the whole line in REPLY with no NAME, and keeps backslashes with -r', async () => {
    const s = await session({ tty: false });
    await s.run("read <<< '  a b  '");
    expect((await s.run('echo "[$REPLY]"')).stdoutPlain).toBe('[  a b  ]');
    await s.run("read A B <<< 'one\\ two three'");
    expect((await s.run('echo "[$A] [$B]"')).stdoutPlain).toBe('[one two] [three]');
    await s.run("read -r A B <<< 'one\\ two three'");
    expect((await s.run('echo "[$A] [$B]"')).stdoutPlain).toBe('[one\\] [two three]');
    await s.run("printf 'first \\\\\\nsecond\\nthird\\n' > f; read A < f");
    expect((await s.run('echo "[$A]"')).stdoutPlain).toBe('[first second]');
    s.stop();
  });

  it('reads -n characters, up to a -d delimiter, and returns 1 at the end of the input', async () => {
    const s = await session({ tty: false });
    await s.run("read -n 3 A <<< 'abcdef'");
    expect((await s.run('echo $A')).stdoutPlain).toBe('abc');
    await s.run("read -d , A <<< 'x,y'");
    expect((await s.run('echo $A')).stdoutPlain).toBe('x');
    expect((await s.run('read A < /dev/null; echo "$? [$A]"')).stdoutPlain).toBe('1 []');
    expect((await s.run("printf 'no newline' > g; read A < g; echo \"$? $A\"")).stdoutPlain).toBe('1 no newline');
    s.stop();
  });

  it('asks at the prompt when standard input is the terminal, with -p and -s', async () => {
    const s = await session({ answer: (prompt) => (prompt === 'Name? ' ? 'Ada Lovelace' : 'hunter2') });
    const asked = await s.run("read -p 'Name? ' FIRST LAST");
    expect(asked.status).toBe(0);
    expect(asked.prompts).toEqual(['Name? ']);
    // The terminal echoes the prompt and the answer, as a terminal shows them.
    expect(asked.stdoutPlain).toBe('Name? Ada Lovelace');
    expect((await s.run('echo "$LAST, $FIRST"')).stdoutPlain).toBe('Lovelace, Ada');
    const secret = await s.run("read -s -p 'Password: ' PASS");
    expect(secret.stdoutPlain).toBe('Password: ');
    expect((await s.run('echo ${#PASS}')).stdoutPlain).toBe('7');
    s.stop();
  });

  it('treats ^D at the prompt as the end of the input', async () => {
    const s = await session({ answer: () => null });
    expect((await s.run('read A; echo "$? [$A]"')).stdoutPlain).toContain('1 []');
    s.stop();
  });

  it('gives up after -t seconds at a prompt nobody answers, with status 142', async () => {
    let reads = 0;
    let now = FROZEN_NOW;
    const app = createAppShell({
      banner: () => [],
      specs: stubCommands(),
      screen: createScreen(),
      version: '0.0.0-test',
      clock: createClock({ now: () => now, random: () => 0.5, timeZone: TIME_ZONE }),
      terminal: {
        size: () => ({ cols: 80, rows: 24 }),
        touch: false,
        inApp: null,
        // Never answered: only the signal ends the read.
        readLine: ({ signal }) =>
          new Promise((resolve) => {
            reads += 1;
            signal?.addEventListener('abort', () => resolve(null), { once: true });
          }),
      },
      yieldToHost: () => Promise.resolve(),
    });
    await app.shell.registry.whenComplete();
    await app.boot();
    now += 60_000;
    const result = await app.shell.run("read -t 0.05 -p 'Quick? ' A; echo \"status $?\"");
    expect(reads).toBe(1);
    expect(screenText(result.blocks, 'stdout')).toBe('Quick? \nstatus 142');
    app.stop();
  });

  it('refuses a NAME that is not one, and a bad -t', async () => {
    expect(await runLine('read 1x <<< a', { tty: false })).toMatchObject({ status: 1, stderrPlain: "vesen: read: `1x': not a valid identifier" });
    expect(await runLine('read -t soon A <<< a', { tty: false })).toMatchObject({ status: 1, stderrPlain: 'vesen: read: soon: invalid timeout specification' });
  });

  it('runs in a subshell in a pipeline, as in bash', async () => {
    expect((await runLine('X=before; echo after | read X; echo $X', { tty: false })).stdoutPlain).toBe('before');
  });

  it('splits and unescapes as bash does', () => {
    expect(splitFields(unescape(' a  b  c ', false), 2, ' \t\n')).toEqual(['a', 'b  c']);
    expect(splitFields(unescape('a::b', false), 3, ':')).toEqual(['a', '', 'b']);
    expect(splitFields(unescape('a : b', false), 2, ' :')).toEqual(['a', 'b']);
    expect(splitFields(unescape('a b', false), 2, '')).toEqual(['a b', '']);
    expect(unescape('a\\', false)).toEqual([{ c: 'a', quoted: false }]);
  });
});

describe('time', () => {
  it("formats the report as bash's TIMEFORMAT does", () => {
    const times = { real: 61.23456, user: 0, sys: 0.5 };
    expect(formatTimes(DEFAULT_TIMEFORMAT, times)).toBe('\nreal\t1m1.234s\nuser\t0m0.000s\nsys\t0m0.500s');
    expect(formatTimes('%R %2U %0S %lR %%', times)).toBe('61.234 0.00 0 1m1.234s %');
    expect(formatTimes('%P', times)).toBe('0.82');
    expect(formatTimes('%P', { real: 0, user: 0, sys: 0 })).toBe('0.00');
  });

  it('reports the real time the command took, after its output, with its status', async () => {
    // A clock that runs, from the harness's frozen moment.
    const started = Date.now();
    const clock = (): number => FROZEN_NOW + (Date.now() - started);
    const result = await runLine('time -p ls nope', { tty: false, now: clock });
    expect(result.status).toBe(2);
    expect(result.screen[0]).toBe("! ls: cannot access 'nope': No such file or directory");
    expect(result.screen.slice(1).join('\n')).toMatch(/^! real 0\.\d\d\n! user 0\.00\n! sys 0\.00$/);
    const terminal = await runLine('time sleep 0.2', { now: clock });
    // At the prompt the report comes with the output, so no bell rings for it.
    expect(terminal.stdoutPlain).toMatch(/^\nreal\t0m0\.(19|2\d)\ds\nuser\t0m0\.000s\nsys\t0m0\.000s$/);
    expect(terminal.stderrPlain).toBe('');
  });

  it('times an alias, as the keyword does, says nothing with an empty TIMEFORMAT, and passes on 127', async () => {
    const s = await session({ tty: false });
    expect((await s.run('time ll')).stdoutPlain).toMatch(/^total \d+/);
    expect((await s.run("TIMEFORMAT=''; time true")).screen).toEqual([]);
    expect((await s.run('time nope')).status).toBe(127);
    s.stop();
  });
});

describe('timeout', () => {
  it('stops a command that runs too long with 124, and the rest of the line carries on', async () => {
    expect((await runLine('timeout 0.05 sleep 5; echo "status $?"', { tty: false })).stdoutPlain).toBe('status 124');
    expect((await runLine('timeout --preserve-status 0.05 sleep 5; echo $?', { tty: false })).stdoutPlain).toBe('143');
    expect((await runLine('timeout -s KILL 0.05 sleep 5; echo $?', { tty: false })).stdoutPlain).toBe('137');
    expect((await runLine('timeout -v 0.05 sleep 5', { tty: false })).stderrPlain).toBe("timeout: sending signal TERM to command 'sleep'");
  });

  it("gives the command's own status when it finishes in time, and 125 for its own mistakes", async () => {
    expect(await runLine('timeout 5 false', { tty: false })).toMatchObject({ status: 1 });
    expect(await runLine('timeout 0 echo no limit', { tty: false })).toMatchObject({ status: 0, stdoutPlain: 'no limit' });
    expect(await runLine('timeout 5 nope', { tty: false })).toMatchObject({ status: 127 });
    expect((await runLine('timeout -s NOPE 5 true', { tty: false })).status).toBe(125);
    expect((await runLine('timeout 5', { tty: false })).stderrPlain).toBe("timeout: missing operand\nTry 'timeout --help' for more information.");
  });

  it("says it failed to run a command that is not there (127) or cannot be run (126), as GNU's does, not the shell's command not found", async () => {
    expect(await runLine('timeout 1 nosuchcmd', { tty: false })).toMatchObject({ status: 127, stderrPlain: "timeout: failed to run command 'nosuchcmd': No such file or directory" });
    const s = await session({ tty: false });
    expect(await s.run('touch plain; timeout 1 ./plain')).toMatchObject({ status: 126, stderrPlain: "timeout: failed to run command './plain': Permission denied" });
    expect(await s.run('timeout 1 /etc')).toMatchObject({ status: 126, stderrPlain: "timeout: failed to run command '/etc': Permission denied" });
    // A command by path, its /usr/bin stub, and a script on $PATH all run.
    expect(await s.run('timeout 1 /bin/echo by path')).toMatchObject({ status: 0, stdoutPlain: 'by path' });
    expect(await s.run("mkdir -p ~/bin; printf 'echo from bin\\n' > ~/bin/hello; chmod +x ~/bin/hello; timeout 1 hello")).toMatchObject({ status: 0, stdoutPlain: 'from bin' });
    s.stop();
  });
});

describe('watch', () => {
  it('runs the command again and again, until -q sees no change, printing it again only when it changes', async () => {
    const result = await runLine('watch -n 0.1 -q 2 echo tick');
    expect(result.status).toBe(0);
    expect(result.stdoutPlain).toMatch(/^Every 0\.1s: echo tick {2,}vesen: \w{3} \w{3} [ \d]\d \d\d:\d\d:\d\d \d{4}\n\ntick$/);
    // The rest of the screen stays as it was.
    expect(result.blocks.every((block) => block.type !== 'lines' || block.stream === 'stdout')).toBe(true);
  });

  it('prints each change under a new title; -t leaves out the title; -g stops at a change', async () => {
    expect((await runLine('watch -t -n 0.1 -q 1 echo tick', { tty: false })).stdoutPlain).toBe('tick');
    const t = await session({ tty: false });
    await t.run('echo 1 > n');
    // The command changes its own output, so the second run differs.
    expect((await t.run("watch -t -g -n 0.1 'cat n; echo 2 > n'")).stdoutPlain).toBe('1\n2');
    const titled = (await t.run("echo 1 > n; watch -g -n 0.1 'cat n; echo 2 > n'")).stdoutPlain.split('\n');
    expect(titled.filter((row) => row.startsWith('Every 0.1s: cat n; echo 2 > n'))).toHaveLength(2);
    t.stop();
    expect((await runLine('watch', { tty: false })).status).toBe(1);
    expect((await runLine('watch -n soon date', { tty: false })).stderrPlain).toBe("watch: failed to parse argument: 'soon'\nTry 'watch --help' for more information.");
  });
});

describe('watch at length', () => {
  // Before, each run's output was collected without end: `watch yes` never stopped `yes`.
  it('collects at most 16 MB of a run, stopping the command there', async () => {
    const started = performance.now();
    const result = await runLine('watch -t -n 0.1 -q 1 yes | tail -c 4', { tty: false });
    expect(result).toMatchObject({ status: 0, stdoutPlain: 'y\ny' });
    expect(performance.now() - started).toBeLessThan(20_000);
  }, 30_000);
});

describe('nohup', () => {
  it('runs the command as it is, saying at the prompt that it ignores input', async () => {
    const result = await runLine('nohup echo hi');
    expect(result.stdoutPlain).toBe('nohup: ignoring input; the output stays on the screen, as vesen never hangs up\nhi');
    expect(await runLine('nohup false', { tty: false })).toMatchObject({ status: 1, stdoutPlain: '', stderrPlain: '' });
  });

  it("says it failed to run a command that is not there (127) or cannot be run (126), as GNU's does", async () => {
    expect(await runLine('nohup nosuchcmd', { tty: false })).toMatchObject({ status: 127, stderrPlain: "nohup: failed to run command 'nosuchcmd': No such file or directory" });
    expect(await runLine('nohup /tmp', { tty: false })).toMatchObject({ status: 126, stderrPlain: "nohup: failed to run command '/tmp': Permission denied" });
    // At the prompt, the note comes first, then the failure, and no 'command not found'.
    const typed = await runLine('nohup nosuchcmd');
    expect(typed.screen).toEqual(['nohup: ignoring input; the output stays on the screen, as vesen never hangs up', "! nohup: failed to run command 'nosuchcmd': No such file or directory"]);
  });
});

describe('job control', () => {
  it('is not there: jobs lists nothing, fg and bg say so, wait has nothing to wait for', async () => {
    expect(await runLine('jobs', { tty: false })).toMatchObject({ status: 0, stdoutPlain: '' });
    expect((await runLine('jobs')).stdoutPlain).toBe('No jobs: vesen has no job control, so every line runs in the foreground.');
    expect(await runLine('fg', { tty: false })).toMatchObject({ status: 1, stderrPlain: 'vesen: fg: no job control' });
    expect(await runLine('bg %1', { tty: false })).toMatchObject({ status: 1, stderrPlain: 'vesen: bg: no job control' });
    expect(await runLine('wait', { tty: false })).toMatchObject({ status: 0, stdoutPlain: '' });
    expect(await runLine('wait %2', { tty: false })).toMatchObject({ status: 127, stderrPlain: 'vesen: wait: %2: no such job' });
  });
});

describe('kill', () => {
  it('names and numbers signals, refuses init and unknown pids, and sends 0 only to ask', async () => {
    expect((await runLine('kill -l 15; kill -l SIGHUP; kill -l 137', { tty: false })).stdoutPlain).toBe('TERM\n1\nKILL');
    expect(await runLine('kill -s TERM 1', { tty: false })).toMatchObject({ status: 1, stderrPlain: 'vesen: kill: (1) - Operation not permitted' });
    expect(await runLine('kill -9 31999', { tty: false })).toMatchObject({ status: 1, stderrPlain: 'vesen: kill: (31999) - No such process' });
    expect(await runLine('kill -0 $$ && echo there', { tty: false })).toMatchObject({ status: 0, stdoutPlain: 'there' });
    expect(await runLine('kill -n x 1', { tty: false })).toMatchObject({ status: 1, stderrPlain: 'vesen: kill: x: invalid signal specification' });
  });

  it('ends the line a running command belongs to, as ^C does', async () => {
    const result = await runLine('sleep 5 | pkill -x sleep');
    expect(result.status).toBe(130);
    expect(result.blocks.length).toBeGreaterThan(0);
  });
});
