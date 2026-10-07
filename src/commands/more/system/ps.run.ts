// The body of ps; its spec, in ps.ts, loads this the first time ps runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { memPercent, processTable, TERMINAL, type Proc } from '../../lib/procs';
import { two, wallClock } from '../../lib/sysread';

/** What --help, help and man say about ps, besides its spec (ps.ts). */
export const doc: CommandDoc = {
  description:
    "Prints the processes running now. vesen runs one line at a time, so there are only a few: init (pid 1), the shell vesh (pid $$, the same as `echo $$`), and the commands of the line you typed, each with its own pid, ps among them. With no option, the processes on your terminal; -e (or -A) or BSD's ax, every one; BSD's a, every one with a terminal; x, all of yours. -f gives the full format, with the parent's pid and the start time, and BSD's u the user format, with memory. -p and -u pick processes by pid or user, and a bare number is a pid too. A command's processor time is not measured, so TIME and %CPU are 0.",
  man: [{ heading: 'EXIT STATUS', body: '0 when it listed a process, 1 when none matched, 1 for an option it does not know.' }],
};

interface Options {
  all: boolean;
  /** BSD a: every process with a terminal. */
  withTty: boolean;
  /** BSD x: processes with no terminal too. */
  noTty: boolean;
  full: boolean;
  user: boolean;
  pids: number[];
  users: string[];
}

class PsError extends Error {}

/** Reads ps's words: Unix options with a dash, BSD options without, and bare pids. */
function parse(words: readonly string[]): Options {
  const o: Options = { all: false, withTty: false, noTty: false, full: false, user: false, pids: [], users: [] };
  const list = (value: string | undefined, what: string): string[] => {
    if (value === undefined || value === '') throw new PsError(`list of ${what} must follow -${what === 'process IDs' ? 'p' : 'u'}`);
    return value.split(/[,\s]+/).filter((item) => item !== '');
  };
  const pids = (value: string | undefined): number[] =>
    list(value, 'process IDs').map((item) => {
      if (!/^\d+$/.test(item)) throw new PsError('process ID list syntax error');
      return Number(item);
    });
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? '';
    if (/^\d+(,\d+)*$/.test(word)) {
      o.pids.push(...pids(word));
    } else if (word.startsWith('--')) {
      const [name, value] = word.slice(2).split('=', 2);
      if (name === 'pid') o.pids.push(...pids(value ?? words[++i]));
      else if (name === 'user') o.users.push(...list(value ?? words[++i], 'users'));
      else throw new PsError(`unknown gnu long option`);
    } else if (word.startsWith('-')) {
      for (let k = 1; k < word.length; k += 1) {
        const c = word.charAt(k);
        if (c === 'e' || c === 'A') o.all = true;
        else if (c === 'f') o.full = true;
        else if (c === 'p' || c === 'u' || c === 'U') {
          const rest = word.slice(k + 1);
          const value = rest !== '' ? rest : words[++i];
          if (c === 'p') o.pids.push(...pids(value));
          else o.users.push(...list(value, 'users'));
          break;
        } else throw new PsError('unsupported SysV option');
      }
    } else {
      for (const c of word) {
        if (c === 'a') o.withTty = true;
        else if (c === 'x') o.noTty = true;
        else if (c === 'u') o.user = true;
        else if (c !== 'w' && c !== 'e') throw new PsError('unsupported option (BSD syntax)');
      }
    }
  }
  return o;
}

function select(o: Options, rows: readonly Proc[], me: string): Proc[] {
  if (o.pids.length > 0 || o.users.length > 0) {
    return rows.filter((row) => o.pids.includes(row.pid) || o.users.includes(row.user) || o.users.includes(String(row.uid)));
  }
  if (o.all || (o.withTty && o.noTty)) return [...rows];
  if (o.withTty) return rows.filter((row) => row.tty !== '?');
  if (o.noTty) return rows.filter((row) => row.user === me);
  return rows.filter((row) => row.tty === TERMINAL && row.user === me);
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  let o: Options;
  try {
    o = parse(ctx.args);
  } catch (error) {
    if (!(error instanceof PsError)) throw error;
    return ctx.usage(`error: ${error.message}`);
  }
  const rows = select(o, processTable(ctx), ctx.user.name);
  const hhmm = (ms: number): string => {
    const t = wallClock(ctx, ms);
    return `${two(t.hour)}:${two(t.minute)}`;
  };
  const lines: string[] = [];
  if (o.user) {
    lines.push('USER         PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND');
    for (const row of rows) {
      const mem = memPercent(ctx, row.rss).toFixed(1);
      lines.push(
        `${row.user.padEnd(8)} ${String(row.pid).padStart(7)}  0.0 ${mem.padStart(4)} ${String(row.vsz).padStart(6)} ${String(row.rss).padStart(5)} ${row.tty.padEnd(8)} ${row.stat.padEnd(4)} ${hhmm(row.startedAt)}   0:00 ${row.args}`,
      );
    }
  } else if (o.full) {
    lines.push('UID          PID    PPID  C STIME TTY          TIME CMD');
    for (const row of rows) {
      lines.push(`${row.user.padEnd(8)} ${String(row.pid).padStart(7)} ${String(row.ppid).padStart(7)}  0 ${hhmm(row.startedAt)} ${row.tty.padEnd(8)} 00:00:00 ${row.args}`);
    }
  } else {
    lines.push('    PID TTY          TIME CMD');
    for (const row of rows) lines.push(`${String(row.pid).padStart(7)} ${row.tty.padEnd(8)} 00:00:00 ${row.comm}`);
  }
  await ctx.stdout.write(`${lines.join('\n')}\n`);
  return rows.length > 0 ? 0 : 1;
}
