// The shell kernel's contracts (docs/plan/02-architecture-and-contracts.md, sections 1, 4, 5
// and 15). One CommandSpec per command drives execution, flag parsing, help, man, Tab
// completion and the phone chips. Everything here is DOM-free.

import type { Block, Colour, Span } from '../output/model';
import type { Appearance, Clock, Digest, Net, SysInfo } from '../services/types';
import { GUEST as IDENTITY_GUEST, HOST, OWNER } from '../vfs/identity';
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

/** What an `enum` source may read its values from: the theme and CRT lists come from appearance. */
export interface ValueContext {
  readonly appearance?: Appearance;
}

/** What a spec's next() may read when it makes the chips that follow a run. */
export interface NextContext extends ValueContext {
  /**
   * The entries of a folder, relative to the working folder or absolute, `~` included; null when
   * it cannot be listed. Never throws.
   */
  readonly list?: (path: string) => readonly { readonly name: string; readonly type: 'file' | 'dir' }[] | null;
}

/**
 * A word that may go into a tappable line as it is: no space, quote, `$`, glob, `;` or `|`, and
 * no leading `-` or `~` that would make it a flag or a home folder (02, section 6).
 */
export const PLAIN_ARG = /^[\w.,:@%+=/][\w.,:@%+=/~-]*$/;

/** Where completion finds values for an argument or a flag value. */
export type ValueSource =
  | { readonly kind: 'path'; readonly accept?: 'any' | 'file' | 'dir' | 'exec'; readonly includeParent?: boolean }
  /** A command name: help, man, which. */
  | { readonly kind: 'command' }
  /** The rest of the line is a nested command line: sudo, time. */
  | { readonly kind: 'commandLine' }
  | {
      readonly kind: 'enum';
      /** The values; completion passes the services a list may come from. */
      readonly values: (context?: ValueContext) => readonly EnumValue[];
      readonly caseInsensitive?: boolean;
    }
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
  /**
   * What a starter chip shows, when not the line itself: `cat README.md` for `cat ~/README.md`,
   * which runs from any folder. The chip's name for screen readers is still the whole line.
   */
  readonly label?: string;
}

// ── Commands ───────────────────────────────────────────────────────────────────────────────

export type RunFn = (ctx: CommandContext) => ExitCode | void | Promise<ExitCode | void>;

/** A man page section after the generated ones; the body is in {colour} markup. */
export interface ManSection {
  readonly heading: string;
  readonly body: string;
}

/**
 * A command's long help: what --help, help and man say besides the summary, synopsis, flags and
 * examples. A command whose body loads lazily keeps it with the body, as `doc`, so the kernel's
 * chunk carries only the spec; help fetches it when asked (withDoc in shell/help.ts).
 */
export interface CommandDoc {
  readonly description?: string;
  /** Extra man page sections. */
  readonly man?: readonly ManSection[];
}

/** Loads a command's body, and with it the long help kept there. */
export type LoadFn = () => Promise<{ run: RunFn; readonly doc?: CommandDoc }>;

export interface CommandSpec {
  readonly name: string;
  readonly aliases?: readonly string[];
  readonly category: Category;
  /** 50 characters or fewer. */
  readonly summary: string;
  readonly synopsis?: readonly string[];
  /** Said by --help, help and man; a command that loads lazily keeps it in its body's `doc`. */
  readonly description?: string;
  /** Extra man page sections; bodies are in {colour} markup. As description, for a lazy body. */
  readonly man?: readonly ManSection[];
  readonly flags?: readonly FlagSpec[];
  readonly args?: readonly ArgSpec[];
  readonly subcommands?: Readonly<Record<string, SubcommandSpec>>;
  readonly examples?: readonly Example[];
  readonly seeAlso?: readonly string[];
  readonly featured?: boolean;
  /**
   * Its place in its category's row of the short help index, lowest first; unranked commands
   * follow by name. A row holds only so many names (`help --all` lists them all), so the commands
   * a visitor reaches for first in a long category get one.
   */
  readonly helpRank?: number;
  readonly hidden?: boolean;

  /** May change session state: cd, export, alias. */
  readonly builtin?: boolean;
  /** Fails fast when offline, and gets the 8 s per-request default. */
  readonly network?: boolean;
  /** The whole-command budget; defaults to DEFAULT_BUDGET_MS. */
  readonly budgetMs?: number;
  /** The status line while the command runs, such as 'fetching forecast for Oslo'. */
  readonly loadingLabel?: (argv: readonly string[]) => string;
  /**
   * Asks before spending this much data in the listed conditions: speedtest. `bytes` may depend
   * on the line (`speedtest --full`); 0 asks nothing.
   */
  readonly dataCost?: {
    readonly bytes: number | ((argv: readonly string[]) => number);
    readonly confirmOn: readonly ('cellular' | 'saveData' | 'touch')[];
  };
  /** Stops reading flags at the first operand. */
  readonly posixArgs?: boolean;
  /** The flag that `-N` sets, as in `head -5`. */
  readonly numericShortcut?: string;
  /** The command reads --help itself instead of the kernel printing the spec's help. */
  readonly handlesHelp?: boolean;
  /**
   * The status of a usage error (an unknown option, a missing operand): 2 for builtins, as in
   * bash, and 1 otherwise, as GNU coreutils exit; ls and a few others say 2 here.
   */
  readonly usageStatus?: ExitCode;
  /**
   * A declaration builtin (export): an argument shaped NAME=value expands as an assignment does,
   * with no word splitting or globbing, so `export X=$Y` keeps the spaces in $Y.
   */
  readonly assignmentArgs?: boolean;
  /**
   * Changes the page itself (poweroff, speedtest): runs only at the prompt, never from a pipe,
   * `$( )`, a script or a sourced file such as ~/.bashrc.
   */
  readonly interactiveOnly?: boolean;

  /** A URL to open synchronously inside the Enter or tap gesture, before the job starts. */
  opens?(argv: readonly string[]): string | null;
  /**
   * Follow-up chip lines after a run, each a line to run in one tap. Every word placed in a line
   * from data (a file or theme name) must match a plain pattern, so no tap can carry a quote,
   * a `$` or a `;` (02, section 6). Must not throw.
   */
  next?(result: { status: ExitCode; argv: readonly string[] }, context?: NextContext): string[];
  /** For values a ValueSource cannot describe. */
  readonly complete?: Completer;

  /** Exactly one of run and load; load() makes a lazy chunk. */
  readonly run?: RunFn;
  readonly load?: LoadFn;
}

/** Either an inline `run` or a lazy `load`, never both. */
export type RunnerChoice = { readonly run: RunFn; readonly load?: never } | { readonly run?: never; readonly load: LoadFn };

/** Declares a command. An identity function whose type requires exactly one of run and load. */
export function defineCommand(spec: CommandSpec & RunnerChoice): CommandSpec {
  return spec;
}

/**
 * Thrown by `exit` and `logout`: ends the session, or the script running them, with `status`. A
 * pipeline stage or `$( )` is a subshell, so there it ends only that.
 */
export class ExitRequest extends Error {
  constructor(readonly status: ExitCode) {
    super(`exit ${status}`);
    this.name = 'ExitRequest';
  }
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
  /** The input as it arrives, unchanged, for commands that copy it exactly, such as cat. */
  chunks(): AsyncIterable<string>;
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
  /**
   * Marks NAME for export, or stops exporting it, keeping its value. An unset NAME marked for
   * export is remembered, so a later `NAME=value` lands in the environment (`export X; X=5`).
   */
  markExported(name: string, exported: boolean): void;
  /** The variables that have a value, sorted by name. */
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

// The visitor, the prompt's host and the owner's home come from the one identity module
// (src/vfs/identity.ts), which the prompt, /etc/passwd and fastfetch read too.

/** The visitor. `/home/user` remains as a symlink to the home folder. */
export const GUEST: User = IDENTITY_GUEST;

/** The prompt's host: the brand, the same on every domain. */
export const PROMPT_HOST = HOST;

/** The owner's read-only portfolio files, for `finger has` and exploring. */
export const OWNER_HOME: string = OWNER.home;

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
  /**
   * Reads one line at a prompt; null on ^C or ^D. The terminal echoes the prompt and the answer
   * into the output, as a terminal does, except a secret answer, which is masked as it is typed
   * and never echoed or stored. `hint` is a dim line above the prompt; `opens` is a URL opened
   * inside the key press that answers, as `opens()` is inside the Enter that runs a line, for
   * tty.open to report. `signal` ends the read early with null, as ^C does: `read -t`.
   */
  readLine(options: { prompt: string; secret?: boolean; hint?: string; opens?: string; signal?: AbortSignal }): Promise<string | null>;
  /** Asks yes or no at the prompt; null on ^C. */
  confirm(message: string, options?: { defaultAnswer?: boolean }): Promise<boolean | null>;
  /**
   * Whether `url` opened in a new tab inside the gesture that ran the line (a desktop browser,
   * through the spec's opens()): 'opened', 'blocked' by the browser, or 'card' where only the
   * link card shows (phones, in-app browsers, mail). It prints nothing: every opener prints its
   * own link card with Copy (commands/lib/cards.ts).
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
  /**
   * False while some commands are still to come: the catalogue (src/commands/more), whose chunk
   * loads after the kernel, once the page is idle or as soon as something needs it.
   */
  readonly complete: boolean;
  /**
   * Loads the rest of the commands if they are not in yet, and settles once they are, or once
   * the attempt has failed: `complete` then stays false, and the next call tries again. Never
   * rejects. Anything that lists or looks up commands by name awaits it, bounded by its signal.
   */
  whenComplete(): Promise<void>;
  /**
   * Why the last attempt to load the rest failed, the first time it is asked after that attempt,
   * so the failure is reported once; undefined otherwise.
   */
  takeFailure(): string | undefined;
  /** Calls `listener` after commands are added (the catalogue arriving); returns the unsubscribe. */
  onChange(listener: () => void): () => void;
}

/** Where the commands that load after the kernel come from: the catalogue's chunk. */
export type CatalogueLoader = () => Promise<readonly CommandSpec[]>;

/** The shell's options, which `set` reads and changes. */
export interface ShellOptionFlags {
  /** `set -o noclobber` (`set -C`): `>` refuses to overwrite a file. */
  noclobber: boolean;
  /** `set -o noglob` (`set -f`): no pathname expansion. */
  noglob: boolean;
}

/**
 * A command running in a line, as ps, kill and pgrep see it. Builtins run in the shell itself
 * and have none; src/commands/lib/procs.ts adds init and the shell.
 */
export interface ProcessInfo {
  readonly pid: number;
  /** The process that ran it: the shell, or the command that ran it (time, timeout, watch). */
  readonly ppid: number;
  /** The name it was run by. */
  readonly name: string;
  readonly argv: readonly string[];
  /** When it started, in `clock` time (ms). */
  readonly startedAt: number;
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
  /** The session's options; a change applies from the next command. */
  readonly options: ShellOptionFlags;
  /**
   * Runs a line in this session, without alias expansion: command, env, xargs. When `signal`
   * aborts, the line stops as ^C would stop it, and exec gives 130 (timeout), while the line
   * that called it carries on.
   */
  exec(
    line: string,
    io?: Partial<Pick<CommandContext, 'stdin' | 'stdout' | 'stderr'>> & { readonly signal?: AbortSignal },
  ): Promise<ExitCode>;
  /** The process id the command runs as: its own, or the shell's ($$) for a builtin. */
  pid(): number;
  /** The commands running now, each with its pid, in the order they started. */
  processes(): readonly ProcessInfo[];
  /**
   * Ends the line that process `pid` is part of, as ^C ends it (kill, pkill). False when no
   * running command has that pid.
   */
  kill(pid: number): boolean;
  /**
   * `source` and `.`: runs a file's lines in this session, with `args` as $1, $2 and so on. A
   * missing or unreadable file is reported and is status 1.
   */
  source(path: string, args?: readonly string[]): Promise<ExitCode>;
  /** `reset`: restores the session, and the files under ~ unless `files` is false. */
  reset(options?: { files?: boolean }): void;
  /**
   * A new login session, as after `exit`: a new session's variables, aliases and options in the
   * home folder, then /etc/profile and ~/.bashrc read again. Files, history and the theme stay.
   * With `banner`, the screen is cleared and the banner shown, as at boot.
   */
  login(options?: { banner?: boolean }): Promise<void>;
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
  /**
   * When the whole-command budget runs out, in `clock` time (ms), counted from before the body
   * loaded; absent for a command without one. A command that draws what it has when time runs
   * short (stock's table) plans its requests against it.
   */
  readonly deadline?: number;
  readonly tty: Tty;
  readonly net: Net;
  readonly sys: SysInfo;
  readonly clock: Clock;
  /** Hashes through the browser's WebCrypto: sha256sum and the other checksums. */
  readonly digest: Digest;
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
