// Wave C's system commands (docs/plan/08-shell-and-commands.md): the facts come from /proc and
// /etc, which the VFS makes from the visitor's device, and from the browser's own description of
// it. The full transcripts are in tests/transcripts/system.txt and processes.txt.
import { afterEach, describe, expect, it } from 'vitest';
import { runLine, session } from '../../../../tests/harness';
import { ANDROID_PHONE, APPLE_SILICON_MAC, IPHONE_SAFARI, WINDOWS_PC } from '../../../../tests/support/systems';
import type { Block, LinesBlock } from '../../../output/model';
import { createSysInfo } from '../../../services/sysinfo';
import { provideDomain } from '../../lib/domain';
import { prettyUptime, upText } from '../../lib/sysread';
import { dayOfWeek, daysIn, monthRows } from './cal.run';
import finger from './finger';
import { humanSize } from './free.run';

afterEach(() => {
  provideDomain(null);
});

const linesOf = (blocks: readonly Block[]): LinesBlock[] => blocks.filter((block): block is LinesBlock => block.type === 'lines');

describe('uname and arch', () => {
  it('name the kernel and the machine the browser describes', async () => {
    const phone = createSysInfo(IPHONE_SAFARI().host);
    expect((await runLine('uname -m', { tty: false, sys: phone })).stdoutPlain).toBe('aarch64');
    // Chrome on Android says neither in its user agent nor in its hints.
    expect((await runLine('uname -m', { tty: false, sys: createSysInfo(ANDROID_PHONE().host) })).stdoutPlain).toBe('unknown');
    expect((await runLine('arch', { tty: false, sys: createSysInfo(WINDOWS_PC().host) })).stdoutPlain).toBe('x86_64');
    // A Mac's user agent says Intel; its GPU tells.
    expect((await runLine('uname -m', { tty: false, sys: createSysInfo(APPLE_SILICON_MAC().host) })).stdoutPlain).toBe('aarch64');
    expect((await runLine('uname -a', { tty: false, sys: phone })).stdoutPlain).toBe('Linux vesen 6.6.0-vesen #1 SMP PREEMPT_DYNAMIC aarch64 GNU/Linux');
    expect((await runLine('uname -p -i', { tty: false, sys: phone })).stdoutPlain).toBe('unknown unknown');
    expect(await runLine('uname x', { tty: false })).toMatchObject({ status: 1, stderrPlain: "uname: extra operand 'x'\nTry 'uname --help' for more information." });
  });
});

describe('hostname', () => {
  it('is vesen on every domain, and -f is the site the page came from', async () => {
    expect((await runLine('hostname -f', { tty: false })).stdoutPlain).toBe('vesen');
    provideDomain('www.vesen.app');
    expect((await runLine('hostname; hostname -f; hostname -d; hostname -s', { tty: false })).stdoutPlain).toBe('vesen\nwww.vesen.app\nvesen.app\nvesen');
    provideDomain('not a host name');
    expect((await runLine('hostname -f', { tty: false })).stdoutPlain).toBe('vesen');
  });
});

describe('uptime, w and top', () => {
  it('count from when the page loaded, with the load from /proc/loadavg', async () => {
    const sys = createSysInfo(WINDOWS_PC().host);
    const s = await session({ tty: false, sys });
    const load = (await s.run('cat /proc/loadavg')).stdoutPlain.split(' ').slice(0, 3).join(', ');
    const uptime = (await s.run('uptime')).stdoutPlain;
    expect(uptime).toMatch(/^ \d\d:\d\d:\d\d up 1 min, {2}1 user, {2}load average: /);
    expect(uptime.endsWith(load)).toBe(true);
    expect((await s.run('uptime -p')).stdoutPlain).toBe('up 1 minute');
    expect((await s.run('top -b -n 1')).stdoutPlain.split('\n')[0]).toMatch(/^top - \d\d:\d\d:\d\d up 1 min, {2}1 user, {2}load average: /);
    expect((await s.run('w -h')).stdoutPlain).toMatch(/^guest {4}pts\/0 {4}- {16}\d\d:\d\d {4}0\.00s {2}0\.00s {2}0\.00s w -h$/);
    s.stop();
  });

  it('words an uptime as procps does', () => {
    expect(upText(0)).toBe('0 min');
    expect(upText(59 * 60)).toBe('59 min');
    expect(upText(65 * 60)).toBe(' 1:05');
    expect(upText(86_400 + 300)).toBe('1 day, 5 min');
    expect(upText(3 * 86_400 + 3 * 3600 + 7 * 60)).toBe('3 days,  3:07');
    expect(prettyUptime(30)).toBe('up 0 minutes');
    expect(prettyUptime(3600 + 60)).toBe('up 1 hour, 1 minute');
    expect(prettyUptime(8 * 86_400 + 2 * 3600)).toBe('up 1 week, 1 day, 2 hours');
  });

  it('top says interactive top is not available, at the prompt only', async () => {
    expect((await runLine('top')).stdoutPlain).toContain("Interactive top isn't available in vesen");
    expect((await runLine('top -b')).stdoutPlain).not.toContain('Interactive');
    expect((await runLine('top', { tty: false })).stdoutPlain).not.toContain('Interactive');
    expect(await runLine('top -n 0', { tty: false })).toMatchObject({ status: 1, stderrPlain: "top: bad iterations argument '0'" });
  });
});

describe('free', () => {
  it('agrees with /proc/meminfo', async () => {
    const s = await session({ tty: false, sys: createSysInfo(ANDROID_PHONE().host) });
    const meminfo = new Map((await s.run('cat /proc/meminfo')).stdoutPlain.split('\n').map((line) => [line.split(':')[0], Number(/(\d+) kB/.exec(line)?.[1])]));
    const [, mem] = (await s.run('free')).stdoutPlain.split('\n');
    const [total, used, free, shared, cache, available] = (mem ?? '').split(/\s+/).slice(1).map(Number);
    expect(total).toBe(meminfo.get('MemTotal'));
    expect(free).toBe(meminfo.get('MemFree'));
    expect(shared).toBe(meminfo.get('Shmem'));
    expect(available).toBe(meminfo.get('MemAvailable'));
    expect(cache).toBe((meminfo.get('Buffers') ?? 0) + (meminfo.get('Cached') ?? 0));
    expect(used).toBe((total ?? 0) - (available ?? 0));
    s.stop();
  });

  it('writes sizes for people in four characters and an i', () => {
    expect(humanSize(0)).toBe('0B');
    expect(humanSize(1023)).toBe('1023B');
    expect(humanSize(5 * 1024 ** 3)).toBe('5.0Gi');
    expect(humanSize(31.6 * 1024 ** 3)).toBe('32Gi');
    expect(humanSize(285.3 * 1024 ** 2)).toBe('285Mi');
    expect(humanSize(1023.9 * 1024 ** 2)).toBe('1.0Gi');
  });
});

describe('nproc and lscpu', () => {
  it('count the cores the browser reports, as /proc/cpuinfo lists them', async () => {
    const sys = createSysInfo(WINDOWS_PC().host);
    const cores = String(sys.snapshot().cores);
    expect((await runLine('nproc', { tty: false, sys })).stdoutPlain).toBe(cores);
    expect((await runLine('nproc --ignore=100', { tty: false, sys })).stdoutPlain).toBe('1');
    const lscpu = (await runLine('lscpu', { tty: false, sys })).stdoutPlain;
    expect(lscpu).toMatch(new RegExp(`^CPU\\(s\\): +${cores}$`, 'm'));
    expect(lscpu).toMatch(/^Architecture: +x86_64$/m);
    expect(lscpu).toMatch(/^ {2}Model name: +vesen virtual CPU \(x86_64\)$/m);
  });
});

describe('locale', () => {
  it('follows $LANG, the LC_ variables and $LC_ALL, and lists the browser languages with -a', async () => {
    const plain = (await runLine('LC_TIME=en_GB.UTF-8 locale', { tty: false })).stdoutPlain;
    expect(plain).toContain('\nLC_TIME=en_GB.UTF-8\n');
    expect(plain).toContain('\nLC_NUMERIC="en_US.UTF-8"\n');
    expect((await runLine('LC_ALL=C locale', { tty: false })).stdoutPlain).toContain('\nLC_TIME="C"\n');
    const all = (await runLine('locale -a', { tty: false, sys: createSysInfo(ANDROID_PHONE().host) })).stdoutPlain.split('\n');
    expect(all[0]).toBe('C');
    expect(all[all.length - 1]).toBe('POSIX');
    expect(all).toContain('en_US.utf8');
    expect(all).toContain('nb_NO.utf8');
    expect(await runLine('locale nope', { tty: false })).toMatchObject({ status: 1, stderrPlain: 'locale: unknown name "nope"' });
  });
});

describe('ps and the process table', () => {
  it('lists init, the shell as $$, and the commands of the running line with their pids', async () => {
    const s = await session({ tty: false });
    const shell = (await s.run('echo $$')).stdoutPlain;
    // cat waits for what ps writes, so it is running while ps looks.
    const rows = (await s.run('ps -ef | cat')).stdoutPlain.split('\n');
    expect(rows[0]).toBe('UID          PID    PPID  C STIME TTY          TIME CMD');
    expect(rows[1]).toMatch(/^root {11}1 {7}0 {2}0 \d\d:\d\d \? {8}00:00:00 \/sbin\/init$/);
    expect(rows[2]).toMatch(new RegExp(`^guest {7}${shell} {7}1 .* -vesh$`));
    expect(rows).toHaveLength(5);
    const ps = /^guest +(\d+) +(\d+) .* ps -ef$/.exec(rows.find((row) => row.endsWith(' ps -ef')) ?? '');
    const cat = /^guest +(\d+) +(\d+) .* cat$/.exec(rows.find((row) => row.endsWith(' cat')) ?? '');
    expect(ps?.[2]).toBe(shell);
    expect(cat?.[2]).toBe(shell);
    // Each stage of the pipeline is a process of its own, given the next pids.
    expect(Math.abs(Number(cat?.[1]) - Number(ps?.[1]))).toBe(1);
    // Once the line has ended, nothing of it is left.
    expect((await s.run('ps -e')).stdoutPlain.split('\n')).toHaveLength(4);
    s.stop();
  });

  it('gives what a command runs (time, timeout) that command as its parent', async () => {
    const rows = (await runLine('timeout 5 ps -f', { tty: false })).stdoutPlain.split('\n');
    const timeout = /^guest +(\d+) .* timeout 5 ps -f$/.exec(rows.find((row) => row.endsWith('timeout 5 ps -f')) ?? '');
    const ps = /^guest +\d+ +(\d+) .* ps -f$/.exec(rows[rows.length - 1] ?? '');
    expect(ps?.[1]).toBe(timeout?.[1]);
  });

  it('reads BSD options, Unix options and bare pids, and refuses others', async () => {
    expect((await runLine('ps 1', { tty: false })).stdoutPlain).toBe('    PID TTY          TIME CMD\n      1 ?        00:00:00 init');
    expect((await runLine('ps -u root', { tty: false })).stdoutPlain.split('\n')).toHaveLength(2);
    expect((await runLine('ps a', { tty: false })).stdoutPlain).not.toContain('init');
    expect((await runLine('ps ax', { tty: false })).stdoutPlain).toContain('init');
    expect(await runLine('ps q', { tty: false })).toMatchObject({ status: 1, stderrPlain: "error: unsupported option (BSD syntax)\nTry 'ps --help' for more information." });
  });

  it("prints procps' BSD formats: ax and axu every process, x all of yours, a every one with a terminal", async () => {
    const run = async (line: string): Promise<string[]> => (await runLine(line, { tty: false })).stdoutPlain.split('\n');
    const bsd = '    PID TTY      STAT   TIME COMMAND';
    expect(await run('ps ax')).toEqual([bsd, '      1 ?        Ss     0:00 /sbin/init', '   4242 pts/0    Ss     0:00 -vesh', '   4243 pts/0    R+     0:00 ps ax']);
    expect(await run('ps x')).toEqual([bsd, '   4242 pts/0    Ss     0:00 -vesh', '   4243 pts/0    R+     0:00 ps x']);
    expect(await run('ps a')).toEqual([bsd, '   4242 pts/0    Ss     0:00 -vesh', '   4243 pts/0    R+     0:00 ps a']);
    const user = [
      'USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND',
      'root           1  0.0  0.1 167812 11904 ?        Ss   20:00   0:00 /sbin/init',
      'guest       4242  0.0  0.1   8916  5248 pts/0    Ss   20:00   0:00 -vesh',
    ];
    expect(await run('ps aux')).toEqual([...user, 'guest       4243  0.0  0.0   8714  1993 pts/0    R+   20:01   0:00 ps aux']);
    expect(await run('ps axu')).toEqual([...user, 'guest       4243  0.0  0.0   8714  1993 pts/0    R+   20:01   0:00 ps axu']);
  });

  it('prints the Unix formats: -e (and -A) every process by name, -ef the full format', async () => {
    const run = async (line: string): Promise<string[]> => (await runLine(line, { tty: false })).stdoutPlain.split('\n');
    const every = ['    PID TTY          TIME CMD', '      1 ?        00:00:00 init', '   4242 pts/0    00:00:00 vesh', '   4243 pts/0    00:00:00 ps'];
    expect(await run('ps -e')).toEqual(every);
    expect(await run('ps -A')).toEqual(every);
    expect(await run('ps -ef')).toEqual([
      'UID          PID    PPID  C STIME TTY          TIME CMD',
      'root           1       0  0 20:00 ?        00:00:00 /sbin/init',
      'guest       4242       1  0 20:00 pts/0    00:00:00 -vesh',
      'guest       4243    4242  0 20:01 pts/0    00:00:00 ps -ef',
    ]);
  });

  it('takes -o and -eo column lists: every keyword, its other names, NAME= and NAME=HEADING', async () => {
    const run = async (line: string): Promise<string[]> => (await runLine(line, { tty: false })).stdoutPlain.split('\n');
    expect(await run('ps -o pid,ppid,user,uid,tty,stat,time,etime,start,%cpu,%mem,vsz,rss,comm,args')).toEqual([
      '    PID    PPID USER       UID TT       STAT     TIME     ELAPSED  STARTED %CPU %MEM    VSZ   RSS COMMAND         COMMAND',
      '   4242       1 guest     1000 pts/0    Ss   00:00:00       01:00 20:00:00  0.0  0.1   8916  5248 vesh            -vesh',
      '   4243    4242 guest     1000 pts/0    R+   00:00:00       00:00 20:01:00  0.0  0.0   8714  1993 ps              ps -o pid,ppid,user,uid,tty,stat,time,etime,start,%cpu,%mem,vsz,rss,comm,args',
    ]);
    // procps' other names for the same columns, and a list with spaces.
    expect(await run("ps -p 1 -o 'pcpu pmem command ucmd ucomm tname tt uname euser euid cputime vsize rssize stime'")).toEqual([
      '%CPU %MEM COMMAND                     COMMAND         COMMAND         TT       TT       USER     USER       UID     TIME    VSZ   RSS  STARTED',
      ' 0.0  0.1 /sbin/init                  init            init            ?        ?        root     root         0 00:00:00 167812 11904 20:00:00',
    ]);
    expect(await run('ps -eo pid,cmd')).toEqual(['    PID CMD', '      1 /sbin/init', '   4242 -vesh', '   4243 ps -eo pid,cmd']);
    expect(await run('ps --format=pid,comm -p 4242')).toEqual(['    PID COMMAND', '   4242 vesh']);
    // NAME= leaves out the heading, and no headings leaves out the heading line; NAME=HEADING renames it.
    expect(await run('ps -p $$ -o comm=')).toEqual(['vesh']);
    expect(await run('ps -o pid=PROCESS -p 1')).toEqual(['PROCESS', '      1']);
    expect(await runLine('ps -o bogus', { tty: false })).toMatchObject({ status: 1, stderrPlain: 'error: unknown user-defined format specifier "bogus"\nTry \'ps --help\' for more information.' });
    expect(await runLine('ps -o', { tty: false })).toMatchObject({ status: 1, stderrPlain: "error: format specification must follow -o\nTry 'ps --help' for more information." });
  });

  it('agrees with /proc: one table, with init as pid 1, the shell as $$ and each command a folder while it runs', async () => {
    const s = await session({ tty: false });
    expect((await s.run('echo $$')).stdoutPlain).toBe('4242');
    // /proc/1 is init, root's, and /proc/$$ is the shell, with the memory ps gives them.
    expect((await s.run('cat /proc/1/status')).stdoutPlain).toMatch(/^Name:\tinit\nState:\tS \(sleeping\)\nPid:\t1\nPPid:\t0\nUid:\t0\t0\t0\t0\n/);
    expect((await s.run('cat /proc/$$/status')).stdoutPlain).toMatch(/^Name:\tvesh\nState:\tS \(sleeping\)\nPid:\t4242\nPPid:\t1\nUid:\t1000\t1000\t1000\t1000\n/);
    const memory = (await s.run('ps -o pid= -o vsz= -o rss= -p 1,$$')).stdoutPlain.split('\n').map((row) => row.trim().split(/\s+/));
    expect(memory).toEqual([
      ['1', '167812', '11904'],
      ['4242', '8916', '5248'],
    ]);
    for (const [pid, vsz, rss] of memory) {
      expect((await s.run(`grep -E '^Vm' /proc/${pid ?? ''}/status`)).stdoutPlain.split('\n').map((row) => row.split(/\s+/)[1])).toEqual([vsz, rss]);
    }
    expect((await s.run('cat /proc/$$/cmdline /proc/1/comm')).stdoutPlain).toBe('-vesh\0init');
    // /proc/self is the command reading it: running, a child of the shell, and gone once it ends.
    const self = (await s.run('cat /proc/self/status')).stdoutPlain;
    expect(self).toMatch(/^Name:\tcat\nState:\tR \(running\)\nPid:\t(\d+)\nPPid:\t4242\n/);
    const pid = /^Pid:\t(\d+)$/m.exec(self)?.[1] ?? '';
    expect(await s.run(`ls /proc/${pid}`)).toMatchObject({ status: 2, stderrPlain: `ls: cannot access '/proc/${pid}': No such file or directory` });
    expect(await s.run(`ps -p ${pid}`)).toMatchObject({ status: 1 });
    // ls sees itself in /proc as ps sees itself in its table; the rest of the line too.
    const listed = (await s.run('ls -l /proc | cat')).stdoutPlain.split('\n');
    const reader = /self -> (\d+)$/.exec(listed.find((row) => row.includes(' self -> ')) ?? '')?.[1] ?? '';
    const folders = listed.filter((row) => /^dr-xr-xr-x .* \d+$/.test(row)).map((row) => row.split(' ').pop());
    // init, the shell, ls and cat, the pipeline's two stages given pids one apart.
    expect(folders.slice(0, 2)).toEqual(['1', '4242']);
    expect(folders).toHaveLength(4);
    expect(folders).toContain(reader);
    expect(Math.abs(Number(folders[2]) - Number(folders[3]))).toBe(1);
    const rows = (await s.run('ps -e -o pid= -o comm= | cat')).stdoutPlain.split('\n').map((row) => row.trim());
    expect(rows.slice(0, 2)).toEqual(['1 init', '4242 vesh']);
    expect(rows.slice(2).map((row) => row.split(' ')[1]).sort()).toEqual(['cat', 'ps']);
    expect((await s.run('pgrep -x vesh; pgrep -x init')).stdoutPlain).toBe('4242\n1');
    expect((await s.run('cat /proc/loadavg')).stdoutPlain).toMatch(/ 1\/3 \d+$/);
    s.stop();
  });

  it("puts tty's terminal in /dev, as ps names it", async () => {
    expect(await runLine('tty')).toMatchObject({ status: 0, stdoutPlain: '/dev/pts/0' });
    const s = await session({ tty: false });
    expect((await s.run('ls -l /dev/pts')).stdoutPlain).toBe('total 0\ncrw--w---- 1 guest tty 136, 0 Oct  6 11:00 0');
    expect((await s.run('test -c /dev/pts/0 && echo a terminal')).stdoutPlain).toBe('a terminal');
    expect((await s.run('ps -o tty= -p $$')).stdoutPlain).toBe('pts/0');
    expect((await s.run('echo hidden > /dev/pts/0; echo $?')).stdoutPlain).toBe('0');
    s.stop();
  });

  it('pkill ends the line its process is part of, as ^C would', async () => {
    const result = await runLine('sleep 5 | pkill -e sleep; echo not reached');
    expect(result.status).toBe(130);
    expect(result.stdoutPlain).toMatch(/^sleep killed \(pid \d+\)/);
    expect(result.stdoutPlain).not.toContain('not reached');
  });

  it('kill -9 $$ ends the session, as a hangup does, and the next line starts a new one', async () => {
    const s = await session();
    const killed = await s.run('kill -9 $$');
    expect(killed.status).toBe(137);
    expect(killed.stdoutPlain).toContain('[Process completed]');
    expect((await s.run('kill $$; kill -INT $$; echo still here')).stdoutPlain).toBe('still here');
    s.stop();
  });
});

describe('dmesg', () => {
  it('tells how vesen booted on this device, then what the syslog kept', async () => {
    const lines = (await runLine('dmesg -t', { tty: false, sys: createSysInfo(ANDROID_PHONE().host) })).stdoutPlain.split('\n');
    expect(lines[0]).toMatch(/^Linux version 6\.6\.0-vesen /);
    expect(lines.find((line) => line.startsWith('DMI: '))).toMatch(/^DMI: Chrome [\d.]+ on Android/);
    expect(lines[lines.length - 1]).toBe('systemd[1]: Reached target Multi-User System.');
    // The syslog's kernel line is the boot's own first line, so it is not said twice.
    expect(lines.filter((line) => line.startsWith('Linux version'))).toHaveLength(1);
  });
});

describe('finger', () => {
  it("shows the owner's plan and about.md, with links on the terminal", async () => {
    const { status, blocks } = await runLine('finger has');
    expect(status).toBe(0);
    const spans = linesOf(blocks).flatMap((block) => block.lines.flat());
    expect(spans.find((span) => span.text === 'https://www.vesen.app')?.href).toBe('https://www.vesen.app/');
    expect(spans.find((span) => span.text === 'mailto:has@salvesen.app')?.href).toBe('mailto:has@salvesen.app');
    expect(spans.some((span) => span.text.startsWith('Plan:'))).toBe(true);
    const plain = (await runLine('finger -m Salvesen has', { tty: false })).stdoutPlain;
    expect(plain).toMatch(/^Login: has {29}Name: Has Salvesen$/m);
    expect((await runLine('finger -m Salvesen', { tty: false })).stderrPlain).toBe('finger: Salvesen: no such user.');
    // After the owner's plan, chips to reach him.
    expect(finger.next?.({ status: 0, argv: ['finger', 'has'] })).toEqual(['about', 'contact']);
    expect(finger.next?.({ status: 1, argv: ['finger', 'bob'] })).toEqual([]);
  });
});

describe('cal', () => {
  it('lays out a month, Sunday or Monday first, Gregorian all the way back', () => {
    expect(dayOfWeek(2026, 10, 1)).toBe(4);
    expect(dayOfWeek(1752, 9, 14)).toBe(4);
    expect(dayOfWeek(1, 1, 1)).toBe(1);
    expect(daysIn(2024, 2)).toBe(29);
    expect(daysIn(1900, 2)).toBe(28);
    expect(daysIn(2000, 2)).toBe(29);
    const text = (monday: boolean): string[] => monthRows(2027, 2, { monday, mark: null, withYear: true }).map((row) => row.map((piece) => piece.text).join(''));
    expect(text(true)).toEqual([
      '   February 2027    ',
      'Mo Tu We Th Fr Sa Su',
      ' 1  2  3  4  5  6  7',
      ' 8  9 10 11 12 13 14',
      '15 16 17 18 19 20 21',
      '22 23 24 25 26 27 28',
    ]);
    expect(text(false)[2]).toBe('    1  2  3  4  5  6');
  });

  it('picks out today in the accent colour on the terminal, and not in a pipe', async () => {
    // The harness's clock reads 2026-10-06 in Sydney.
    const { blocks } = await runLine('cal');
    const today = linesOf(blocks).flatMap((block) => block.lines.flat()).filter((span) => span.style?.fg === 'accent');
    expect(today.map((span) => span.text)).toEqual([' 6']);
    expect((await runLine('cal -3')).blocks.flatMap((block) => (block.type === 'lines' ? block.lines.flat() : [])).filter((span) => span.style?.fg === 'accent')).toHaveLength(1);
    expect((await runLine('cal 25 12 2026', { tty: false })).stdoutPlain.split('\n')[0]).toBe('   December 2026');
    const marked = linesOf((await runLine('cal 25 12 2026')).blocks).flatMap((block) => block.lines.flat()).filter((span) => span.style?.fg === 'accent');
    expect(marked.map((span) => span.text)).toEqual(['25']);
  });

  it('takes a month by name, a year alone as the whole year, and refuses what is not a date', async () => {
    expect((await runLine('cal feb 2028', { tty: false })).stdoutPlain).toContain('   February 2028\n');
    expect((await runLine('cal 2027', { tty: false })).stdoutPlain.split('\n')[0]?.trim()).toBe('2027');
    expect(await runLine('cal 31 2 2026', { tty: false })).toMatchObject({ status: 1, stderrPlain: 'cal: illegal day value: use 1-31' });
    expect(await runLine('cal 1 2 3 4', { tty: false })).toMatchObject({ status: 1 });
  });
});
