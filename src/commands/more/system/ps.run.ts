// The body of ps; its spec, in ps.ts, loads this the first time ps runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { memPercent, processTable, TERMINAL, type Proc } from '../../lib/procs';
import { two, wallClock } from '../../lib/sysread';
import { writeTable } from '../../lib/table-out';

/** A column -o can ask for: its heading, its width, which side it lines up on, and its value. */
interface Column {
  readonly head: string;
  readonly width: number;
  readonly right: boolean;
  readonly value: (row: Proc, at: Clock) => string;
}

/** What a column's value may need besides the row. */
interface Clock {
  readonly now: number;
  hms(ms: number): string;
  memory(rss: number): string;
}

const ARGS: Column = { head: 'COMMAND', width: 27, right: false, value: (row) => row.args };
const COMM: Column = { head: 'COMMAND', width: 15, right: false, value: (row) => row.comm };

/** procps' names for the columns the process table has, with their headings and widths. */
const COLUMNS: Readonly<Record<string, Column>> = {
  pid: { head: 'PID', width: 7, right: true, value: (row) => String(row.pid) },
  ppid: { head: 'PPID', width: 7, right: true, value: (row) => String(row.ppid) },
  user: { head: 'USER', width: 8, right: false, value: (row) => row.user },
  uid: { head: 'UID', width: 5, right: true, value: (row) => String(row.uid) },
  tty: { head: 'TT', width: 8, right: false, value: (row) => row.tty },
  stat: { head: 'STAT', width: 4, right: false, value: (row) => row.stat },
  time: { head: 'TIME', width: 8, right: true, value: () => '00:00:00' },
  etime: {
    head: 'ELAPSED',
    width: 11,
    right: true,
    value: (row, at) => {
      const seconds = Math.max(0, Math.floor((at.now - row.startedAt) / 1000));
      const h = Math.floor(seconds / 3600);
      const ms = `${two(Math.floor(seconds / 60) % 60)}:${two(seconds % 60)}`;
      return h > 0 ? `${two(h)}:${ms}` : ms;
    },
  },
  start: { head: 'STARTED', width: 8, right: true, value: (row, at) => at.hms(row.startedAt) },
  '%cpu': { head: '%CPU', width: 4, right: true, value: () => '0.0' },
  '%mem': { head: '%MEM', width: 4, right: true, value: (row, at) => at.memory(row.rss) },
  vsz: { head: 'VSZ', width: 6, right: true, value: (row) => String(row.vsz) },
  rss: { head: 'RSS', width: 5, right: true, value: (row) => String(row.rss) },
  comm: COMM,
  args: ARGS,
  cmd: { ...ARGS, head: 'CMD' },
};

/** Other names procps knows for the same columns. */
const ALIASES: Readonly<Record<string, string>> = {
  pcpu: '%cpu',
  pmem: '%mem',
  command: 'args',
  ucmd: 'comm',
  ucomm: 'comm',
  tname: 'tty',
  tt: 'tty',
  uname: 'user',
  euser: 'user',
  euid: 'uid',
  cputime: 'time',
  vsize: 'vsz',
  rssize: 'rss',
  stime: 'start',
};

/** What --help, help and man say about ps, besides its spec (ps.ts). */
export const doc: CommandDoc = {
  description:
    "Prints the processes running now. vesen runs one line at a time, so there are only a few: init (pid 1), the shell vesh (pid $$, the same as `echo $$`), and the commands of the line you typed, each with its own pid, ps among them. With no option, the processes on your terminal; -e (or -A) or BSD's ax, every one; BSD's a, every one with a terminal; x, all of yours. -f gives the full format, with the parent's pid and the start time; BSD's words without u (ax, x, a) the BSD format, with STAT and the whole command; and BSD's u the user format, with memory. -o (or --format) picks the columns, as in ps -o pid,comm or ps -p $$ -o comm=. -p and -u pick processes by pid or user, and a bare number is a pid too. A command's processor time is not measured, so TIME and %CPU are 0.",
  man: [
    {
      heading: 'OUTPUT FORMAT',
      body: `-o takes column names separated by commas or spaces: ${Object.keys(COLUMNS).join(', ')}. NAME= gives a column no heading, or the heading after the =, and when no column has one the heading line is left out.`,
    },
    { heading: 'EXIT STATUS', body: '0 when it listed a process, 1 when none matched, 1 for an option it does not know.' },
  ],
};

/** A column -o asked for, with its heading as given (NAME=HEADING), or the column's own. */
interface Field {
  readonly column: Column;
  readonly head: string;
}

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
  /** A BSD word (without a dash) was given: ax, x, a. */
  bsd: boolean;
  /** -o's columns, in order; empty for none. */
  format: Field[];
}

class PsError extends Error {}

/** Reads one -o list: `pid,comm`, `pid comm`, or `comm=` and `comm=NAME` (the rest of the list). */
function readFormat(text: string | undefined): Field[] {
  if (text === undefined) throw new PsError('format specification must follow -o');
  const fields: Field[] = [];
  let rest = text.trim();
  while (rest !== '') {
    const match = /^([^,\s=]+)(=)?/.exec(rest);
    if (match === null) {
      rest = rest.replace(/^[,\s]+/, '');
      continue;
    }
    const name = (match[1] ?? '').toLowerCase();
    const column = COLUMNS[ALIASES[name] ?? name];
    if (column === undefined) throw new PsError(`unknown user-defined format specifier "${match[1] ?? ''}"`);
    if (match[2] !== undefined) {
      // NAME=HEADING takes the rest of the list as the heading, as procps reads it.
      fields.push({ column, head: rest.slice(match[0].length) });
      break;
    }
    fields.push({ column, head: column.head });
    rest = rest.slice(match[0].length).replace(/^[,\s]+/, '');
  }
  if (fields.length === 0) throw new PsError('format specification must follow -o');
  return fields;
}

/** Reads ps's words: Unix options with a dash, BSD options without, and bare pids. */
function parse(words: readonly string[]): Options {
  const o: Options = { all: false, withTty: false, noTty: false, full: false, user: false, pids: [], users: [], bsd: false, format: [] };
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
      else if (name === 'format') o.format.push(...readFormat(value ?? words[++i]));
      else throw new PsError(`unknown gnu long option`);
    } else if (word.startsWith('-')) {
      for (let k = 1; k < word.length; k += 1) {
        const c = word.charAt(k);
        if (c === 'e' || c === 'A') o.all = true;
        else if (c === 'f') o.full = true;
        else if (c === 'p' || c === 'u' || c === 'U' || c === 'o') {
          const rest = word.slice(k + 1);
          const value = rest !== '' ? rest : words[++i];
          if (c === 'p') o.pids.push(...pids(value));
          else if (c === 'o') o.format.push(...readFormat(value));
          else o.users.push(...list(value, 'users'));
          break;
        } else throw new PsError('unsupported SysV option');
      }
    } else {
      o.bsd = true;
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

/** The table -o asks for: each column padded to its width (the last only on the right), as procps lays it out. */
function custom(fields: readonly Field[], rows: readonly Proc[], at: Clock): string[] {
  const cell = (field: Field, text: string, last: boolean): string => {
    if (field.column.right) return text.padStart(field.column.width);
    return last ? text : text.padEnd(field.column.width);
  };
  const line = (texts: readonly string[]): string => texts.map((text, i) => cell(fields[i] as Field, text, i === texts.length - 1)).join(' ');
  const lines: string[] = [];
  if (fields.some((field) => field.head !== '')) lines.push(line(fields.map((field) => field.head)));
  for (const row of rows) lines.push(line(fields.map((field) => field.column.value(row, at))));
  return lines;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  let o: Options;
  try {
    o = parse(ctx.args);
  } catch (error) {
    if (!(error instanceof PsError)) throw error;
    // procps says it with no name in front.
    await ctx.stderr.write(`error: ${error.message}\n`);
    return ctx.usage();
  }
  const rows = select(o, processTable(ctx), ctx.user.name);
  const hhmm = (ms: number): string => {
    const t = wallClock(ctx, ms);
    return `${two(t.hour)}:${two(t.minute)}`;
  };
  const lines: string[] = [];
  if (o.format.length > 0) {
    const at: Clock = {
      now: ctx.clock.now(),
      hms: (ms) => {
        const t = wallClock(ctx, ms);
        return `${two(t.hour)}:${two(t.minute)}:${two(t.second)}`;
      },
      memory: (rss) => memPercent(ctx, rss).toFixed(1),
    };
    lines.push(...custom(o.format, rows, at));
  } else if (o.user) {
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
  } else if (o.bsd) {
    // procps' BSD format: the state, the time as M:SS and the whole command.
    lines.push('    PID TTY      STAT   TIME COMMAND');
    for (const row of rows) lines.push(`${String(row.pid).padStart(7)} ${row.tty.padEnd(8)} ${row.stat.padEnd(6)} 0:00 ${row.args}`);
  } else {
    lines.push('    PID TTY          TIME CMD');
    for (const row of rows) lines.push(`${String(row.pid).padStart(7)} ${row.tty.padEnd(8)} 00:00:00 ${row.comm}`);
  }
  if (lines.length > 0) await writeTable(ctx, `${lines.join('\n')}\n`);
  return rows.length > 0 ? 0 : 1;
}
