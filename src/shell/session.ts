// The state one shell session keeps between lines (docs/plan/designs/shell-architecture.md,
// section 6): variables with their export flags, aliases, command history, the current folder,
// the last status, options such as noclobber, and the running job. The stores follow the Svelte
// store contract (./observable.ts), so the UI can subscribe to them.

import { STORAGE_KEYS, STORAGE_LIMITS } from '../services/storage-keys';
import type { KV } from '../services/types';
import { readonly, writable, type Readable, type Subscriber, type Unsubscriber, type Writable } from './observable';
import { GUEST, PROMPT_HOST, type Env, type ExitCode, type HistoryApi, type HistoryEntry, type JobInfo, type User } from './types';

// ── Variables ──────────────────────────────────────────────────────────────────────────────

interface Variable {
  value: string;
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

  entries(exportedOnly = false): [string, string][] {
    return [...this.vars]
      .filter(([, variable]) => !exportedOnly || variable.exported)
      .map(([name, variable]): [string, string] => [name, variable.value])
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  }

  child(overrides: Readonly<Record<string, string>> = {}): ShellEnv {
    const copy = new ShellEnv([...this.vars].map(([name, v]) => [name, v.value, v.exported] as const));
    for (const name of Object.keys(overrides)) {
      const value = overrides[name];
      if (value !== undefined) copy.set(name, value, { export: true });
    }
    return copy;
  }

  /** Replaces every variable, for `reset`. */
  replace(from: ShellEnv): void {
    this.vars.clear();
    for (const [name, value] of from.entries()) this.vars.set(name, { value, exported: from.isExported(name) });
  }
}

/** The PATH a new session starts with: the visitor's own bin, then the system's. */
export const DEFAULT_PATH = `${GUEST.home}/bin:/usr/local/bin:/usr/bin:/bin`;

export const DEFAULT_PS1 = '\\u@\\h:\\w\\$ ';

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
    ['OLDPWD', cwd, true],
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
 * Command history, as bash keeps it with HISTCONTROL=ignoreboth: a line starting with a space,
 * a blank line and a repeat of the line before are not kept. The newest 500 lines are kept and
 * saved under `vesen:history:v1` when storage allows; numbers keep counting up, as `!n` expects.
 */
export function createHistory(options: { storage?: KV<'local'> | null; size?: number } = {}): HistoryStore {
  const size = Math.max(1, options.size ?? STORAGE_LIMITS.historyLines);
  const storage = options.storage ?? null;
  let entries: HistoryEntry[] = [];
  let next = 1;

  const stored = storage?.getJson(STORAGE_KEYS.history.key, readStored);
  for (const line of stored?.lines.slice(-size) ?? []) entries.push({ n: next++, line });

  const store: Writable<readonly HistoryEntry[]> = writable<readonly HistoryEntry[]>(entries);

  const save = (): void => {
    store.set(entries);
    storage?.setJson(STORAGE_KEYS.history.key, { v: 1, lines: entries.map((entry) => entry.line) } satisfies StoredHistory);
  };

  return {
    subscribe: (run) => store.subscribe(run),
    list: () => entries,
    add(line: string): void {
      if (line.trim() === '' || /^\s/.test(line)) return;
      if (entries[entries.length - 1]?.line === line) return;
      entries = [...entries, { n: next++, line }];
      if (entries.length > size) entries = entries.slice(entries.length - size);
      save();
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
      const kept = entries.filter((entry) => entry.n !== n);
      if (kept.length === entries.length) return;
      entries = kept;
      save();
    },
    clear(): void {
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

export interface ShellOptions {
  /** `set -o noclobber`: `>` refuses to overwrite a file. */
  noclobber: boolean;
  /** `set -f`: no pathname expansion. */
  noglob: boolean;
}

export const DEFAULT_OPTIONS: Readonly<ShellOptions> = { noclobber: false, noglob: false };

export interface SessionOptions {
  readonly storage?: KV<'local'> | null;
  readonly user?: User;
  readonly size?: () => { readonly cols: number; readonly rows: number };
}

/** Everything one session remembers. The executor reads and changes it; the UI subscribes. */
export class Session {
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
    const before = this.cwdStore.get();
    if (path !== before) this.env.set('OLDPWD', before, { export: true });
    this.env.set('PWD', path, { export: true });
    this.cwdStore.set(path);
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
