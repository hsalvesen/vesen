// Runs parsed lines (docs/plan/designs/shell-architecture.md, section 2, steps 3 to 7):
//
// - lists and && / || chains, with $? after every pipeline;
// - pipelines whose stages run at once over bounded pipes, so `yes | head -n 2` ends as soon as
//   head has its lines (the writer gets a silent 141);
// - per command: word expansion, prefix assignments, redirections applied left to right
//   (< > >> 2> 2>> &> 2>&1 >&2 <<<, with noclobber and /dev/null), then the command: the
//   registry, then an executable script on $PATH, then `command not found` (127) with a tappable
//   did-you-mean;
// - options parsed from the spec, --help answered from it;
// - errors mapped to statuses and Linux wording: usage 2, ^C 130, a broken pipe 141 (silently),
//   a network failure 1 (in curl's words for curl), a file error 1 with strerror text;
// - the whole-command budget for network commands, on top of net's per-request deadline.

import { DeadlineExceeded, combineSignals, deadline, whenAborted } from '../lib/signals';
import { out, type Line, type Span, type SpanStyle } from '../output/model';
import type { Appearance, Bell, Clipboard, Clock, Net, NetError, Opener, SysInfo } from '../services/types';
import { strerror } from '../vfs/errors';
import { VfsError, type BoundVfs } from '../vfs/types';
import type { AndOr, List, ParseFailure, Pipeline, Redirect, SimpleCommand } from './ast';
import { expandAliases } from './alias';
import { AmbiguousRedirect, ExpandError, Expander } from './expand';
import { FlagError, parseFlags, takesRawArgs, tryHelp, wantsLegacyHelp, type ParsedArgs } from './flags';
import { createFmt } from './fmt';
import { createGlobber, type GlobFs } from './glob';
import { describeIncomplete, parse } from './parser';
import type { ReadOptions } from './reader';
import { loginFiles, type Scope, type Session } from './session';
import {
  AsyncPipe,
  CaptureOut,
  FileOut,
  JobDetached,
  NullOut,
  PipeIn,
  PipeOut,
  StringIn,
  writeLegacyHtml,
  type TtySink,
  type WriteTarget,
} from './streams';
import {
  BrokenPipe,
  DEFAULT_BUDGET_MS,
  EXIT,
  ExitRequest,
  OWNER_HOME,
  UsageError,
  type CommandContext,
  type CommandSpec,
  type ExitCode,
  type InAppBrowser,
  type InStream,
  type OutStream,
  type Registry,
  type RunFn,
  type ShellApi,
  type Tty,
} from './types';

/** `timeout`'s status when a command outlives its budget and does not stop when asked. */
export const EXIT_TIMEOUT = 124;

/** Scripts calling scripts, and files sourcing files, may nest this deep. */
export const MAX_SCRIPT_DEPTH = 16;

/**
 * A job lets the browser run (timers, taps, ^C) once it has had the thread this long, or has
 * run this many commands, whichever comes first: every step of a script is an await on an
 * already-settled promise, which would otherwise never give the event loop a turn.
 */
const YIELD_EVERY_MS = 16;
const YIELD_EVERY_COMMANDS = 256;

const defaultYield = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** How long a command whose budget ran out may take to stop and say why, before the kernel stops waiting. */
const BUDGET_GRACE_MS = 250;

/** `$$`: vesen is one process, always the same one. */
export const SHELL_PID = 4242;

const ERROR: SpanStyle = { fg: 'error' };
const MUTED: SpanStyle = { fg: 'muted' };
const ACCENT: SpanStyle = { fg: 'accent' };

/** Words safe to repeat in a did-you-mean line: no quotes, operators or expansions. */
const PLAIN_WORD = /^[\w.,:@%+=/~-]+$/;

/** The file system the kernel runs on: the VFS, or a stand-in for tests. */
export interface ShellFs extends BoundVfs {
  /** True when `path` is a file the visitor may run as a script. */
  isExecutable?(path: string): boolean;
  /** The registry command a /usr/bin stub stands for, so `/bin/ls` runs ls. */
  builtinAt?(path: string): string | undefined;
  /** Opens a file for `>` and `>>`. */
  openWrite?(path: string, options: { append: boolean; noclobber: boolean }): { write(text: string): void; close(): void };
  /** `reset`: the seed files again. */
  restore?(): void;
}

/** What the terminal is and can do, for ctx.tty. */
export interface TerminalInfo {
  size(): { readonly cols: number; readonly rows: number };
  readonly touch: boolean;
  readonly inApp: InAppBrowser | null;
  /**
   * Reads one line typed at `prompt`, for `rm -i` and sudo; null on ^C or ^D. The shell answers
   * it from the prompt (src/shell/reader.ts); without it, every read gets null: no answer.
   */
  readLine?(options: ReadOptions): Promise<string | null>;
}

export interface ExecutorDeps {
  readonly session: Session;
  readonly registry: Registry;
  readonly fs: ShellFs;
  readonly files: WriteTarget;
  readonly net: Net;
  readonly clock: Clock;
  readonly sys: SysInfo;
  readonly appearance: Appearance;
  readonly terminal: TerminalInfo;
  readonly opener?: Opener | undefined;
  readonly clipboard?: Clipboard | undefined;
  readonly bell?: Bell | undefined;
  /** Lets the browser run between commands of a long job; tests pass a resolved promise. */
  readonly yieldToHost?: (() => Promise<void>) | undefined;
}

/** A URL a command opened inside the Enter gesture, before its job started. */
export interface Preflighted {
  readonly url: string;
  readonly result: 'opened' | 'blocked' | 'skipped';
}

/** The preflight of a job's line, until its command asks to open what it opened. */
export interface PreflightSlot {
  current: Preflighted | null;
}

/** One submitted line while it runs. */
export interface Job {
  readonly id: number;
  /** Aborts on ^C; everything the job runs listens to it. */
  readonly signal: AbortSignal;
  readonly sink: TtySink;
  /** What preflight opened for this line; the first tty.open takes it. */
  readonly preflight: PreflightSlot;
  /** Rings the bell, at most once per job. */
  bell(): void;
  /** What the status line shows: the command now running, and its label. */
  describe(name: string, label: string | null): void;
}

export interface Io {
  readonly stdin: InStream;
  readonly stdout: OutStream;
  readonly stderr: OutStream;
}

/** What changes inside a script, a sourced file or a subshell. */
export interface Frame {
  readonly argv0: string;
  readonly args: readonly string[];
  /** How many scripts and sourced files deep this runs. */
  readonly depth: number;
  readonly interactive: boolean;
  /** Where variables, aliases, options, the folder and $? live; the session when absent. */
  readonly scope?: Scope;
  /**
   * True when aliases expand in the lines this frame reads: the interactive shell, the files it
   * sources and its $( ). False in a script, as in non-interactive bash.
   */
  readonly aliasing?: boolean;
}

export const TOP_FRAME: Frame = { argv0: 'vesen', args: [], depth: 0, interactive: true, aliasing: true };

/**
 * Thrown after an expansion error (a bad substitution, an arithmetic error): interactive bash
 * abandons the rest of the line, so nothing after it runs. A subshell or a script ends there
 * with status 1; at the prompt the line does.
 */
export class LineAborted extends Error {
  constructor() {
    super('line aborted');
    this.name = 'LineAborted';
  }
}

/** Thrown inside a job once it has been interrupted, to skip the rest of the line. */
class Interrupted extends Error {
  constructor() {
    super('interrupted');
    this.name = 'Interrupted';
  }
}

const span = (text: string, style?: SpanStyle): Span => (style === undefined ? { text } : { text, style });

/** An argument shaped `NAME=value`, which a declaration builtin expands as an assignment. */
const ASSIGNMENT_WORD = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Writes kernel messages, ignoring a stream that has gone (the job ended, or a pipe closed). */
async function say(stream: OutStream, ...lines: Line[]): Promise<void> {
  try {
    for (const line of lines) await stream.line(...line);
  } catch {
    // Nowhere left to say it.
  }
}

/** curl's words for a failed request, with curl's own error number in them. */
function curlMessage(error: NetError): string {
  switch (error.kind) {
    case 'offline':
      return `curl: (6) Could not resolve host: ${error.host} (you appear to be offline)`;
    case 'timeout':
      return `curl: (28) Operation timed out after ${error.timeoutMs ?? 8000} milliseconds`;
    case 'cors':
      return `curl: (7) blocked by CORS: ${error.host} does not allow browser requests`;
    case 'http':
      return `curl: (22) The requested URL returned error: ${error.status ?? 'unknown'}`;
    case 'parse':
      return `curl: (8) Weird server reply from ${error.host}`;
    case 'abort':
      return 'curl: (42) Callback aborted';
    case 'network':
      return `curl: (7) Failed to connect to ${error.host}`;
  }
}

export class Executor {
  private lastYield = Date.now();
  private sinceYield = 0;

  constructor(private readonly deps: ExecutorDeps) {}

  private get session(): Session {
    return this.deps.session;
  }

  /** Where a frame's variables, aliases, options, folder and $? live. */
  private scope(frame: Frame): Scope {
    return frame.scope ?? this.session;
  }

  /**
   * Gives the browser a turn when this job has kept the thread a while, then stops if ^C came
   * meanwhile. Without it a self-sourcing file or a script that runs itself three times over
   * would loop in microtasks, where neither ^C nor a deadline timer can ever fire.
   */
  private async breathe(job: Job): Promise<void> {
    this.sinceYield += 1;
    const now = Date.now();
    if (this.sinceYield < YIELD_EVERY_COMMANDS && now - this.lastYield < YIELD_EVERY_MS) return;
    this.sinceYield = 0;
    await (this.deps.yieldToHost ?? defaultYield)();
    this.lastYield = Date.now();
    this.checkAborted(job);
  }

  // ── Lists ──

  async runList(list: List, job: Job, io: Io, frame: Frame): Promise<ExitCode> {
    let status = this.scope(frame).status;
    for (const item of list.items) {
      this.checkAborted(job);
      if (item.background) {
        await say(io.stderr, [span('vesen: no job control here; running it in the foreground', MUTED)]);
      }
      status = await this.runAndOr(item.node, job, io, frame);
    }
    return status;
  }

  private async runAndOr(node: AndOr, job: Job, io: Io, frame: Frame): Promise<ExitCode> {
    let status = await this.runPipeline(node.first, job, io, frame);
    for (const { op, pipe } of node.rest) {
      if (op === '&&' ? status !== 0 : status === 0) continue;
      status = await this.runPipeline(pipe, job, io, frame);
    }
    return status;
  }

  private async runPipeline(pipeline: Pipeline, job: Job, io: Io, frame: Frame): Promise<ExitCode> {
    this.checkAborted(job);
    const cmds = pipeline.cmds;
    let status: ExitCode;
    if (cmds.length === 1 && cmds[0] !== undefined) {
      status = await this.runCommand(cmds[0], job, io, frame);
    } else {
      const pipes = cmds.slice(1).map(() => new AsyncPipe());
      const stages = cmds.map(async (cmd, i) => {
        const before = pipes[i - 1];
        const after = pipes[i];
        const stageIo: Io = {
          stdin: before === undefined ? io.stdin : new PipeIn(before),
          stdout: after === undefined ? io.stdout : new PipeOut(after, io.stdout.columns),
          stderr: io.stderr,
        };
        try {
          // Each stage of a pipeline is a subshell, which is not the interactive shell: what it
          // changes (the folder, variables, aliases, options, history) stays in its own copy.
          return await this.runCommand(cmd, job, stageIo, { ...frame, interactive: false, scope: this.scope(frame).fork() });
        } catch (error) {
          // `exit` there ends only the stage, and so does an expansion error.
          if (error instanceof ExitRequest) return error.status;
          if (error instanceof LineAborted) return EXIT.error;
          throw error;
        } finally {
          // The stage's ends close when it finishes: its reader sees end of input, and its
          // writer, if still writing, a broken pipe.
          after?.closeWrite();
          before?.closeRead();
        }
      });
      const statuses = await Promise.all(stages);
      status = statuses[statuses.length - 1] ?? 0;
    }
    if (pipeline.negate) status = status === 0 ? 1 : 0;
    this.scope(frame).setStatus(status);
    return status;
  }

  // ── One command ──

  private async runCommand(cmd: SimpleCommand, job: Job, io: Io, frame: Frame): Promise<ExitCode> {
    this.checkAborted(job);
    await this.breathe(job);
    const scope = this.scope(frame);
    const expander = this.expander(job, io, frame);
    const opened: FileOut[] = [];
    try {
      let argv: string[];
      const assigned: Record<string, string> = {};
      let cmdIo: Io;
      try {
        if (cmd.words.length === 0) {
          // Only assignments: each is made before the next is expanded, so `A=1 B=$A` sees 1.
          for (const assign of cmd.assigns) scope.env.set(assign.name, await expander.string(assign.value));
          argv = [];
        } else {
          argv = await this.argv(cmd, expander);
          for (const assign of cmd.assigns) assigned[assign.name] = await expander.string(assign.value);
        }
        cmdIo = await this.redirect(cmd.redirects, io, expander, opened, scope);
      } catch (error) {
        return await this.shellError(error, io);
      }
      this.checkAborted(job);

      const name = argv[0];
      // $_ is the last word of the command before, as bash keeps it.
      const last = argv[argv.length - 1] ?? '';
      if (name === undefined) {
        scope.env.set('_', last);
        return expander.substStatus ?? 0;
      }

      try {
        const spec = this.deps.registry.get(name) ?? this.stubSpec(name, scope);
        if (spec !== undefined) {
          // A builtin sees its prefix assignments in the shell itself, for as long as it runs,
          // so `A=1 export B=2` exports B; anything else gets them in its own environment.
          if (spec.builtin === true) {
            return await this.withAssignments(scope, assigned, () => this.runSpec(spec, name, argv, cmdIo, scope.env, job, frame));
          }
          const env = Object.keys(assigned).length > 0 ? scope.env.child(assigned) : scope.env;
          return await this.runSpec(spec, name, argv, cmdIo, env, job, frame);
        }

        const script = this.findScript(name, scope);
        if (script === 'denied') {
          await say(cmdIo.stderr, [span(`vesen: ${name}: Permission denied`, ERROR)]);
          return EXIT.denied;
        }
        if (script !== null) return await this.runScript(script, argv, assigned, job, cmdIo, frame);
        return await this.notFound(name, argv, cmdIo, job);
      } finally {
        scope.env.set('_', last);
      }
    } finally {
      for (const file of opened) file.close();
    }
  }

  /**
   * A command's words, expanded. For a declaration builtin (export), a word shaped NAME=value
   * expands as an assignment does: no splitting and no globbing, so `export X=$Y` keeps spaces.
   */
  private async argv(cmd: SimpleCommand, expander: Expander): Promise<string[]> {
    const [first, ...rest] = cmd.words;
    if (first === undefined) return [];
    const words = await expander.fields([first]);
    const name = words[0];
    const declares = words.length === 1 && name !== undefined && this.deps.registry.get(name)?.assignmentArgs === true;
    if (!declares) {
      words.push(...(await expander.fields(rest)));
      return words;
    }
    for (const word of rest) {
      if (ASSIGNMENT_WORD.test(word.raw)) words.push(await expander.string(word));
      else words.push(...(await expander.fields([word])));
    }
    return words;
  }

  /** Runs `run` with `assigned` set in `scope`, then puts back each one the command left alone. */
  private async withAssignments(scope: Scope, assigned: Readonly<Record<string, string>>, run: () => Promise<ExitCode>): Promise<ExitCode> {
    const names = Object.keys(assigned);
    if (names.length === 0) return run();
    const saved = names.map((name) => ({ name, value: scope.env.get(name), exported: scope.env.isExported(name) }));
    for (const name of names) scope.env.set(name, assigned[name] ?? '', { export: true });
    try {
      return await run();
    } finally {
      for (const { name, value, exported } of saved) {
        // A name the builtin itself changed or removed keeps what it did.
        if (scope.env.get(name) !== assigned[name]) continue;
        if (value === undefined) {
          scope.env.unset(name);
          if (exported) scope.env.markExported(name, true);
        } else {
          scope.env.set(name, value, { export: exported });
        }
      }
    }
  }

  /** The command a path such as /bin/ls names, through its /usr/bin stub. */
  private stubSpec(name: string, scope: Scope): CommandSpec | undefined {
    if (!name.includes('/')) return undefined;
    const builtin = this.deps.fs.builtinAt?.(this.resolve(name, scope));
    return builtin === undefined ? undefined : this.deps.registry.get(builtin);
  }

  private expander(job: Job, io: Io, frame: Frame): Expander {
    const { clock } = this.deps;
    const scope = this.scope(frame);
    const user = scope.user;
    return new Expander({
      vars: scope.env,
      status: scope.status,
      pid: SHELL_PID,
      argv0: frame.argv0,
      args: frame.args,
      home: scope.home,
      cwd: scope.currentDir,
      userHome: (name) => {
        if (name === user.name) return user.home;
        if (name === 'has') return OWNER_HOME;
        if (name === 'root') return '/root';
        return undefined;
      },
      random: () => clock.random(),
      glob: createGlobber(scope.currentDir, this.globFs()),
      noglob: scope.options.noglob,
      exec: (source) => this.substitute(source, job, io, frame),
    });
  }

  /**
   * `$( )` and backticks: a subshell, so a `cd`, an assignment or an alias inside stays inside.
   * Aliases expand in it as they do at the prompt. `$(< file)` is the file's text.
   */
  private async substitute(source: string, job: Job, io: Io, frame: Frame): Promise<{ stdout: string; status: ExitCode }> {
    const scope = this.scope(frame).fork();
    const text = frame.aliasing === true ? expandAliases(source, scope.aliases).line : source;
    const parsed = parse(text);
    if (parsed.ok !== true) throw new ExpandError(failureMessage(source, parsed));
    const sub: Frame = { ...frame, interactive: false, scope };
    const only = parsed.ast.items.length === 1 ? parsed.ast.items[0] : undefined;
    const cmd = only !== undefined && !only.background && only.node.rest.length === 0 ? only.node.first.cmds : [];
    const read = cmd.length === 1 && !(only?.node.first.negate ?? true) ? cmd[0] : undefined;
    if (read !== undefined && read.words.length === 0 && read.assigns.length === 0 && read.redirects.length === 1 && read.redirects[0]?.op === '<') {
      return this.readSubstitution(read.redirects[0], job, io, sub);
    }
    const capture = new CaptureOut(io.stdout.columns);
    let status: ExitCode;
    try {
      status = await this.runList(parsed.ast, job, { stdin: new StringIn(''), stdout: capture, stderr: io.stderr }, sub);
    } catch (error) {
      // `$( )` is a subshell: `exit` there ends only it, and so does an expansion error.
      if (error instanceof ExitRequest) status = error.status;
      else if (error instanceof LineAborted) status = EXIT.error;
      else throw error;
    }
    return { stdout: capture.text, status };
  }

  /** `$(< file)`: the file's text, as `$(cat file)` would give it. */
  private async readSubstitution(redirect: Redirect, job: Job, io: Io, frame: Frame): Promise<{ stdout: string; status: ExitCode }> {
    const scope = this.scope(frame);
    const expander = this.expander(job, io, frame);
    try {
      const path = redirect.target === undefined ? '' : await expander.target(redirect.target);
      return { stdout: path === '/dev/null' ? '' : this.readForInput(path, scope), status: EXIT.ok };
    } catch (error) {
      return { stdout: '', status: await this.shellError(error, io) };
    }
  }

  private globFs(): GlobFs {
    const fs = this.deps.fs;
    return {
      readdir: (path) => {
        try {
          return fs.readdir(path, { all: true });
        } catch {
          return null;
        }
      },
      exists: (path) => fs.exists(path),
      isDirectory: (path) => {
        try {
          return fs.stat(path).type === 'directory';
        } catch {
          return false;
        }
      },
    };
  }

  private resolve(path: string, scope: Scope): string {
    return this.deps.fs.resolve(path, scope.currentDir, scope.home);
  }

  private async redirect(redirects: readonly Redirect[], io: Io, expander: Expander, opened: FileOut[], scope: Scope): Promise<Io> {
    let { stdin, stdout, stderr } = io;
    for (const redirect of redirects) {
      const target = redirect.target;
      switch (redirect.op) {
        case '2>&1':
          stderr = stdout;
          break;
        case '>&2':
          stdout = stderr;
          break;
        case '>&1':
          break;
        case '<<<':
          stdin = new StringIn(`${target ? await expander.string(target) : ''}\n`);
          break;
        case '<': {
          const path = target ? await expander.target(target) : '';
          stdin = new StringIn(path === '/dev/null' ? '' : this.readForInput(path, scope));
          break;
        }
        default: {
          const path = target ? await expander.target(target) : '';
          const append = redirect.op === '>>' || redirect.op === '2>>' || redirect.op === '&>>';
          // `>|` writes over a file even under noclobber.
          const force = redirect.op === '>|';
          const stream = this.openOutput(path, append, force, io, opened, scope);
          if (redirect.op === '>' || redirect.op === '>>' || redirect.op === '>|') stdout = stream;
          else if (redirect.op === '2>' || redirect.op === '2>>') stderr = stream;
          else {
            stdout = stream;
            stderr = stream;
          }
        }
      }
    }
    return { stdin, stdout, stderr };
  }

  private readForInput(path: string, scope: Scope): string {
    try {
      return this.deps.fs.readFile(this.resolve(path, scope));
    } catch (error) {
      if (error instanceof VfsError) throw new RedirectError(path, error);
      throw error;
    }
  }

  private openOutput(path: string, append: boolean, force: boolean, io: Io, opened: FileOut[], scope: Scope): OutStream {
    if (path === '/dev/null') return new NullOut();
    if (path === '/dev/stdout') return io.stdout;
    if (path === '/dev/stderr') return io.stderr;
    try {
      const noclobber = scope.options.noclobber && !append && !force;
      const file = new FileOut(this.deps.files.open(this.resolve(path, scope), { append, noclobber }));
      opened.push(file);
      return file;
    } catch (error) {
      if (error instanceof VfsError) throw new RedirectError(path, error);
      throw error;
    }
  }

  /**
   * A problem before the command could run. A redirection that cannot open its file fails that
   * command only. An expansion error (a bad substitution, an arithmetic error) is said, then
   * abandons the rest of the line, as interactive bash does.
   */
  private async shellError(error: unknown, io: Io): Promise<ExitCode> {
    if (error instanceof Interrupted || error instanceof JobDetached || error instanceof LineAborted) throw error;
    if (error instanceof AmbiguousRedirect) {
      await say(io.stderr, [span(`vesen: ${error.message}`, ERROR)]);
      return EXIT.error;
    }
    if (error instanceof ExpandError) {
      await say(io.stderr, [span(`vesen: ${error.message}`, ERROR)]);
      throw new LineAborted();
    }
    if (error instanceof RedirectError) {
      const reason = error.reason.code === 'EEXIST' ? 'cannot overwrite existing file' : strerror(error.reason.code);
      await say(io.stderr, [span(`vesen: ${error.path}: ${reason}`, ERROR)]);
      return EXIT.error;
    }
    throw error;
  }

  // ── Registry commands ──

  private async runSpec(
    spec: CommandSpec,
    name: string,
    argv: readonly string[],
    io: Io,
    env: CommandContext['env'],
    job: Job,
    frame: Frame,
  ): Promise<ExitCode> {
    const words = argv.slice(1);
    let parsed: ParsedArgs;
    if (takesRawArgs(spec)) {
      parsed = { opts: {}, args: words, help: !spec.handlesHelp && wantsLegacyHelp(words) };
    } else {
      try {
        parsed = parseFlags(words, spec, { interceptHelp: !spec.handlesHelp });
      } catch (error) {
        if (!(error instanceof FlagError)) throw error;
        await say(io.stderr, [span(`${errorPrefix(spec, name)}: ${error.message}`, ERROR)], [span(tryHelp(name), MUTED)]);
        return usageStatus(spec);
      }
    }
    if (parsed.help) {
      await this.printHelp(spec, io.stdout);
      return EXIT.ok;
    }
    if (spec.interactiveOnly === true && (!frame.interactive || !io.stdout.isTTY)) {
      // It changes the page itself, so a pipe, a script or ~/.bashrc must never set it off.
      await say(io.stderr, [span(`${name}: only at the prompt`, ERROR)]);
      return EXIT.error;
    }

    let args = parsed.args;
    let sub: string | undefined;
    const first = args[0];
    if (spec.subcommands && first !== undefined && Object.prototype.hasOwnProperty.call(spec.subcommands, first)) {
      sub = first;
      // A legacy command reads its subcommand from its words itself.
      if (!takesRawArgs(spec)) args = args.slice(1);
    }

    job.describe(spec.name, spec.loadingLabel?.(argv) ?? null);
    const budgetMs = spec.budgetMs ?? (spec.network ? DEFAULT_BUDGET_MS : undefined);
    const budget = budgetMs === undefined ? null : deadline(budgetMs);
    const signal = budget === null ? job.signal : combineSignals(job.signal, budget.signal);
    const ctx = this.context({ spec, name, argv, args, opts: parsed.opts, sub, io, env, signal, job, frame });

    try {
      let run: RunFn;
      try {
        run = spec.run ?? (await this.load(spec));
      } catch {
        await say(io.stderr, [span(`${name}: could not load the command. Check the connection and try again.`, ERROR)]);
        job.bell();
        return EXIT.error;
      }
      const running = Promise.resolve().then(() => run(ctx));
      const result = budget === null ? await running : await this.withinBudget(running, budget.signal);
      if (result === BUDGET_SPENT) {
        await say(io.stderr, [span(`${name}: timed out after ${Math.round((budgetMs ?? 0) / 1000)} s`, ERROR)]);
        return EXIT_TIMEOUT;
      }
      return typeof result === 'number' ? result : EXIT.ok;
    } catch (error) {
      return await this.commandError(error, spec, name, io, job, budget?.signal);
    } finally {
      budget?.cancel();
    }
  }

  private async load(spec: CommandSpec): Promise<RunFn> {
    if (spec.load === undefined) throw new Error(`${spec.name} has neither run nor load`);
    return (await spec.load()).run;
  }

  /** Waits for the command, or until its budget has run out and it has had a moment to stop. */
  private async withinBudget<T>(running: Promise<T>, budget: AbortSignal): Promise<T | typeof BUDGET_SPENT> {
    const spent = whenAborted(budget).then(
      () => new Promise<typeof BUDGET_SPENT>((resolve) => setTimeout(() => resolve(BUDGET_SPENT), BUDGET_GRACE_MS)),
    );
    const winner = await Promise.race([running, spent]);
    if (winner === BUDGET_SPENT) running.catch(() => {});
    return winner;
  }

  private async printHelp(spec: CommandSpec, stdout: OutStream): Promise<void> {
    if (spec.legacyHelp !== undefined) {
      await writeLegacyHtml(stdout, spec.legacyHelp);
      return;
    }
    const { commandHelp } = await import('./help');
    for (const block of commandHelp(spec)) await stdout.block(block);
  }

  private async commandError(
    error: unknown,
    spec: CommandSpec,
    name: string,
    io: Io,
    job: Job,
    budget: AbortSignal | undefined,
  ): Promise<ExitCode> {
    // `exit` ends whatever runs it: the script, the sourced file or the session; an expansion
    // error inside `source` ends the line.
    if (error instanceof ExitRequest || error instanceof LineAborted) throw error;
    if (error instanceof BrokenPipe) return EXIT.brokenPipe;
    if (error instanceof JobDetached || error instanceof Interrupted || job.signal.aborted) return EXIT.interrupted;
    if (error instanceof DeadlineExceeded) {
      await say(io.stderr, [span(`${name}: timed out after ${Math.round(error.ms / 1000)} s`, ERROR)]);
      return EXIT_TIMEOUT;
    }
    if (error instanceof UsageError) {
      const lines: Line[] = error.message === '' ? [] : [[span(`${errorPrefix(spec, name)}: ${error.message}`, ERROR)]];
      await say(io.stderr, ...lines, [span(tryHelp(name), MUTED)]);
      return usageStatus(spec);
    }
    if (error instanceof VfsError) {
      await say(io.stderr, [span(`${name}: ${error.path}: ${strerror(error.code)}`, ERROR)]);
      return EXIT.error;
    }
    if (this.deps.net.isError(error)) {
      const timedOut = error.kind === 'abort' && budget?.aborted === true;
      if (name === 'curl') {
        await say(io.stderr, [span(timedOut ? 'curl: (28) Operation timed out' : curlMessage(error), ERROR)]);
        return EXIT.error;
      }
      const message = timedOut ? `${error.host}: timed out` : error.message;
      await say(io.stderr, [span(`${name}: ${message}`, ERROR)]);
      return EXIT.error;
    }
    if (error instanceof ExpandError) {
      await say(io.stderr, [span(`${name}: ${error.message}`, ERROR)]);
      return EXIT.error;
    }
    const message = error instanceof Error ? error.message : String(error);
    await say(io.stderr, [span(`${name}: ${message}`, ERROR)]);
    return EXIT.error;
  }

  private context(o: {
    spec: CommandSpec;
    name: string;
    argv: readonly string[];
    args: readonly string[];
    opts: ParsedArgs['opts'];
    sub: string | undefined;
    io: Io;
    env: CommandContext['env'];
    signal: AbortSignal;
    job: Job;
    frame: Frame;
  }): CommandContext {
    const { deps } = this;
    const scope = this.scope(o.frame);
    const { name, io } = o;
    const prefix = errorPrefix(o.spec, name);
    const ctx: CommandContext = {
      name,
      argv: o.argv,
      args: o.args,
      opts: o.opts,
      ...(o.sub === undefined ? {} : { sub: o.sub }),
      stdin: io.stdin,
      stdout: io.stdout,
      stderr: io.stderr,
      fmt: createFmt(io.stdout.isTTY),
      env: o.env,
      cwd: scope.currentDir,
      fs: deps.fs,
      user: scope.user,
      signal: o.signal,
      tty: this.tty(o.job, o.frame, o.spec),
      net: deps.net,
      sys: deps.sys,
      clock: deps.clock,
      appearance: deps.appearance,
      shell: this.shellApi(o.job, io, o.frame),
      spec: o.spec,
      resolve: (path) => this.resolve(path, scope),
      fail: async (message, status = EXIT.error) => {
        await say(io.stderr, [span(`${prefix}: ${message}`, ERROR)]);
        return status;
      },
      usage: async (message) => {
        const lines: Line[] = message === undefined || message === '' ? [] : [[span(`${prefix}: ${message}`, ERROR)]];
        await say(io.stderr, ...lines, [span(tryHelp(name), MUTED)]);
        return usageStatus(o.spec);
      },
    };
    return ctx;
  }

  private tty(job: Job, frame: Frame, spec: CommandSpec): Tty {
    const { terminal, opener, clipboard } = this.deps;
    return {
      interactive: frame.interactive,
      get columns() {
        return terminal.size().cols;
      },
      get rows() {
        return terminal.size().rows;
      },
      touch: terminal.touch,
      inApp: terminal.inApp,
      status: (text) => job.describe(spec.name, text),
      readLine: (options) => this.readLine(job, options),
      confirm: async (message, options = {}) => {
        const yes = options.defaultAnswer === true;
        const answer = await this.readLine(job, { prompt: `${message} ${yes ? '[Y/n]' : '[y/N]'} ` });
        if (answer === null) return null;
        return answer.trim() === '' ? yes : /^\s*[yY]/.test(answer);
      },
      open: (url) => {
        // Preflight ran the command's opens() inside the gesture; the URL may differ slightly
        // (email's subject carries the time), but it is the same open, so it is not repeated.
        const preflighted = job.preflight.current;
        job.preflight.current = null;
        const done = preflighted !== null ? preflighted.result : opener?.autoOpen ? opener.preflight(url) : 'skipped';
        return Promise.resolve(done === 'skipped' ? 'card' : done);
      },
      copy: (text) => clipboard?.copy(text) ?? Promise.resolve(false),
      bell: () => job.bell(),
      clear: () => job.sink.clear(),
      fullscreen: () => Promise.reject(new Error('full-screen apps are not available yet')),
    };
  }

  /**
   * Reads a line at the prompt for a running command, then echoes it into the job's output as a
   * terminal does: the hint, the prompt and what was typed, or for a secret the prompt alone.
   */
  private async readLine(job: Job, options: { prompt: string; secret?: boolean; hint?: string; opens?: string }): Promise<string | null> {
    const read = this.deps.terminal.readLine;
    if (read === undefined || job.signal.aborted || job.sink.ended) return null;
    const url = options.opens;
    const answer = await read({
      prompt: options.prompt,
      ...(options.secret === true ? { secret: true } : {}),
      ...(options.hint === undefined ? {} : { hint: options.hint }),
      before: job.sink.snapshot(),
      signal: job.signal,
      ...(url === undefined
        ? {}
        : {
            opens: url,
            // tty.open takes this, as it takes what preflight opened for the line.
            opened: (result) => {
              job.preflight.current = { url, result };
            },
          }),
    });
    if (job.signal.aborted || job.sink.ended) return null;
    if (options.hint !== undefined) await job.sink.line('stdout', [span(options.hint, MUTED)]);
    const echoed = options.secret === true || answer === null ? '' : answer;
    await job.sink.line('stdout', [span(options.prompt + echoed)]);
    return answer;
  }

  private shellApi(job: Job, io: Io, frame: Frame): ShellApi {
    const scope = this.scope(frame);
    const registry = this.deps.registry;
    return {
      cwd: () => scope.currentDir,
      chdir: (path) => this.chdir(path, scope),
      lastStatus: () => scope.status,
      aliases: scope.aliases,
      history: scope.history,
      registry,
      options: scope.options,
      exec: async (line, streams = {}) => {
        const parsed = parse(line);
        const target: Io = {
          stdin: streams.stdin ?? new StringIn(''),
          stdout: streams.stdout ?? io.stdout,
          stderr: streams.stderr ?? io.stderr,
        };
        if (parsed.ok !== true) {
          await say(target.stderr, [span(`vesen: ${failureMessage(line, parsed)}`, ERROR)]);
          return EXIT.usage;
        }
        return this.runList(parsed.ast, job, target, { ...frame, interactive: false });
      },
      source: (path, args) => this.source(path, job, io, args === undefined ? frame : { ...frame, args }),
      // In a subshell, reset and login start its copy again and leave the session alone.
      reset: (options) => (scope.forked ? scope.reset() : this.reset(job, options)),
      login: (options) => this.login(job, options, frame),
    };
  }

  /** Moves `scope` (the session by default) to `path`, which must be a folder; throws a VfsError otherwise. */
  chdir(path: string, scope: Scope = this.session): void {
    const target = this.resolve(path, scope);
    let type: string;
    try {
      type = this.deps.fs.stat(target).type;
    } catch (error) {
      // Worded with the path as typed, as cd words it.
      if (error instanceof VfsError) throw new VfsError(error.code, path, 'chdir');
      throw error;
    }
    if (type !== 'directory') throw new VfsError('ENOTDIR', path, 'chdir');
    if (!this.deps.fs.access(target, 'x')) throw new VfsError('EACCES', path, 'chdir');
    scope.moveTo(target);
  }

  /** `reset`: a new session's variables, the seed files, no history, the default theme, the banner. */
  reset(job: Job | null, options: { files?: boolean } = {}): void {
    const { session, fs, appearance } = this.deps;
    session.reset();
    session.history.clear();
    if (options.files !== false) fs.restore?.();
    appearance.resetDefaults();
    job?.sink.reset();
  }

  /**
   * A new login session: a new session's variables, aliases and options in the home folder, then
   * /etc/profile and ~/.bashrc read quietly, as at boot. Files, history and the theme stay. With
   * `banner`, the screen is cleared and the banner shown.
   */
  async login(job: Job, options: { banner?: boolean } = {}, frame: Frame = TOP_FRAME): Promise<void> {
    const scope = this.scope(frame);
    scope.reset();
    if (options.banner && !scope.forked) job.sink.reset();
    const quiet: Io = { stdin: new StringIn(''), stdout: new NullOut(), stderr: new NullOut() };
    const top: Frame = scope.forked ? { ...TOP_FRAME, scope } : TOP_FRAME;
    for (const file of loginFiles(scope.home)) {
      try {
        await this.source(file, job, quiet, top);
      } catch (error) {
        // An `exit` in ~/.bashrc ends only the reading of it here, and so does an expansion error.
        if (!(error instanceof ExitRequest) && !(error instanceof LineAborted)) throw error;
      }
    }
    scope.setStatus(0);
  }

  // ── Scripts ──

  /** The script `name` refers to: a path, or a file on $PATH; 'denied' if it is not executable. */
  private findScript(name: string, scope: Scope): string | 'denied' | null {
    const { fs } = this.deps;
    if (fs.isExecutable === undefined) return null;
    if (name.includes('/')) {
      const path = this.resolve(name, scope);
      if (!fs.exists(path)) return null;
      return fs.isExecutable(path) ? path : 'denied';
    }
    for (const dir of (scope.env.get('PATH') ?? '').split(':')) {
      if (dir === '') continue;
      const path = this.resolve(`${dir}/${name}`, scope);
      if (fs.exists(path) && fs.isExecutable(path)) return path;
    }
    return null;
  }

  /**
   * Runs a script line by line, with its arguments as $1, $2 and so on. A script is its own
   * process: it sees only the exported variables (and its prefix assignments), no aliases, and
   * nothing it changes reaches the shell that ran it. Its #! line must name a shell.
   */
  private async runScript(
    path: string,
    argv: readonly string[],
    assigned: Readonly<Record<string, string>>,
    job: Job,
    io: Io,
    frame: Frame,
  ): Promise<ExitCode> {
    const name = argv[0] ?? path;
    if (frame.depth >= MAX_SCRIPT_DEPTH) {
      await say(io.stderr, [span(`vesen: ${name}: scripts nested more than ${MAX_SCRIPT_DEPTH} deep`, ERROR)]);
      return EXIT.error;
    }
    let text: string;
    try {
      text = this.deps.fs.readFile(path);
    } catch (error) {
      if (!(error instanceof VfsError)) throw error;
      await say(io.stderr, [span(`vesen: ${name}: ${strerror(error.code)}`, ERROR)]);
      return error.code === 'ENOENT' ? EXIT.notFound : EXIT.denied;
    }
    const refused = interpreterProblem(text, name);
    if (refused !== null) {
      await say(io.stderr, [span(refused.message, ERROR)]);
      return refused.status;
    }
    const scope = this.scope(frame).fork({ process: true, env: assigned });
    const child: Frame = { argv0: name, args: argv.slice(1), depth: frame.depth + 1, interactive: false, scope, aliasing: false };
    try {
      return await this.runText(text, name, job, io, child);
    } catch (error) {
      // A script runs as its own process: `exit` ends the script, not the shell, and an
      // expansion error ends it with status 1, as it ends a non-interactive bash.
      if (error instanceof ExitRequest) return error.status;
      if (error instanceof LineAborted) return EXIT.error;
      throw error;
    }
  }

  /**
   * `source`: runs a file's lines in this shell, so its aliases and variables stay. Used at boot
   * for /etc/profile and ~/.bashrc. A name without a slash that is not in the working directory
   * is looked for on $PATH, as bash does. A missing or unreadable file is status 1. An `exit` in
   * the file ends the session, as in bash. Files sourcing files nest at most MAX_SCRIPT_DEPTH
   * deep, so a ~/.bashrc that sources itself stops.
   */
  async source(path: string, job: Job, io: Io, frame: Frame = TOP_FRAME): Promise<ExitCode> {
    if (frame.depth >= MAX_SCRIPT_DEPTH) {
      await say(io.stderr, [span(`vesen: source: ${path}: maximum nesting level exceeded`, ERROR)]);
      return EXIT.error;
    }
    const scope = this.scope(frame);
    let text: string;
    try {
      text = this.deps.fs.readFile(this.sourcePath(path, scope));
    } catch (error) {
      if (!(error instanceof VfsError)) throw error;
      await say(io.stderr, [span(`vesen: ${path}: ${strerror(error.code)}`, ERROR)]);
      return EXIT.error;
    }
    return this.runText(text, path, job, io, { ...frame, depth: frame.depth + 1, interactive: false });
  }

  /** The file `source NAME` reads: NAME itself, or for a bare name missing here, the first on $PATH. */
  private sourcePath(path: string, scope: Scope): string {
    const here = this.resolve(path, scope);
    if (path.includes('/') || this.deps.fs.exists(here)) return here;
    for (const dir of (scope.env.get('PATH') ?? '').split(':')) {
      if (dir === '') continue;
      const found = this.resolve(`${dir}/${path}`, scope);
      if (this.deps.fs.exists(found)) return found;
    }
    return here;
  }

  /**
   * Runs text as a script: one parsed line at a time, joining lines that continue. Aliases
   * expand line by line when the frame allows it (a file sourced by the interactive shell), so
   * an alias a line defines works on the next, as in bash.
   */
  private async runText(text: string, name: string, job: Job, io: Io, frame: Frame): Promise<ExitCode> {
    const lines = text.split('\n');
    if (lines[0]?.startsWith('#!')) lines[0] = '';
    let status: ExitCode = EXIT.ok;
    let pending = '';
    let startLine = 1;
    for (const [i, line] of lines.entries()) {
      this.checkAborted(job);
      if (pending === '') startLine = i + 1;
      pending = pending === '' ? line : `${pending}\n${line}`;
      let parsed = parse(pending);
      if (parsed.ok === true && frame.aliasing === true) {
        const expanded = expandAliases(pending, this.scope(frame).aliases);
        if (expanded.changed) parsed = parse(expanded.line);
      }
      if (parsed.ok !== true) {
        if (parsed.incomplete === true) continue;
        await say(io.stderr, [span(`${name}: line ${startLine}: ${parsed.message}`, ERROR)]);
        return EXIT.usage;
      }
      pending = '';
      status = await this.runList(parsed.ast, job, io, frame);
    }
    if (pending.trim() !== '') {
      const parsed = parse(pending);
      if (parsed.ok !== true && parsed.incomplete === true) {
        await say(io.stderr, [span(`${name}: line ${startLine}: ${describeIncomplete(pending, parsed.reason)}`, ERROR)]);
        return EXIT.usage;
      }
    }
    return status;
  }

  // ── Not found ──

  private async notFound(name: string, argv: readonly string[], io: Io, job: Job): Promise<ExitCode> {
    const { near, hint } = this.deps.registry.suggest(name);
    let label: string | undefined;
    let line: string | undefined;
    const glued = /^([A-Za-z0-9]+)(--help|-h)$/.exec(name);
    if (glued?.[1] !== undefined && this.deps.registry.get(glued[1]) !== undefined) {
      // `pwd--help`: the space was missed.
      label = `${glued[1]} --help`;
      line = label;
    } else if (near[0] !== undefined) {
      label = near[0];
      const rest = argv.slice(1);
      line = rest.length > 0 && rest.every((word) => PLAIN_WORD.test(word)) ? [label, ...rest].join(' ') : label;
    }
    const second: Line =
      label !== undefined && line !== undefined
        ? [span('Did you mean ', MUTED), out.run(label, line, ACCENT), span("? Type 'help' to see all commands.", MUTED)]
        : [span(hint ?? "Type 'help' to see all commands.", MUTED)];
    await say(io.stderr, [span(`vesen: ${name}: command not found`, ERROR)], second);
    job.bell();
    return EXIT.notFound;
  }

  private checkAborted(job: Job): void {
    if (job.signal.aborted) throw new Interrupted();
  }
}

const BUDGET_SPENT: unique symbol = Symbol('budget spent');

/** bash's message for a line that did not parse. */
export function failureMessage(source: string, parsed: ParseFailure): string {
  return parsed.incomplete === true ? describeIncomplete(source, parsed.reason) : parsed.message;
}

/** How a command's errors start: `vesen: cd` for a builtin, as bash says `bash: cd`; the name otherwise. */
export function errorPrefix(spec: CommandSpec, name: string): string {
  return spec.builtin === true ? `vesen: ${name}` : name;
}

/** The status of a usage error: the spec's, else 2 for a builtin, as bash's, and 1 as GNU coreutils exit. */
export function usageStatus(spec: CommandSpec): ExitCode {
  return spec.usageStatus ?? (spec.builtin === true ? EXIT.usage : EXIT.error);
}

/** The shells a script's #! line may name; vesen runs every script itself. */
const SHELLS = new Set(['sh', 'bash', 'dash', 'vesh']);

/**
 * Why a script's #! line stops it, as Linux says it: an interpreter vesen does not have, such as
 * python3. Null when there is no #! line or it names a shell.
 */
export function interpreterProblem(text: string, name: string): { message: string; status: ExitCode } | null {
  const first = text.split('\n', 1)[0] ?? '';
  if (!first.startsWith('#!')) return null;
  const [interpreter = '', argument] = first.slice(2).trim().split(/[ \t]+/);
  if (interpreter === '') return null;
  const base = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
  if (base(interpreter) === 'env') {
    if (argument === undefined || SHELLS.has(base(argument))) return null;
    return { message: `${interpreter}: '${argument}': No such file or directory`, status: EXIT.notFound };
  }
  if (SHELLS.has(base(interpreter))) return null;
  return { message: `vesen: ${name}: ${interpreter}: bad interpreter: No such file or directory`, status: EXIT.denied };
}

/** A redirection that could not open its file. */
class RedirectError extends Error {
  constructor(
    readonly path: string,
    readonly reason: VfsError,
  ) {
    super(`${path}: ${strerror(reason.code)}`);
    this.name = 'RedirectError';
  }
}

export { Interrupted };
