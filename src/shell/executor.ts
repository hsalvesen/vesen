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
import { ExpandError, Expander } from './expand';
import { FlagError, parseFlags, takesRawArgs, tryHelp, wantsLegacyHelp, type ParsedArgs } from './flags';
import { createFmt } from './fmt';
import { createGlobber, type GlobFs } from './glob';
import { describeIncomplete, parse } from './parser';
import type { Session } from './session';
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

/** Scripts calling scripts may nest this deep. */
export const MAX_SCRIPT_DEPTH = 16;

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

/** What changes inside a script: its arguments, name and depth. */
export interface Frame {
  readonly argv0: string;
  readonly args: readonly string[];
  readonly depth: number;
  readonly interactive: boolean;
}

export const TOP_FRAME: Frame = { argv0: 'vesen', args: [], depth: 0, interactive: true };

/** Thrown inside a job once it has been interrupted, to skip the rest of the line. */
class Interrupted extends Error {
  constructor() {
    super('interrupted');
    this.name = 'Interrupted';
  }
}

const span = (text: string, style?: SpanStyle): Span => (style === undefined ? { text } : { text, style });

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
  constructor(private readonly deps: ExecutorDeps) {}

  private get session(): Session {
    return this.deps.session;
  }

  // ── Lists ──

  async runList(list: List, job: Job, io: Io, frame: Frame): Promise<ExitCode> {
    let status = this.session.status;
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
          return await this.runCommand(cmd, job, stageIo, frame);
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
    this.session.setStatus(status);
    return status;
  }

  // ── One command ──

  private async runCommand(cmd: SimpleCommand, job: Job, io: Io, frame: Frame): Promise<ExitCode> {
    this.checkAborted(job);
    const expander = this.expander(job, io, frame);
    const opened: FileOut[] = [];
    try {
      let argv: string[];
      const assigned: Record<string, string> = {};
      let cmdIo: Io;
      try {
        argv = await expander.fields(cmd.words);
        for (const assign of cmd.assigns) assigned[assign.name] = await expander.string(assign.value);
        cmdIo = await this.redirect(cmd.redirects, io, expander, opened);
      } catch (error) {
        return await this.shellError(error, io);
      }
      this.checkAborted(job);

      const name = argv[0];
      if (name === undefined) {
        // Only assignments (and perhaps redirections): they set shell variables.
        for (const key of Object.keys(assigned)) this.session.env.set(key, assigned[key] ?? '');
        return expander.substStatus ?? 0;
      }

      const env = Object.keys(assigned).length > 0 ? this.session.env.child(assigned) : this.session.env;
      const spec = this.deps.registry.get(name) ?? this.stubSpec(name);
      if (spec !== undefined) return await this.runSpec(spec, name, argv, cmdIo, env, job, frame);

      const script = this.findScript(name);
      if (script === 'denied') {
        await say(cmdIo.stderr, [span(`vesen: ${name}: Permission denied`, ERROR)]);
        return EXIT.denied;
      }
      if (script !== null) return await this.runScript(script, argv, job, cmdIo, frame);
      return await this.notFound(name, argv, cmdIo, job);
    } finally {
      for (const file of opened) file.close();
    }
  }

  /** The command a path such as /bin/ls names, through its /usr/bin stub. */
  private stubSpec(name: string): CommandSpec | undefined {
    if (!name.includes('/')) return undefined;
    const builtin = this.deps.fs.builtinAt?.(this.resolve(name));
    return builtin === undefined ? undefined : this.deps.registry.get(builtin);
  }

  private expander(job: Job, io: Io, frame: Frame): Expander {
    const { session, clock } = this.deps;
    const user = session.user;
    return new Expander({
      vars: session.env,
      status: session.status,
      pid: SHELL_PID,
      argv0: frame.argv0,
      args: frame.args,
      home: session.home,
      cwd: session.currentDir,
      userHome: (name) => {
        if (name === user.name) return user.home;
        if (name === 'has') return OWNER_HOME;
        if (name === 'root') return '/root';
        return undefined;
      },
      random: () => clock.random(),
      glob: createGlobber(session.currentDir, this.globFs()),
      noglob: session.options.noglob,
      exec: async (source) => {
        const parsed = parse(source);
        if (parsed.ok !== true) throw new ExpandError(failureMessage(source, parsed));
        const capture = new CaptureOut(io.stdout.columns);
        const status = await this.runList(parsed.ast, job, { stdin: new StringIn(''), stdout: capture, stderr: io.stderr }, {
          ...frame,
          interactive: false,
        });
        return { stdout: capture.text, status };
      },
    });
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

  private resolve(path: string): string {
    return this.deps.fs.resolve(path, this.session.currentDir, this.session.home);
  }

  private async redirect(redirects: readonly Redirect[], io: Io, expander: Expander, opened: FileOut[]): Promise<Io> {
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
        case '<<<':
          stdin = new StringIn(`${target ? await expander.string(target) : ''}\n`);
          break;
        case '<': {
          const path = target ? await expander.target(target) : '';
          stdin = new StringIn(path === '/dev/null' ? '' : this.readForInput(path));
          break;
        }
        default: {
          const path = target ? await expander.target(target) : '';
          const append = redirect.op === '>>' || redirect.op === '2>>';
          const stream = this.openOutput(path, append, io, opened);
          if (redirect.op === '>' || redirect.op === '>>') stdout = stream;
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

  private readForInput(path: string): string {
    try {
      return this.deps.fs.readFile(this.resolve(path));
    } catch (error) {
      if (error instanceof VfsError) throw new RedirectError(path, error);
      throw error;
    }
  }

  private openOutput(path: string, append: boolean, io: Io, opened: FileOut[]): OutStream {
    if (path === '/dev/null') return new NullOut();
    if (path === '/dev/stdout') return io.stdout;
    if (path === '/dev/stderr') return io.stderr;
    try {
      const noclobber = this.session.options.noclobber && !append;
      const file = new FileOut(this.deps.files.open(this.resolve(path), { append, noclobber }));
      opened.push(file);
      return file;
    } catch (error) {
      if (error instanceof VfsError) throw new RedirectError(path, error);
      throw error;
    }
  }

  /** A problem before the command could run: expansion or a redirection. */
  private async shellError(error: unknown, io: Io): Promise<ExitCode> {
    if (error instanceof Interrupted || error instanceof JobDetached) throw error;
    if (error instanceof ExpandError) {
      await say(io.stderr, [span(`vesen: ${error.message}`, ERROR)]);
      return EXIT.error;
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
        await say(io.stderr, [span(`${name}: ${error.message}`, ERROR)], [span(tryHelp(name), MUTED)]);
        return EXIT.usage;
      }
    }
    if (parsed.help) {
      await this.printHelp(spec, io.stdout);
      return EXIT.ok;
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
      return await this.commandError(error, name, io, job, budget?.signal);
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

  private async commandError(error: unknown, name: string, io: Io, job: Job, budget: AbortSignal | undefined): Promise<ExitCode> {
    if (error instanceof BrokenPipe) return EXIT.brokenPipe;
    if (error instanceof JobDetached || error instanceof Interrupted || job.signal.aborted) return EXIT.interrupted;
    if (error instanceof DeadlineExceeded) {
      await say(io.stderr, [span(`${name}: timed out after ${Math.round(error.ms / 1000)} s`, ERROR)]);
      return EXIT_TIMEOUT;
    }
    if (error instanceof UsageError) {
      const lines: Line[] = error.message === '' ? [] : [[span(`${name}: ${error.message}`, ERROR)]];
      await say(io.stderr, ...lines, [span(tryHelp(name), MUTED)]);
      return EXIT.usage;
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
    const { deps, session } = this;
    const { name, io } = o;
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
      cwd: session.currentDir,
      fs: deps.fs,
      user: session.user,
      signal: o.signal,
      tty: this.tty(o.job, o.frame, o.spec),
      net: deps.net,
      sys: deps.sys,
      clock: deps.clock,
      appearance: deps.appearance,
      shell: this.shellApi(o.job, io, o.frame),
      spec: o.spec,
      resolve: (path) => this.resolve(path),
      fail: async (message, status = EXIT.error) => {
        await say(io.stderr, [span(`${name}: ${message}`, ERROR)]);
        return status;
      },
      usage: async (message) => {
        const lines: Line[] = message === undefined || message === '' ? [] : [[span(`${name}: ${message}`, ERROR)]];
        await say(io.stderr, ...lines, [span(tryHelp(name), MUTED)]);
        return EXIT.usage;
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
      // Reading from the terminal arrives with the line editor (docs/plan/03-terminal-input.md).
      readLine: () => Promise.resolve(null),
      confirm: () => Promise.resolve(null),
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

  private shellApi(job: Job, io: Io, frame: Frame): ShellApi {
    const { session, registry } = { session: this.session, registry: this.deps.registry };
    return {
      cwd: () => session.currentDir,
      chdir: (path) => this.chdir(path),
      lastStatus: () => session.status,
      aliases: session.aliases,
      history: session.history,
      registry,
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
      reset: (options) => this.reset(job, options),
    };
  }

  /** Moves the session to `path`, which must be a folder; throws a VfsError otherwise. */
  chdir(path: string): void {
    const target = this.resolve(path);
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
    this.session.moveTo(target);
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

  // ── Scripts ──

  /** The script `name` refers to: a path, or a file on $PATH; 'denied' if it is not executable. */
  private findScript(name: string): string | 'denied' | null {
    const { fs } = this.deps;
    if (fs.isExecutable === undefined) return null;
    if (name.includes('/')) {
      const path = this.resolve(name);
      if (!fs.exists(path)) return null;
      return fs.isExecutable(path) ? path : 'denied';
    }
    for (const dir of (this.session.env.get('PATH') ?? '').split(':')) {
      if (dir === '') continue;
      const path = this.resolve(`${dir}/${name}`);
      if (fs.exists(path) && fs.isExecutable(path)) return path;
    }
    return null;
  }

  /** Runs a script line by line through this shell, with its arguments as $1, $2 and so on. */
  private async runScript(path: string, argv: readonly string[], job: Job, io: Io, frame: Frame): Promise<ExitCode> {
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
    const child: Frame = { argv0: name, args: argv.slice(1), depth: frame.depth + 1, interactive: false };
    return this.runText(text, name, job, io, child);
  }

  /**
   * `source`: runs a file's lines in this session, so its aliases and variables stay. Used at
   * boot for /etc/profile and ~/.bashrc. A missing or unreadable file is status 1.
   */
  async source(path: string, job: Job, io: Io, frame: Frame = TOP_FRAME): Promise<ExitCode> {
    let text: string;
    try {
      text = this.deps.fs.readFile(this.resolve(path));
    } catch (error) {
      if (!(error instanceof VfsError)) throw error;
      await say(io.stderr, [span(`vesen: ${path}: ${strerror(error.code)}`, ERROR)]);
      return EXIT.error;
    }
    return this.runText(text, path, job, io, { ...frame, interactive: false });
  }

  /** Runs text as a script: one parsed line at a time, joining lines that continue. */
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
      const parsed = parse(pending);
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
