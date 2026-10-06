// The shell kernel's contracts (docs/plan/02-architecture-and-contracts.md, sections 1, 4, 5
// and 15). One CommandSpec per command drives execution, flag parsing, help, man, Tab
// completion and the phone chips. Everything here is DOM-free.

import type { Block, Colour, Span } from '../output/model';
import type { Appearance, Clock, Net, SysInfo } from '../services/types';
import type { BoundVfs } from '../vfs/types';

// ── Status ─────────────────────────────────────────────────────────────────────────────────

export type Category = 'portfolio' | 'files' | 'text' | 'shell' | 'system' | 'network' | 'fun' | 'editor';

/** A process exit status; see EXIT for the ones the kernel itself uses. */
export type ExitCode = number;

export const EXIT = {
  ok: 0,
  error: 1,
  /** Bad options or arguments, and syntax errors. */
  usage: 2,
  /** Permission denied, or not executable. */
  denied: 126,
  notFound: 127,
  /** Interrupted by ^C, Escape, the dock's ^C key or the Stop chip. */
  interrupted: 130,
  /** The reader of a pipe went away; reported silently. */
  brokenPipe: 141,
} as const satisfies Record<string, ExitCode>;

/** The whole-command budget when a spec sets none. */
export const DEFAULT_BUDGET_MS = 15_000;

// ── Values, flags and arguments ────────────────────────────────────────────────────────────

/** A choice offered by Tab and the chips. */
export interface EnumValue {
  readonly value: string;
  readonly summary?: string;
  /** A hex colour shown next to the value, for theme names. */
  readonly swatch?: string;
}

/** Where completion finds values for an argument or a flag value. */
export type ValueSource =
  | { readonly kind: 'path'; readonly accept?: 'any' | 'file' | 'dir' | 'exec'; readonly includeParent?: boolean }
  /** A command name: help, man, which. */
  | { readonly kind: 'command' }
  /** The rest of the line is a nested command line: sudo, time. */
  | { readonly kind: 'commandLine' }
  | { readonly kind: 'enum'; readonly values: () => readonly EnumValue[]; readonly caseInsensitive?: boolean }
  /** This argument's position in the spec's examples, and optionally in history. */
  | { readonly kind: 'examples'; readonly caseInsensitive?: boolean; readonly fromHistory?: boolean }
  | { readonly kind: 'var' | 'alias' | 'user' | 'host' | 'url' | 'int' }
  /** Shown dim as a placeholder; never accepted as a completion. */
  | { readonly kind: 'free'; readonly placeholder: string };

export interface FlagSpec {
  readonly short?: string;
  readonly long?: string;
  /** The key in ctx.opts; defaults to `long`, then `short`. */
  readonly key?: string;
  readonly description: string;
  readonly value?: {
    readonly name: string;
    readonly source: ValueSource;
    readonly default?: string;
    readonly optional?: boolean;
  };
  /** May be given more than once: values collect into a list, bare flags count. */
  readonly repeatable?: boolean;
}

export interface ArgSpec {
  readonly name: string;
  readonly source: ValueSource;
  readonly optional?: boolean;
  /** Only the last argument may be variadic. */
  readonly variadic?: boolean;
}

export interface SubcommandSpec {
  readonly summary: string;
  readonly args?: readonly ArgSpec[];
  readonly flags?: readonly FlagSpec[];
  readonly hidden?: boolean;
}

export interface Example {
  readonly line: string;
  readonly note?: string;
  /** Runs without the network: eligible for starter chips, and executed by the tests. */
  readonly offline?: boolean;
  /** Rank among the starter chips on an empty phone prompt; lower comes first. */
  readonly starter?: number;
}

// ── Commands ───────────────────────────────────────────────────────────────────────────────

export type RunFn = (ctx: CommandContext) => ExitCode | void | Promise<ExitCode | void>;
export type LoadFn = () => Promise<{ run: RunFn }>;

export interface CommandSpec {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly category: Category;
  /** 50 characters or fewer. */
  readonly summary: string;
  readonly synopsis?: readonly string[];
  readonly description?: string;
  /** Extra man page sections; bodies are in {colour} markup. */
  readonly man?: readonly { readonly heading: string; readonly body: string }[];
  readonly flags?: readonly FlagSpec[];
  readonly args?: readonly ArgSpec[];
  readonly subcommands?: Readonly<Record<string, SubcommandSpec>>;
  readonly examples?: readonly Example[];
  readonly seeAlso?: readonly string[];
  readonly featured?: boolean;
  readonly hidden?: boolean;

  /** May change session state: cd, export, alias. */
  readonly builtin?: boolean;
  /** Fails fast when offline, and gets the 8 s per-request default. */
  readonly network?: boolean;
  /** The whole-command budget; defaults to DEFAULT_BUDGET_MS. */
  readonly budgetMs?: number;
  /** The status line while the command runs, such as 'fetching forecast for Oslo'. */
  readonly loadingLabel?: (argv: readonly string[]) => string;
  /** Asks before spending this much data in the listed conditions: speedtest. */
  readonly dataCost?: { readonly bytes: number; readonly confirmOn: readonly ('cellular' | 'saveData' | 'touch')[] };
  /** Stops reading flags at the first operand. */
  readonly posixArgs?: boolean;
  /** The flag that `-N` sets, as in `head -5`. */
  readonly numericShortcut?: string;
  /** The command reads --help itself instead of the kernel printing the spec's help. */
  readonly handlesHelp?: boolean;

  /** A URL to open synchronously inside the Enter or tap gesture, before the job starts. */
  opens?(argv: readonly string[]): string | null;
  /** Follow-up chip lines after a run. */
  next?(result: { status: ExitCode; argv: readonly string[] }): string[];
  /** For values a ValueSource cannot describe. */
  readonly complete?: Completer;

  /** Exactly one of run and load; load() makes a lazy chunk. */
  readonly run?: RunFn;
  readonly load?: LoadFn;
  /** Migration only: the legacy help text. */
  readonly legacyHelp?: string;
}

/** Either an inline `run` or a lazy `load`, never both. */
export type RunnerChoice = { readonly run: RunFn; readonly load?: never } | { readonly run?: never; readonly load: LoadFn };

/** Declares a command. An identity function whose type requires exactly one of run and load. */
export function defineCommand(spec: CommandSpec & RunnerChoice): CommandSpec {
  return spec;
}

/** Thrown by a command for bad options or arguments; the kernel prints it with a --help hint and exits 2. */
export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

// ── Completion ─────────────────────────────────────────────────────────────────────────────

export type CandidateKind =
  | 'command'
  | 'alias'
  | 'subcommand'
  | 'flag'
  | 'dir'
  | 'file'
  | 'exec'
  | 'var'
  | 'value'
  | 'example'
  | 'history';

export interface Candidate {
  /** The unescaped replacement for the word, such as 'documents/linux.txt'. */
  readonly value: string;
  /** The text on a chip or in the list, such as 'linux.txt'. */
  readonly label: string;
  readonly kind: CandidateKind;
  readonly summary?: string;
  readonly swatch?: string;
  /** False for directories and `--opt=`: no space is added and completion continues. */
  readonly terminal: boolean;
}

export interface CompleterInput {
  /** The word under the cursor, unquoted, up to the cursor. */
  readonly word: string;
  /** Which operand the word is, counting from 0 after flags and the subcommand. */
  readonly argIndex: number;
  /** The unquoted words before the cursor; words[0] is the command name. */
  readonly words: readonly string[];
  readonly spec: CommandSpec;
  readonly sub?: string;
  readonly fs: BoundVfs;
  readonly env: Env;
  readonly shell: ShellApi;
}

/** A command's own completion, for values a ValueSource cannot describe. Must not throw. */
export type Completer = (input: CompleterInput) => readonly Candidate[];

// ── Streams ────────────────────────────────────────────────────────────────────────────────

/** Rejected by a write once the reader has gone; the kernel turns it into a silent 141. */
export class BrokenPipe extends Error {
  constructor() {
    super('broken pipe');
    this.name = 'BrokenPipe';
  }
}

export interface OutStream {
  /** True when the stream ends at the screen rather than a pipe or a file. */
  readonly isTTY: boolean;
  /** Measured on a TTY; 80 otherwise. */
  readonly columns: number;
  /** Text with the SGR subset; bytes pass unchanged through pipes. Rejects with BrokenPipe. */
  write(text: string): Promise<void>;
  /** One line of strings and spans; spans lose their styles and actions off a TTY. */
  line(...parts: readonly (string | Span)[]): Promise<void>;
  /** A rich block on a TTY; `plain(block)` otherwise. */
  block(block: Block): Promise<void>;
}

export interface InStream {
  readonly isTTY: boolean;
  /** Everything until end of input. */
  text(): Promise<string>;
  lines(): AsyncIterable<string>;
  close(): void;
}

/** SGR helpers; each returns its input unchanged when stdout is not a TTY. */
export interface Fmt {
  readonly enabled: boolean;
  fg(colour: Colour, text: string): string;
  bold(text: string): string;
  dim(text: string): string;
  underline(text: string): string;
  /** An OSC 8 link; http, https and mailto only. */
  link(href: string, text?: string): string;
}

// ── Session ────────────────────────────────────────────────────────────────────────────────

export interface Env {
  get(name: string): string | undefined;
  set(name: string, value: string, options?: { export?: boolean }): void;
  unset(name: string): void;
  isExported(name: string): boolean;
  entries(exportedOnly?: boolean): [string, string][];
  /** A copy for a child command, with `overrides` exported in it. */
  child(overrides?: Readonly<Record<string, string>>): Env;
}

export interface HistoryEntry {
  /** The number `!n` refers to. */
  readonly n: number;
  readonly line: string;
}

/**
 * Command history: ignores lines starting with a space and immediate duplicates, keeps 500
 * lines, and is persisted under `vesen:history:v1`. Secret input never reaches it.
 */
export interface HistoryApi {
  list(): readonly HistoryEntry[];
  add(line: string): void;
  get(n: number): string | undefined;
  /** The line `offset` back from the newest; 1 is the newest. */
  last(offset?: number): string | undefined;
  /** The newest line starting with `prefix`, for `!ec`. */
  findPrefix(prefix: string): string | undefined;
  /** The newest line containing `query` before entry `before`, for reverse search. */
  search(query: string, before?: number): HistoryEntry | undefined;
  remove(n: number): void;
  /** `history -c`. */
  clear(): void;
}

/** The command running now, owned by the shell Session; null while the prompt is idle. */
export interface JobInfo {
  readonly name: string;
  readonly label: string | null;
  readonly startedAt: number;
}

// ── Identity ───────────────────────────────────────────────────────────────────────────────

export interface User {
  readonly name: string;
  readonly uid: number;
  readonly gid: number;
  readonly groups: readonly number[];
  readonly home: string;
  readonly shell: string;
}

/** The visitor. `/home/user` remains as a symlink to the home folder. */
export const GUEST: User = {
  name: 'guest',
  uid: 1000,
  gid: 1000,
  groups: [1000],
  home: '/home/guest',
  shell: '/bin/bash',
};

/** The prompt's host: the brand, the same on every domain. */
export const PROMPT_HOST = 'vesen';

/** The owner's read-only portfolio files, for `finger has` and exploring. */
export const OWNER_HOME = '/home/has';

// ── Terminal ───────────────────────────────────────────────────────────────────────────────

export type InAppBrowser = 'instagram' | 'facebook' | 'tiktok';

export type FullscreenView = 'pager' | 'editor' | 'matrix' | 'sl' | 'shutdown' | 'qr-present';

/** What the terminal can do for a running command. */
export interface Tty {
  /** False when the command runs from a script, `source` or `$( )`. */
  readonly interactive: boolean;
  readonly columns: number;
  readonly rows: number;
  readonly touch: boolean;
  readonly inApp: InAppBrowser | null;
  /** The status line label while the command runs; null clears it. */
  status(text: string | null): void;
  /** Reads one line at a prompt; null on ^C or ^D. Secret input is masked and never stored. */
  readLine(options: { prompt: string; secret?: boolean }): Promise<string | null>;
  /** Asks yes or no, with chips on touch; null on ^C. */
  confirm(message: string, options?: { defaultAnswer?: boolean }): Promise<boolean | null>;
  /**
   * Prints a link card with Copy, and reports whether the preflight already opened the URL
   * ('opened'), the browser blocked it ('blocked') or only the card was shown ('card').
   */
  open(url: string, label: string): Promise<'opened' | 'blocked' | 'card'>;
  copy(text: string): Promise<boolean>;
  share?(data: { url: string; title?: string }): Promise<boolean>;
  bell(): void;
  clear(): void;
  /** Hands the screen to a full-screen app until it closes. */
  fullscreen<T = ExitCode>(view: FullscreenView, props: unknown): Promise<T>;
}

// ── Shell ──────────────────────────────────────────────────────────────────────────────────

/** The command registry. Backed by a Map, so inherited keys such as 'constructor' are never found. */
export interface Registry {
  /** Throws on a duplicate name or alias. */
  register(spec: CommandSpec): void;
  get(nameOrAlias: string): CommandSpec | undefined;
  list(options?: { includeHidden?: boolean; category?: Category }): CommandSpec[];
  /** Names and aliases, for completion. */
  names(options?: { includeHidden?: boolean }): string[];
  /** Did-you-mean names within an edit distance of 2, and a hint for commands from other systems. */
  suggest(name: string): { near: string[]; hint?: string };
  /** Problems with the registered specs: long summaries, a non-final variadic, examples that do not lex. */
  validate(): string[];
}

/** What builtins and commands that run other lines may do to the session. */
export interface ShellApi {
  cwd(): string;
  /** Sets PWD and OLDPWD. */
  chdir(path: string): void;
  lastStatus(): ExitCode;
  readonly aliases: Map<string, string>;
  readonly history: HistoryApi;
  readonly registry: Registry;
  /** Runs a line in this session: source, xargs, $( ). */
  exec(line: string, io?: Partial<Pick<CommandContext, 'stdin' | 'stdout' | 'stderr'>>): Promise<ExitCode>;
  /** `reset`: restores the session, and the files under ~ unless `files` is false. */
  reset(options?: { files?: boolean }): void;
}

export type OptValue = boolean | number | string | readonly string[] | undefined;

export interface CommandContext {
  /** The name the command was invoked by, which may be an alias. */
  readonly name: string;
  /** Every word, including the name. */
  readonly argv: readonly string[];
  /** The operands, after flags and the subcommand. */
  readonly args: readonly string[];
  readonly opts: Readonly<Record<string, OptValue>>;
  readonly sub?: string;
  readonly stdin: InStream;
  readonly stdout: OutStream;
  readonly stderr: OutStream;
  readonly fmt: Fmt;
  readonly env: Env;
  readonly cwd: string;
  readonly fs: BoundVfs;
  readonly user: User;
  /** Aborts on ^C and when the budget runs out. */
  readonly signal: AbortSignal;
  readonly tty: Tty;
  readonly net: Net;
  readonly sys: SysInfo;
  readonly clock: Clock;
  readonly appearance: Appearance;
  readonly shell: ShellApi;
  readonly spec: CommandSpec;
  /** Resolves a path against the cwd and home. */
  resolve(path: string): string;
  /** Writes "name: message" to stderr and returns `status` (default 1). */
  fail(message: string, status?: ExitCode): Promise<ExitCode>;
  /** Writes the message and "Try 'name --help' for more information." to stderr; returns 2. */
  usage(message?: string): Promise<ExitCode>;
}
