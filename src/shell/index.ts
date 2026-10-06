// The shell facade (docs/plan/designs/shell-architecture.md, "src/shell/index.ts"). The UI calls
// preflight() inside the Enter or tap gesture, then start(); everything else (history and alias
// expansion, parsing, running, the job and ^C, the bell, the screen) happens here, DOM-free, with
// the browser reached only through the injected services.

import { whenAborted } from '../lib/signals';
import type { Block, Line } from '../output/model';
import type { Appearance, Bell, Clipboard, Clock, KV, Net, Opener, SysInfo } from '../services/types';
import { expandAliases } from './alias';
import type { SimpleCommand } from './ast';
import { Executor, Interrupted, TOP_FRAME, failureMessage, type Io, type Job, type Preflighted, type ShellFs, type TerminalInfo } from './executor';
import { expandHistory } from './histexpand';
import { readonly, type Readable } from './observable';
import { parse } from './parser';
import { Session, type HistoryStore, type JobState } from './session';
import { JobDetached, TtyIn, TtyOut, TtySink, vfsWriteTarget, type ScreenAction, type WriteTarget } from './streams';
import { EXIT, type CommandSpec, type Env, type ExitCode, type JobInfo, type Registry, type User } from './types';

export type { ShellFs, TerminalInfo } from './executor';
export type { ScreenAction, WriteTarget } from './streams';

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
}

/** The transcript, provided by the UI: it records each line once it has finished. */
export interface ScreenSink {
  commit(entry: ScreenCommit): void;
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
  start(line: string, origin?: JobOrigin): JobHandle;
  /** start(line).done. */
  run(line: string, origin?: JobOrigin): Promise<JobResult>;
  /** ^C: interrupts the running job. Returns whether there was one. */
  abort(): boolean;
  /** Adds a line to history without running it, as the sudo password prompt does. */
  remember(line: string): void;
}

export interface Shell extends ShellPort {
  readonly registry: Registry;
  readonly env: Env;
  readonly history: HistoryStore;
  readonly aliases: Map<string, string>;
  /** `reset` without a job: variables, files, history and the theme, as a new session has them. */
  reset(options?: { files?: boolean }): void;
}

export interface ShellDeps {
  readonly registry: Registry;
  readonly fs: ShellFs;
  /** Where redirections write; defaults to fs.writeFile. */
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
  readonly user?: User;
  /** Lets the browser run between large writes to the screen; tests pass a resolved promise. */
  readonly yieldToHost?: () => Promise<void>;
}

const DEFAULT_TERMINAL: TerminalInfo = { size: () => ({ cols: 80, rows: 24 }), touch: false, inApp: null };

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
  const executor = new Executor({
    session,
    registry: deps.registry,
    fs: deps.fs,
    files: deps.files ?? vfsWriteTarget(deps.fs),
    net: deps.net,
    clock: deps.clock,
    sys: deps.sys,
    appearance: deps.appearance,
    terminal,
    opener: deps.opener,
    clipboard: deps.clipboard,
    bell: deps.bell,
  });
  // The legacy commands start where the session does.
  deps.fs.setLegacyCwd?.(session.currentDir);

  let pending: (Preflighted & { readonly line: string }) | null = null;

  const jobStore: Readable<JobInfo | null> = {
    subscribe: (run) => session.jobs.store.subscribe((state: JobState | null) => run(state)),
    get: () => session.jobs.store.get(),
  };

  async function runLine(line: string, job: Job, io: Io, origin: JobOrigin): Promise<ExitCode> {
    let text = line;
    if (origin !== 'boot') {
      const history = expandHistory(line, session.history);
      if (history.ok !== true) {
        await io.stderr.line({ text: `vesen: ${history.error}`, style: { fg: 'error' } });
        return EXIT.error;
      }
      if (history.changed) {
        // As bash does, the line that runs is shown, and it is what history keeps.
        text = history.line;
        await io.stdout.line(text);
      }
      session.history.add(text);
    }
    const parsed = parse(expandAliases(text, session.aliases).line);
    if (parsed.ok !== true) {
      await io.stderr.line({ text: `vesen: ${failureMessage(text, parsed)}`, style: { fg: 'error' } });
      job.bell();
      return EXIT.usage;
    }
    return executor.runList(parsed.ast, job, io, TOP_FRAME);
  }

  function start(line: string, origin: JobOrigin = 'keyboard'): JobHandle {
    const preflighted = pending?.line === line ? pending : null;
    pending = null;
    const first = line.trim().split(/\s+/)[0] ?? '';
    const { id, signal } = session.jobs.begin(first, deps.clock.now());
    let belled = false;
    const sink = new TtySink({
      onStderr: () => job.bell(),
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
    // ^C seals the screen at once, before anything the job does next can write to it.
    signal.addEventListener('abort', () => sink.seal(), { once: true });
    session.syncSize();
    const columns = (): number => terminal.size().cols;
    const io: Io = { stdin: new TtyIn(), stdout: new TtyOut(sink, 'stdout', columns), stderr: new TtyOut(sink, 'stderr', columns) };

    const work = runLine(line, job, io, origin);
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
        if (error instanceof Interrupted || error instanceof JobDetached) {
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
      session.jobs.end(id);
      const result: JobResult = { status, interrupted, blocks: shown, screen };
      deps.screen?.commit({ ...result, id, line, origin });
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
      const history = expandHistory(line, session.history);
      if (history.ok !== true) return null;
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
    preflight,
    start,
    run: (line, origin) => start(line, origin).done,
    abort: () => session.jobs.abort(),
    remember: (line) => session.history.add(line),
    reset: (options) => executor.reset(null, options),
  };
}
