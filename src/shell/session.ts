// The state one shell session keeps between lines (docs/plan/designs/shell-architecture.md,
// section 6): variables with their export flags, aliases, command history, the current folder,
// the last status, options such as noclobber, and the running job. The stores follow the Svelte
// store contract (./observable.ts), so the UI can subscribe to them.

import { STORAGE_KEYS, STORAGE_LIMITS } from '../services/storage-keys';
import type { KV } from '../services/types';
import { readonly, writable, type Readable, type Subscriber, type Unsubscriber, type Writable } from './observable';
import {
  GUEST,
  PROMPT_HOST,
  type Env,
  type ExitCode,
  type HistoryApi,
  type HistoryEntry,
  type JobInfo,
  type ShellOptionFlags,
  type User,
} from './types';

// ── Variables ──────────────────────────────────────────────────────────────────────────────

interface Variable {
  /** Undefined for a name that is exported but not yet set: `export X` before `X=5`. */
  value: string | undefined;
  exported: boolean;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** True for a name a variable may have. */
export function isVariableName(name: string): boolean {
  return NAME.test(name);
}

/** Shell variables, each exported (seen by commands in their env) or local to the shell. */
export class ShellEnv implements Env {
  private readonly vars = new Map<string, Variable>();

  constructor(initial: Iterable<readonly [string, string, boolean]> = []) {
    for (const [name, value, exported] of initial) this.vars.set(name, { value, exported });
  }

  get(name: string): string | undefined {
    return this.vars.get(name)?.value;
  }

  set(name: string, value: string, options: { export?: boolean } = {}): void {
    const before = this.vars.get(name);
    this.vars.set(name, { value, exported: options.export ?? before?.exported ?? false });
  }

  unset(name: string): void {
    this.vars.delete(name);
  }

  isExported(name: string): boolean {
    return this.vars.get(name)?.exported ?? false;
  }

  markExported(name: string, exported: boolean): void {
    const before = this.vars.get(name);
    if (before !== undefined) before.exported = exported;
    else if (exported) this.vars.set(name, { value: undefined, exported: true });
  }

  entries(exportedOnly = false): [string, string][] {
    const listed: [string, string][] = [];
    for (const [name, variable] of this.vars) {
      if (variable.value === undefined || (exportedOnly && !variable.exported)) continue;
      listed.push([name, variable.value]);
    }
    return listed.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }

  child(overrides: Readonly<Record<string, string>> = {}): ShellEnv {
    const copy = new ShellEnv();
    for (const [name, v] of this.vars) copy.vars.set(name, { value: v.value, exported: v.exported });
    for (const name of Object.keys(overrides)) {
      const value = overrides[name];
      if (value !== undefined) copy.set(name, value, { export: true });
    }
    return copy;
  }

  /** A new process's environment: only the exported variables, as a script sees them. */
  exported(overrides: Readonly<Record<string, string>> = {}): ShellEnv {
    const copy = new ShellEnv();
    for (const [name, v] of this.vars) if (v.exported) copy.vars.set(name, { value: v.value, exported: true });
    for (const name of Object.keys(overrides)) {
      const value = overrides[name];
      if (value !== undefined) copy.set(name, value, { export: true });
    }
    return copy;
  }

  /** Replaces every variable, for `reset`. */
  replace(from: ShellEnv): void {
    this.vars.clear();
    for (const [name, v] of from.vars) this.vars.set(name, { value: v.value, exported: v.exported });
  }
}

/**
 * The PATH a new session starts with: the system's. ~/.bashrc puts ~/bin in front, so it is
 * there once, as on Linux, where ~/.profile adds it.
 */
export const DEFAULT_PATH = '/usr/local/bin:/usr/bin:/bin';

export const DEFAULT_PS1 = '\\u@\\h:\\w\\$ ';

/** What a login shell reads as it starts, quietly: /etc/profile, then ~/.bashrc, so ll works (F072). */
export function loginFiles(home: string = GUEST.home): readonly string[] {
  return ['/etc/profile', `${home}/.bashrc`];
}

/** The variables a session starts with, as bash's login shell would have them. */
export function defaultEnv(options: { user?: User; cwd?: string; columns?: number; rows?: number } = {}): ShellEnv {
  const user = options.user ?? GUEST;
  const cwd = options.cwd ?? user.home;
  return new ShellEnv([
    ['HOME', user.home, true],
    ['USER', user.name, true],
    ['LOGNAME', user.name, true],
    ['HOSTNAME', PROMPT_HOST, false],
    ['PATH', DEFAULT_PATH, true],
    ['PWD', cwd, true],
    ['SHELL', '/bin/vesh', true],
    ['TERM', 'xterm-256color', true],
    ['LANG', 'en_US.UTF-8', true],
    ['COLUMNS', String(options.columns ?? 80), false],
    ['LINES', String(options.rows ?? 24), false],
    ['PS1', DEFAULT_PS1, false],
    ['HISTSIZE', String(STORAGE_LIMITS.historyLines), false],
  ]);
}

// ── History ────────────────────────────────────────────────────────────────────────────────

/** What `vesen:history:v1` holds. */
interface StoredHistory {
  readonly v: 1;
  readonly lines: readonly string[];
}

function readStored(raw: unknown): StoredHistory | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const value = raw as { v?: unknown; lines?: unknown };
  if (value.v !== 1 || !Array.isArray(value.lines)) return undefined;
  const lines = value.lines.filter((line): line is string => typeof line === 'string');
  return { v: 1, lines };
}

/** History, plus the Svelte store contract over its entries for the UI. */
export interface HistoryStore extends HistoryApi {
  subscribe(run: Subscriber<readonly HistoryEntry[]>): Unsubscriber;
}

/**
 * The lines worth saving: none longer than STORAGE_LIMITS.historyLineChars, and only the newest
 * that fit in STORAGE_LIMITS.historyChars, so one pasted megabyte cannot fill the quota.
 */
export function savedHistoryLines(lines: readonly string[]): string[] {
  const kept: string[] = [];
  let total = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i] ?? '';
    if (line.length > STORAGE_LIMITS.historyLineChars) continue;
    total += line.length + 1;
    if (total > STORAGE_LIMITS.historyChars) break;
    kept.push(line);
  }
  return kept.reverse();
}

/**
 * Command history, as bash keeps it with HISTCONTROL=ignoreboth: a line starting with a space,
 * a blank line and a repeat of the line before are not kept. The newest 500 lines are kept and
 * saved under `vesen:history:v1` when storage allows. Numbers are bash's, so `!n` and `history`
 * agree: they keep counting up as old lines fall off, the lines after one removed with
 * `history -d` move up a number, and `history -c` starts again from the first number. With
 * `from`, it starts as a copy of those entries, numbers and all, as a subshell's does.
 */
export function createHistory(
  options: { storage?: KV<'local'> | null; size?: number; from?: readonly HistoryEntry[] } = {},
): HistoryStore {
  const size = Math.max(1, options.size ?? STORAGE_LIMITS.historyLines);
  const storage = options.storage ?? null;
  let entries: HistoryEntry[] = [];
  let next = 1;

  if (options.from !== undefined) {
    entries = [...options.from];
    next = (entries[entries.length - 1]?.n ?? 0) + 1;
  } else {
    const stored = storage?.getJson(STORAGE_KEYS.history.key, readStored);
    for (const line of stored?.lines.slice(-size) ?? []) entries.push({ n: next++, line });
  }

  const store: Writable<readonly HistoryEntry[]> = writable<readonly HistoryEntry[]>(entries);

  const write = (lines: readonly string[]): void => {
    storage?.setJson(STORAGE_KEYS.history.key, { v: 1, lines: savedHistoryLines(lines) } satisfies StoredHistory);
  };

  /** Saves the whole list: after history -c or -d, which change what is there. */
  const save = (): void => {
    store.set(entries);
    write(entries.map((entry) => entry.line));
  };

  /**
   * Saves one new line on the end of what is stored, so a line typed in another tab since this
   * one loaded is kept rather than overwritten.
   */
  const append = (line: string): void => {
    store.set(entries);
    if (storage === null) return;
    const stored = storage.getJson(STORAGE_KEYS.history.key, readStored)?.lines ?? [];
    const lines = stored[stored.length - 1] === line ? [...stored] : [...stored, line];
    write(lines.slice(-size));
  };

  return {
    subscribe: (run) => store.subscribe(run),
    list: () => entries,
    add(line: string): void {
      if (line.trim() === '' || /^\s/.test(line)) return;
      if (entries[entries.length - 1]?.line === line) return;
      entries = [...entries, { n: next++, line }];
      if (entries.length > size) entries = entries.slice(entries.length - size);
      append(line);
    },
    get(n: number): string | undefined {
      return entries.find((entry) => entry.n === n)?.line;
    },
    last(offset = 1): string | undefined {
      return offset >= 1 ? entries[entries.length - offset]?.line : undefined;
    },
    findPrefix(prefix: string): string | undefined {
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const line = entries[i]?.line;
        if (line?.startsWith(prefix)) return line;
      }
      return undefined;
    },
    search(query: string, before?: number): HistoryEntry | undefined {
      for (let i = entries.length - 1; i >= 0; i -= 1) {
        const entry = entries[i];
        if (entry === undefined || (before !== undefined && entry.n >= before)) continue;
        if (entry.line.includes(query)) return entry;
      }
      return undefined;
    },
    remove(n: number): void {
      const index = entries.findIndex((entry) => entry.n === n);
      if (index === -1) return;
      entries = [...entries.slice(0, index), ...entries.slice(index + 1).map((entry) => ({ n: entry.n - 1, line: entry.line }))];
      next -= 1;
      save();
    },
    clear(): void {
      next = entries[0]?.n ?? next;
      entries = [];
      save();
    },
  };
}

// ── Jobs ───────────────────────────────────────────────────────────────────────────────────

/** The running line: what the UI shows while it runs, plus the id that tells runs apart. */
export interface JobState extends JobInfo {
  readonly id: number;
}

/**
 * The one job that may run at a time (docs/plan/02-architecture-and-contracts.md, section 4).
 * Every submitted line gets one AbortController; Ctrl+C, Escape and the cancel button all call
 * abort(), which aborts it at once.
 */
export class JobControl {
  private readonly state = writable<JobState | null>(null);
  private controller: AbortController | null = null;
  private lastId = 0;

  /** The running job, or null while the prompt is idle. */
  readonly store: Readable<JobState | null> = readonly(this.state);

  /** Starts a job for a line, aborting any job still running. */
  begin(name: string, now: number): { id: number; signal: AbortSignal } {
    this.abort();
    const id = ++this.lastId;
    const controller = new AbortController();
    this.controller = controller;
    this.state.set({ id, name, label: null, startedAt: now });
    return { id, signal: controller.signal };
  }

  /** Updates what the running job shows: the command now running and its label. */
  describe(id: number, name: string, label: string | null): void {
    const current = this.state.get();
    if (current === null || current.id !== id) return;
    if (current.name === name && current.label === label) return;
    this.state.set({ ...current, name, label });
  }

  /** Ends job `id` if it is still the current one. */
  end(id: number): void {
    if (this.state.get()?.id !== id) return;
    this.controller = null;
    this.state.set(null);
  }

  /** Interrupts the running job, if any. Returns whether there was one. */
  abort(): boolean {
    const controller = this.controller;
    if (controller === null) return false;
    this.controller = null;
    controller.abort();
    return true;
  }

  get running(): boolean {
    return this.controller !== null;
  }
}

// ── Session ────────────────────────────────────────────────────────────────────────────────

export type ShellOptions = ShellOptionFlags;

export const DEFAULT_OPTIONS: Readonly<ShellOptions> = { noclobber: false, noglob: false };

export interface SessionOptions {
  readonly storage?: KV<'local'> | null;
  readonly user?: User;
  readonly size?: () => { readonly cols: number; readonly rows: number };
}

/**
 * What a shell keeps for itself: variables, aliases, options, history, the folder and $?. The
 * interactive shell's is the Session. `$( )`, backticks and each stage of a pipeline with more
 * than one command run in a fork, a copy thrown away when they end, so nothing they change
 * reaches the prompt, as in bash, where they are subshells. A script runs as its own process:
 * a fork with only the exported variables. The files are shared by all of them.
 */
export interface Scope {
  readonly env: ShellEnv;
  readonly aliases: Map<string, string>;
  readonly options: ShellOptions;
  /** The session's history, or in a fork a copy of it, so `history -c | cat` clears nothing. */
  readonly history: HistoryApi;
  /** False for the interactive shell; true for a subshell or a script. */
  readonly forked: boolean;
  readonly user: User;
  /** $HOME, or the user's home folder when it is unset. */
  readonly home: string;
  readonly currentDir: string;
  /** $?. */
  readonly status: ExitCode;
  setStatus(status: ExitCode): void;
  /** Moves to `path` (absolute, already checked): PWD and OLDPWD follow. */
  moveTo(path: string): void;
  /**
   * A subshell's copy of this scope. With `process`, a new program's instead: only the exported
   * variables (and `env`, exported), no aliases and the default options.
   */
  fork(options?: { readonly process?: boolean; readonly env?: Readonly<Record<string, string>> }): Scope;
  /** Back to a new session's variables, aliases and options, in the home folder. */
  reset(): void;
}

/** The moves every scope makes on `cd`: OLDPWD on every successful change, as bash sets it. */
function move(env: ShellEnv, before: string, path: string): void {
  env.set('OLDPWD', before, { export: true });
  env.set('PWD', path, { export: true });
}

/** A subshell's or a script's scope. */
class ForkedScope implements Scope {
  readonly forked = true;
  readonly history: HistoryApi;
  private dir: string;
  private last: ExitCode;

  constructor(
    readonly user: User,
    readonly env: ShellEnv,
    readonly aliases: Map<string, string>,
    readonly options: ShellOptions,
    from: Scope,
    private readonly fresh: () => ShellEnv,
  ) {
    this.dir = from.currentDir;
    this.last = from.status;
    this.history = createHistory({ from: from.history.list() });
  }

  get home(): string {
    return this.env.get('HOME') ?? this.user.home;
  }

  get currentDir(): string {
    return this.dir;
  }

  get status(): ExitCode {
    return this.last;
  }

  setStatus(status: ExitCode): void {
    this.last = status;
  }

  moveTo(path: string): void {
    move(this.env, this.dir, path);
    this.dir = path;
  }

  fork(options: { readonly process?: boolean; readonly env?: Readonly<Record<string, string>> } = {}): Scope {
    return forkScope(this, this.fresh, options);
  }

  reset(): void {
    this.env.replace(this.fresh());
    this.aliases.clear();
    Object.assign(this.options, DEFAULT_OPTIONS);
    this.dir = this.user.home;
    this.last = 0;
  }
}

function forkScope(
  from: Scope,
  fresh: () => ShellEnv,
  options: { readonly process?: boolean; readonly env?: Readonly<Record<string, string>> },
): Scope {
  const overrides = options.env ?? {};
  if (options.process === true) {
    return new ForkedScope(from.user, from.env.exported(overrides), new Map(), { ...DEFAULT_OPTIONS }, from, fresh);
  }
  return new ForkedScope(from.user, from.env.child(overrides), new Map(from.aliases), { ...from.options }, from, fresh);
}

/** Everything one session remembers. The executor reads and changes it; the UI subscribes. */
export class Session implements Scope {
  readonly forked = false;
  readonly user: User;
  readonly env: ShellEnv;
  readonly aliases = new Map<string, string>();
  readonly history: HistoryStore;
  readonly options: ShellOptions = { ...DEFAULT_OPTIONS };
  readonly jobs = new JobControl();
  private readonly cwdStore: Writable<string>;
  private readonly statusStore = writable<ExitCode>(0);
  readonly cwd: Readable<string>;
  readonly lastStatus: Readable<ExitCode>;

  constructor(private readonly config: SessionOptions = {}) {
    this.user = config.user ?? GUEST;
    this.env = this.freshEnv();
    this.history = createHistory({ storage: config.storage ?? null });
    this.cwdStore = writable(this.user.home);
    this.cwd = readonly(this.cwdStore);
    this.lastStatus = readonly(this.statusStore);
  }

  get home(): string {
    return this.env.get('HOME') ?? this.user.home;
  }

  get status(): ExitCode {
    return this.statusStore.get();
  }

  setStatus(status: ExitCode): void {
    this.statusStore.set(status);
  }

  get currentDir(): string {
    return this.cwdStore.get();
  }

  /** Moves to `path` (absolute, already checked): PWD, OLDPWD and the cwd store follow. */
  moveTo(path: string): void {
    move(this.env, this.cwdStore.get(), path);
    this.cwdStore.set(path);
  }

  fork(options: { readonly process?: boolean; readonly env?: Readonly<Record<string, string>> } = {}): Scope {
    return forkScope(this, () => this.freshEnv(), options);
  }

  /** Keeps $COLUMNS and $LINES in step with the terminal. */
  syncSize(): void {
    const size = this.config.size?.();
    if (size === undefined) return;
    this.env.set('COLUMNS', String(size.cols));
    this.env.set('LINES', String(size.rows));
  }

  /** Back to a new session's variables, aliases and options, in the home folder. */
  reset(): void {
    this.env.replace(this.freshEnv());
    this.aliases.clear();
    Object.assign(this.options, DEFAULT_OPTIONS);
    this.cwdStore.set(this.user.home);
    this.statusStore.set(0);
  }

  private freshEnv(): ShellEnv {
    const size = this.config.size?.();
    return defaultEnv({ user: this.user, ...(size ? { columns: size.cols, rows: size.rows } : {}) });
  }
}
