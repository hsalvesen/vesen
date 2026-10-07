// The shell facade (docs/plan/designs/shell-architecture.md, "src/shell/index.ts"). The UI calls
// preflight() inside the Enter or tap gesture, then start(); everything else (history and alias
// expansion, parsing, running, the job and ^C, the bell, the screen) happens here, DOM-free, with
// the browser reached only through the injected services.

import { whenAborted } from '../lib/signals';
import type { Block, Line } from '../output/model';
import type { Appearance, Bell, Clipboard, Clock, Digest, KV, Net, Opener, SysInfo } from '../services/types';
import { expandAliases } from './alias';
import { createAppRunner, type AppRequest } from './apps';
import { createCompletionEnv } from './complete/env';
import type { Completion, CompletionEnv } from './complete/types';
import {
  Executor,
  Interrupted,
  LineAborted,
  TOP_FRAME,
  failureMessage,
  type Io,
  type Job,
  type Preflighted,
  type ShellFs,
  type TerminalInfo,
} from './executor';
import type { IncompleteReason, SimpleCommand } from './ast';
import { expandHistory, type HistoryState } from './histexpand';
import { readonly, writable, type Readable } from './observable';
import { parse } from './parser';
import { promptLine } from './prompt';
import { createLineReader, type ReadRequest } from './reader';
import { Session, type HistoryStore, type JobState } from './session';
import { JobDetached, NullOut, StringIn, TtyIn, TtyOut, TtySink, vfsWriteTarget, type LiveOutput, type ScreenAction, type WriteTarget } from './streams';
import { EXIT, ExitRequest, type CommandSpec, type Env, type ExitCode, type JobInfo, type Registry, type User } from './types';

export type { AppRequest } from './apps';
export type { Completion, CompletionEnv } from './complete/types';
export type { ShellFs, TerminalInfo } from './executor';
export type { ReadRequest } from './reader';
export type { IncompleteReason } from './ast';
export type { LiveOutput, ScreenAction, WriteTarget } from './streams';

/** Where a line came from. */
export type JobOrigin = 'keyboard' | 'chip' | 'link' | 'boot';

/** What a finished (or interrupted) line left on the screen. */
export interface JobResult {
  readonly status: ExitCode;
  readonly interrupted: boolean;
  /** Its output, after any clear or reset it did; an interrupted line ends with `^C`. */
  readonly blocks: readonly Block[];
  /** `clear` empties the screen first; `reset` puts the banner back first. */
  readonly screen: ScreenAction;
}

/** One finished line, as the transcript records it. */
export interface ScreenCommit extends JobResult {
  readonly id: number;
  readonly line: string;
  readonly origin: JobOrigin;
  /** The prompt the line was typed at, as it looked then: its folder and the status before it. */
  readonly prompt: Line;
  readonly startedAt: number;
  readonly endedAt: number;
}

/** A line that has just started, as the transcript shows it while it runs. */
export interface ScreenStart {
  readonly id: number;
  readonly line: string;
  readonly origin: JobOrigin;
  /** The prompt the line was typed at. */
  readonly prompt: Line;
  readonly startedAt: number;
  /**
   * The id a line typed before the kernel arrived had while it waited (app/lazy-shell.ts): the
   * entry begun for it then is this job's, so the line shows once.
   */
  readonly continues?: number;
  /** The job's output so far, as it would show now. */
  output(): LiveOutput;
}

/**
 * The transcript, provided by the UI. A line's entry is begun the moment it starts (F013), its
 * output is drawn as the job writes it, and commit() records how it ended.
 */
export interface ScreenSink {
  /** Line `start.id` has started: its entry goes on the screen now, with the line and no output. */
  begin?(start: ScreenStart): void;
  /**
   * Job `id` has written something (or cleared the screen) since it began or last changed. Its
   * start's output() shows what; the sink decides when to look, such as once a frame.
   */
  changed?(id: number): void;
  commit(entry: ScreenCommit): void;
}

/** How a line is started. */
export interface StartOptions {
  /** The id of the entry a line typed before the kernel arrived already has (ScreenStart.continues). */
  readonly continues?: number;
  /** False: the line is not kept in history. Ctrl+D's `exit`, which bash runs and never records. */
  readonly record?: boolean;
}

export interface JobHandle {
  readonly id: number;
  readonly done: Promise<JobResult>;
  /** Interrupts this job, if it is still running. */
  abort(): void;
}

/** What preflight found: the words of a single simple command, and its spec. */
export interface PreflightResult {
  readonly argv: readonly string[];
  readonly spec: CommandSpec | undefined;
  /** Set when the spec's opens() gave a URL: whether it opened inside the gesture. */
  readonly opened?: Preflighted['result'];
}

/**
 * What the UI needs from the shell. A Shell is one; so is the facade the app uses while the
 * kernel's chunk is still loading (app/lazy-shell.ts).
 */
export interface ShellPort {
  readonly cwd: Readable<string>;
  readonly lastStatus: Readable<ExitCode>;
  /** The running line, or null while the prompt is idle. */
  readonly job: Readable<JobInfo | null>;
  /**
   * Call synchronously inside the Enter or tap gesture, before start(). For a single simple
   * command whose spec has opens(), opens the URL through the opener service now, while the
   * browser still allows it. Never throws.
   */
  preflight(line: string): PreflightResult | null;
  /** Runs a line as the job, interrupting any job still running. */
  start(line: string, origin?: JobOrigin, options?: StartOptions): JobHandle;
  /** start(line).done. */
  run(line: string, origin?: JobOrigin): Promise<JobResult>;
  /** ^C: interrupts the running job. Returns whether there was one. */
  abort(): boolean;
  /** Adds a line to history without running it: a line ^C ended before the kernel arrived. */
  remember(line: string): void;
  /** Command history, oldest first, for Up, Down, Ctrl+R, Alt+. and the ghost. */
  readonly historyLines: Readable<readonly string[]>;
  /** A running command waiting for a line at the prompt (rm -i, sudo's password), or null. */
  readonly reads: Readable<ReadRequest | null>;
  /**
   * The prompt's answer to read `id`: what was typed, or null for ^D. Call it synchronously
   * inside the key press, so a URL the command opens on the answer may open.
   */
  answerRead(id: number, text: string | null): void;
  /**
   * Why `line` is not finished (an open quote, a trailing | or &&, a backslash at the end), or
   * null when it is. Enter on an unfinished line shows the `> ` prompt for the rest. Never throws.
   */
  incomplete(line: string): IncompleteReason | null;
  /** The prompt as it looks now, for a line the UI records itself (an empty line, ^C). */
  renderPrompt(): Line;
  /**
   * Tab completion, the ghost and the chips: the engine bound to this session. Null until the
   * engine's chunk has loaded, which the first subscriber starts.
   */
  readonly completion: Readable<Completion | null>;
  /** The full-screen app a running command shows over the terminal (the Shutdown screen), or null. */
  readonly apps: Readable<AppRequest | null>;
  /** The UI closes app `id`, handing the command the app's result. */
  closeApp(id: number, result?: unknown): void;
  /**
   * Moves to `path` without running a line or touching history: the folder the session snapshot
   * kept, after Back. Ignored when it is not a folder the visitor may enter. Never throws.
   */
  restoreCwd(path: string): void;
}

export interface Shell extends ShellPort {
  readonly registry: Registry;
  readonly env: Env;
  readonly history: HistoryStore;
  readonly aliases: Map<string, string>;
  /** What completion reads from this session: commands, files, variables, aliases and history. */
  readonly completionEnv: CompletionEnv;
  /** `reset` without a job: variables, files, history and the theme, as a new session has them. */
  reset(options?: { files?: boolean }): void;
  /**
   * Runs a file's lines in this session, as `source` does, outside any job: at boot, for
   * /etc/profile and ~/.bashrc. With `quiet`, nothing it prints is shown. It is interrupted
   * after `timeoutMs` (2 s), so a saved ~/.bashrc that never ends cannot stop the shell starting.
   */
  source(path: string, options?: { quiet?: boolean; timeoutMs?: number }): Promise<ExitCode>;
}

export interface ShellDeps {
  readonly registry: Registry;
  readonly fs: ShellFs;
  /** Where redirections write; defaults to the file system's openWrite, or its writeFile. */
  readonly files?: WriteTarget;
  /** Keeps history across reloads; null keeps it for the session only. */
  readonly storage?: KV<'local'> | null;
  readonly net: Net;
  readonly clock: Clock;
  readonly sys: SysInfo;
  readonly appearance: Appearance;
  readonly screen?: ScreenSink;
  readonly terminal?: TerminalInfo;
  readonly opener?: Opener;
  readonly clipboard?: Clipboard;
  readonly bell?: Bell;
  readonly digest?: Digest;
  readonly user?: User;
  /** Lets the browser run between large writes to the screen; tests pass a resolved promise. */
  readonly yieldToHost?: () => Promise<void>;
  /** What else `reset` forgets, outside the session: weather's saved places. */
  readonly onReset?: () => void;
}

/** How long a file sourced at boot may run before it is interrupted. */
export const SOURCE_TIMEOUT_MS = 2000;

const DEFAULT_TERMINAL: TerminalInfo = { size: () => ({ cols: 80, rows: 24 }), touch: false, inApp: null };

/**
 * A store that loads the completion engine's chunk when it is first subscribed to. When the
 * catalogue arrives it gives a new value, so the completions, the ghost and the chips are worked
 * out again with the new commands.
 */
function lazyCompletion(env: CompletionEnv, registry: Registry): Readable<Completion | null> {
  const store = writable<Completion | null>(null);
  let loading = false;
  const load = (): void => {
    if (loading) return;
    loading = true;
    import('./complete/index').then(
      ({ engine }) => {
        store.set({ engine, env });
        registry.onChange(() => store.set({ engine, env }));
      },
      () => {
        // Offline, say: the next subscriber tries again.
        loading = false;
      },
    );
  };
  return {
    subscribe(run) {
      load();
      return store.subscribe(run);
    },
    get: () => store.get(),
  };
}

/** The text of a word made only of literal parts and `~`, or null if it needs expanding. */
function literalWord(parts: SimpleCommand['words'][number]['parts'], home: string): string | null {
  let text = '';
  for (const part of parts) {
    if (part.kind === 'lit') text += part.text;
    else if (part.kind === 'tilde' && part.user === undefined) text += home;
    else return null;
  }
  return text;
}

export function createShell(deps: ShellDeps): Shell {
  const terminal = deps.terminal ?? DEFAULT_TERMINAL;
  const session = new Session({ storage: deps.storage ?? null, ...(deps.user ? { user: deps.user } : {}), size: () => terminal.size() });
  // A command reading a line waits on the prompt, unless the terminal answers reads itself.
  const reader = createLineReader((url) => deps.opener?.preflight(url) ?? 'skipped');
  const apps = createAppRunner();
  const tty: TerminalInfo = {
    size: () => terminal.size(),
    get touch() {
      return terminal.touch;
    },
    get inApp() {
      return terminal.inApp;
    },
    readLine: terminal.readLine ?? ((options) => reader.read(options)),
    fullscreen: terminal.fullscreen ?? ((view, props, signal) => apps.open(view, props, signal)),
  };
  const historyLines: Readable<readonly string[]> = {
    subscribe: (run) => session.history.subscribe((entries) => run(entries.map((entry) => entry.line))),
    get: () => session.history.list().map((entry) => entry.line),
  };
  const executor = new Executor({
    session,
    registry: deps.registry,
    fs: deps.fs,
    files: deps.files ?? writeTarget(deps.fs),
    net: deps.net,
    clock: deps.clock,
    sys: deps.sys,
    appearance: deps.appearance,
    terminal: tty,
    opener: deps.opener,
    clipboard: deps.clipboard,
    bell: deps.bell,
    digest: deps.digest,
    yieldToHost: deps.yieldToHost,
    onReset: deps.onReset,
  });
  const renderPrompt = (): Line =>
    promptLine({ cwd: session.currentDir, status: session.status, columns: terminal.size().cols, home: session.user.home });
  const completionEnv = createCompletionEnv({
    registry: deps.registry,
    fs: deps.fs,
    cwd: () => session.currentDir,
    home: () => session.home,
    vars: () => session.env.entries(),
    aliases: () => session.aliases,
    history: () => session.history.list().map((entry) => entry.line),
    appearance: deps.appearance,
  });

  let pending: (Preflighted & { readonly line: string }) | null = null;
  /** The last :s replacement, for !!:& on a later line. */
  const historyState: HistoryState = {};
  /** Set by `exit`: the next line starts a new login session before it runs. */
  let ended = false;

  const jobStore: Readable<JobInfo | null> = {
    subscribe: (run) => session.jobs.store.subscribe((state: JobState | null) => run(state)),
    get: () => session.jobs.store.get(),
  };

  async function runLine(line: string, job: Job, io: Io, origin: JobOrigin, fresh: boolean, record: boolean): Promise<ExitCode> {
    // The session ended with `exit`; a key or a tap starts a new one, files kept.
    if (fresh) await executor.login(job);
    let text = line;
    if (origin !== 'boot') {
      const history = expandHistory(line, session.history, historyState);
      if (history.ok !== true) {
        await io.stderr.line({ text: `vesen: ${history.error}`, style: { fg: 'error' } });
        return EXIT.error;
      }
      if (history.changed) {
        // As bash does, the line that runs is shown, and it is what history keeps.
        text = history.line;
        await io.stdout.line(text);
      }
      if (record) session.history.add(text);
      // `!rm:p` only shows the line, so it can be checked before it is run.
      if (history.printOnly === true) return EXIT.ok;
    }
    const parsed = parse(expandAliases(text, session.aliases).line);
    if (parsed.ok !== true) {
      await io.stderr.line({ text: `vesen: ${failureMessage(text, parsed)}`, style: { fg: 'error' } });
      job.bell();
      return EXIT.usage;
    }
    try {
      return await executor.runList(parsed.ast, job, io, TOP_FRAME);
    } catch (error) {
      // An expansion error was said and abandoned the rest of the line.
      if (error instanceof LineAborted) return EXIT.error;
      throw error;
    }
  }

  function start(line: string, origin: JobOrigin = 'keyboard', options: StartOptions = {}): JobHandle {
    const preflighted = pending?.line === line ? pending : null;
    pending = null;
    const fresh = ended && origin !== 'boot';
    if (fresh) {
      ended = false;
      // At once, so the line is shown at the new session's prompt.
      session.reset();
    }
    const first = line.trim().split(/\s+/)[0] ?? '';
    const prompt = renderPrompt();
    const startedAt = deps.clock.now();
    const { id, signal } = session.jobs.begin(first, startedAt);
    let belled = false;
    const transcript = deps.screen;
    const sink = new TtySink({
      onStderr: () => job.bell(),
      ...(transcript?.changed ? { onChange: () => transcript.changed?.(id) } : {}),
      ...(deps.yieldToHost ? { yieldToHost: deps.yieldToHost } : {}),
    });
    const job: Job = {
      id,
      signal,
      sink,
      preflight: { current: preflighted === null ? null : { url: preflighted.url, result: preflighted.result } },
      bell: () => {
        if (belled) return;
        belled = true;
        deps.bell?.ring();
      },
      describe: (name, label) => session.jobs.describe(id, name, label),
    };
    // ^C seals the screen before anything the job does next can write to it. Only what the abort
    // event itself writes still lands, so a command can say its last words: ping's statistics.
    signal.addEventListener('abort', () => void Promise.resolve().then(() => sink.seal()), { once: true });
    // The line shows at once, with its output to follow as the job writes it (F013).
    transcript?.begin?.({
      id,
      line,
      origin,
      prompt,
      startedAt,
      ...(options.continues === undefined ? {} : { continues: options.continues }),
      output: () => sink.view(),
    });
    session.syncSize();
    const columns = (): number => terminal.size().cols;
    const io: Io = { stdin: new TtyIn(), stdout: new TtyOut(sink, 'stdout', columns), stderr: new TtyOut(sink, 'stderr', columns) };

    const work = runLine(line, job, io, origin, fresh, options.record !== false);
    const done = (async (): Promise<JobResult> => {
      // null when ^C came first.
      const outcome: { status: ExitCode } | { error: unknown } | null = await Promise.race([
        work.then(
          (status): { status: ExitCode } => ({ status }),
          (error: unknown): { error: unknown } => ({ error }),
        ),
        whenAborted(signal).then(() => null),
      ]);
      let status: ExitCode;
      let interrupted = false;
      if (outcome === null) {
        interrupted = true;
        status = EXIT.interrupted;
        // The rest of the line is skipped; anything it still writes is dropped.
        work.catch(() => {});
      } else if ('error' in outcome) {
        const error = outcome.error;
        if (error instanceof ExitRequest) {
          // `exit` ended the session: what it printed stays, and the next line starts a new one.
          status = error.status;
          ended = true;
        } else if (error instanceof Interrupted || error instanceof JobDetached) {
          interrupted = true;
          status = EXIT.interrupted;
        } else {
          status = EXIT.error;
          const message = error instanceof Error ? error.message : String(error);
          await io.stderr.line({ text: `vesen: ${message}`, style: { fg: 'error' } }).catch(() => {});
        }
      } else {
        status = outcome.status;
      }
      const { blocks, screen } = sink.finish();
      const caret: Line = [{ text: '^C' }];
      const shown: readonly Block[] = interrupted ? [...blocks, { type: 'lines', lines: [caret], stream: 'stdout' }] : blocks;
      session.setStatus(status);
      // After `exit`, the live prompt is already the next session's: home, and a clean $.
      if (ended) session.reset();
      session.jobs.end(id);
      const result: JobResult = { status, interrupted, blocks: shown, screen };
      deps.screen?.commit({ ...result, id, line, origin, prompt, startedAt, endedAt: deps.clock.now() });
      return result;
    })();

    return {
      id,
      done,
      abort: () => {
        if (session.jobs.store.get()?.id === id) session.jobs.abort();
      },
    };
  }

  function preflight(line: string): PreflightResult | null {
    pending = null;
    try {
      const history = expandHistory(line, session.history, { ...historyState });
      if (history.ok !== true || history.printOnly === true) return null;
      const parsed = parse(expandAliases(history.line, session.aliases).line);
      if (parsed.ok !== true || parsed.ast.items.length !== 1) return null;
      const node = parsed.ast.items[0]?.node;
      const cmd = node?.first.cmds[0];
      if (node === undefined || cmd === undefined || node.rest.length > 0 || node.first.cmds.length !== 1 || node.first.negate) {
        return null;
      }
      const argv: string[] = [];
      for (const word of cmd.words) {
        const text = literalWord(word.parts, session.home);
        if (text === null) return null;
        argv.push(text);
      }
      const name = argv[0];
      if (name === undefined) return null;
      const spec = deps.registry.get(name);
      const url = spec?.opens !== undefined && cmd.redirects.length === 0 && cmd.assigns.length === 0 ? spec.opens(argv) : null;
      if (url === null || url === undefined) return { argv, spec };
      const result = deps.opener?.preflight(url) ?? 'skipped';
      pending = { line, url, result };
      return { argv, spec, opened: result };
    } catch {
      return null;
    }
  }

  return {
    cwd: session.cwd,
    lastStatus: session.lastStatus,
    job: readonly(jobStore),
    registry: deps.registry,
    env: session.env,
    history: session.history,
    aliases: session.aliases,
    completionEnv,
    completion: lazyCompletion(completionEnv, deps.registry),
    preflight,
    start,
    run: (line, origin) => start(line, origin).done,
    abort: () => session.jobs.abort(),
    remember: (line) => session.history.add(line),
    historyLines,
    reads: reader.request,
    answerRead: (id, text) => reader.answer(id, text),
    apps: apps.request,
    closeApp: (id, result) => apps.close(id, result),
    restoreCwd: (path) => {
      try {
        executor.chdir(path);
      } catch {
        // Gone, or no longer a folder: the session starts where it is.
      }
    },
    incomplete: (line) => {
      try {
        const parsed = parse(line);
        return parsed.ok !== true && parsed.incomplete === true ? parsed.reason : null;
      } catch {
        return null;
      }
    },
    reset: (options) => executor.reset(null, options),
    renderPrompt,
    source: async (path, options = {}) => {
      // Its own job, which nothing on the screen shows; ^C cannot reach it, the deadline can.
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), options.timeoutMs ?? SOURCE_TIMEOUT_MS);
      const sink = new TtySink({ ...(deps.yieldToHost ? { yieldToHost: deps.yieldToHost } : {}) });
      const job: Job = {
        id: 0,
        signal: controller.signal,
        sink,
        preflight: { current: null },
        bell: () => {},
        describe: () => {},
      };
      const columns = (): number => terminal.size().cols;
      const io: Io = options.quiet
        ? { stdin: new StringIn(''), stdout: new NullOut(), stderr: new NullOut() }
        : { stdin: new StringIn(''), stdout: new TtyOut(sink, 'stdout', columns), stderr: new TtyOut(sink, 'stderr', columns) };
      try {
        const work = executor.source(path, job, io, TOP_FRAME);
        work.catch(() => {});
        return await Promise.race([work, whenAborted(controller.signal).then(() => EXIT.interrupted)]);
      } catch (error) {
        // An `exit` in a file read at boot ends only the reading of it, as an expansion error does.
        if (error instanceof ExitRequest) return error.status;
        return EXIT.error;
      } finally {
        clearTimeout(deadline);
        controller.abort();
        sink.finish();
      }
    },
  };
}

/** Where redirections write: the file system's own handles when it has them. */
function writeTarget(fs: ShellFs): WriteTarget {
  const open = fs.openWrite;
  if (open === undefined) return vfsWriteTarget(fs);
  return { open: (path, options) => open.call(fs, path, options) };
}
