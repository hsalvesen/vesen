// The process table that ps, top, kill, pgrep and pkill share, read from the shell's one table
// (ShellApi.processes), which /proc's numbered folders show too: init (pid 1), the shell (vesh,
// pid $$) and the commands of the line running now, each with the pid the kernel gave it. vesen
// runs one line at a time, so there is nothing else to show.

import { out } from '../../output/model';
import { ExitRequest, type CommandContext, type ExitCode } from '../../shell/types';
import { SHELL_PID, TERMINAL } from '../../vfs/identity';
import { commOf, memoryOf } from '../../vfs/special';
import { memInfo, type SysContext } from './sysread';

export { SHELL_PID, TERMINAL };

/** One row of the table. */
export interface Proc {
  readonly pid: number;
  readonly ppid: number;
  readonly user: string;
  readonly uid: number;
  /** `?` for a process with no terminal, as init has none. */
  readonly tty: string;
  /** ps's STAT: `Ss` a sleeping session leader, `S+` sleeping in the foreground, `R+` running. */
  readonly stat: string;
  readonly startedAt: number;
  /** The name, as ps -e and pgrep show it. */
  readonly comm: string;
  /** The whole command line, as ps aux and pgrep -a show it. */
  readonly args: string;
  /** Virtual and resident memory, in KiB, as /proc/PID/status gives them. */
  readonly vsz: number;
  readonly rss: number;
  /** The command asking: ps itself, which a pgrep leaves out. */
  readonly self: boolean;
}

/**
 * Every process, by pid: init, the shell, then the line's commands. init is root's and has no
 * terminal; init and the shell lead their sessions; the asking command is the one running.
 */
export function processTable(ctx: Pick<CommandContext, 'shell' | 'user'>): Proc[] {
  const me = ctx.shell.pid();
  return ctx.shell
    .processes()
    .map((info) => {
      const root = info.uid === 0;
      const self = info.pid === me;
      const leader = info.pid === 1 || info.pid === SHELL_PID;
      return {
        pid: info.pid,
        ppid: info.ppid,
        user: root ? 'root' : ctx.user.name,
        uid: info.uid,
        tty: root ? '?' : TERMINAL,
        stat: leader ? 'Ss' : self ? 'R+' : 'S+',
        startedAt: info.startedAt,
        comm: commOf(info),
        args: info.argv.join(' '),
        ...memoryOf(info),
        self,
      };
    })
    .sort((a, b) => a.pid - b.pid);
}

/** A process's share of memory, as %MEM shows it. */
export function memPercent(ctx: SysContext, rss: number): number {
  const total = memInfo(ctx).get('MemTotal') ?? 0;
  return total > 0 ? (rss / total) * 100 : 0;
}

// ── Signals ────────────────────────────────────────────────────────────────────────────────

/** Linux's signals 1 to 31, by number, without the SIG. */
export const SIGNALS: readonly string[] = [
  '', 'HUP', 'INT', 'QUIT', 'ILL', 'TRAP', 'ABRT', 'BUS', 'FPE', 'KILL', 'USR1', 'SEGV', 'USR2', 'PIPE', 'ALRM', 'TERM',
  'STKFLT', 'CHLD', 'CONT', 'STOP', 'TSTP', 'TTIN', 'TTOU', 'URG', 'XCPU', 'XFSZ', 'VTALRM', 'PROF', 'WINCH', 'IO', 'PWR', 'SYS',
];

const OTHER_NAMES: Readonly<Record<string, number>> = { IOT: 6, CLD: 17, POLL: 29 };

/** A signal's number from `9`, `KILL`, `SIGKILL` or `kill`; null for none. */
export function signalNumber(spec: string): number | null {
  if (/^\d+$/.test(spec)) {
    const n = Number(spec);
    return n >= 0 && n < SIGNALS.length ? n : null;
  }
  const name = spec.toUpperCase().replace(/^SIG/, '');
  const index = SIGNALS.indexOf(name);
  if (index > 0) return index;
  return OTHER_NAMES[name] ?? null;
}

/** `KILL` for 9; `0` for 0, the signal that only asks whether a process is there. */
export function signalName(n: number): string {
  return n === 0 ? '0' : (SIGNALS[n] ?? String(n));
}

/** What happened to a signal sent to one process. */
export type Sent = 'sent' | 'denied' | 'missing' | 'shell';

/**
 * Sends `signal` to `pid`: init is root's and refuses; the shell ignores what an interactive
 * shell ignores, and HUP or KILL end its session ('shell': the caller ends it with endSession);
 * a command of the running line ends that line, as ^C does; signal 0 only asks.
 */
export function sendSignal(ctx: Pick<CommandContext, 'shell'>, pid: number, signal: number): Sent {
  if (pid === 1) return 'denied';
  if (pid === SHELL_PID) return signal === 1 || signal === 9 ? 'shell' : 'sent';
  if (!ctx.shell.processes().some((info) => info.pid === pid)) return 'missing';
  if (signal !== 0) ctx.shell.kill(pid);
  return 'sent';
}

/**
 * Ends the session as a hangup or SIGKILL ends a shell: at the prompt, `[Process completed]`
 * and a chip that starts a new one, as exit shows; status 128 plus the signal.
 */
export async function endSession(ctx: CommandContext, signal: number): Promise<ExitCode> {
  if (ctx.tty.interactive && ctx.stdout.isTTY) {
    await ctx.stdout.block(out.lines([[], [out.span('[Process completed]', { fg: 'muted' })]]));
    await ctx.stdout.block(out.chips([{ label: 'Start a new session', action: out.action.run('login') }]));
  }
  throw new ExitRequest(128 + signal);
}
