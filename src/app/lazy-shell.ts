// The shell as the UI sees it while the kernel's chunk loads. The kernel (parser, executor,
// streams, the legacy adapter) is the largest part of the app, so it loads right after the first
// paint instead of before it: the banner and the prompt appear at once, and a line typed before
// the chunk arrives runs as soon as it does. ^C on such a line ends it at once, with ^C and
// status 130, and it never runs.

import type { Line } from '../output/model';
import type { JobHandle, JobOrigin, JobResult, PreflightResult, ScreenSink, ShellPort } from '../shell/index';
import { readonly, writable, type Readable } from '../shell/observable';
import { promptLine } from '../shell/prompt';
import { GUEST, type ExitCode, type JobInfo } from '../shell/types';

export interface LazyShell extends ShellPort {
  /** Resolves with the shell once its chunk has loaded. */
  readonly ready: Promise<ShellPort>;
}

/** A line typed before the kernel arrived. */
interface Waiting {
  readonly line: string;
  readonly origin: JobOrigin | undefined;
  started(handle: JobHandle): void;
  failed(error: unknown): void;
  /** ^C came while it waited: it ends now, and never runs. */
  cancel(): void;
}

/** Copies a store's values into another, from now on. */
function forward<T>(from: Readable<T>, to: { set(value: T): void }): void {
  from.subscribe((value) => to.set(value));
}

export interface LazyShellOptions {
  /** Where a line that waited for a chunk that never came is recorded. */
  readonly screen?: ScreenSink;
  readonly now?: () => number;
  /** The terminal's width, for the prompt until the shell is here. */
  readonly columns?: () => number;
}

export function lazyShell(load: () => Promise<ShellPort>, options: LazyShellOptions = {}): LazyShell {
  const now = options.now ?? Date.now;
  const cwd = writable(GUEST.home);
  const lastStatus = writable<ExitCode>(0);
  const job = writable<JobInfo | null>(null);
  let shell: ShellPort | null = null;
  /** Lines to remember once the shell is here. */
  const remembered: string[] = [];
  /** Lines typed while the chunk loads, oldest first. */
  const waiting: Waiting[] = [];
  let nextId = 0;

  const renderPrompt = (): Line =>
    shell?.renderPrompt() ?? promptLine({ cwd: cwd.get(), status: lastStatus.get(), columns: options.columns?.() ?? 80 });

  const failure = (line: string, origin: JobOrigin | undefined, id: number, error: unknown, prompt: Line, startedAt: number): JobResult => {
    const message = error instanceof Error ? error.message : String(error);
    const text = `vesen: the shell could not load (${message}). Reload the page to try again.`;
    const result: JobResult = {
      status: 1,
      interrupted: false,
      screen: 'keep',
      blocks: [{ type: 'lines', stream: 'stderr', lines: [[{ text, style: { fg: 'error' } }]] }],
    };
    options.screen?.commit({ ...result, id, line, origin: origin ?? 'keyboard', prompt, startedAt, endedAt: now() });
    return result;
  };

  const ready = load().then(
    (loaded) => {
      shell = loaded;
      for (const line of remembered.splice(0)) loaded.remember(line);
      // The waiting lines start before the stores are forwarded, so the job never reads as idle
      // in between. Each one interrupts the one before, as lines typed at a busy shell do.
      for (const entry of waiting.splice(0)) entry.started(loaded.start(entry.line, entry.origin));
      forward(loaded.cwd, cwd);
      forward(loaded.lastStatus, lastStatus);
      forward(loaded.job, job);
      return loaded;
    },
    (error: unknown) => {
      job.set(null);
      for (const entry of waiting.splice(0)) entry.failed(error);
      throw error;
    },
  );
  // A failed load is reported to the lines that wait for it.
  ready.catch(() => {});

  /**
   * ^C on a line still waiting for the kernel: it ends at once with ^C and status 130, as the
   * kernel would end it, is kept in history, and never runs.
   */
  const interrupted = (line: string, origin: JobOrigin | undefined, id: number, prompt: Line, startedAt: number): JobResult => {
    const result: JobResult = {
      status: 130,
      interrupted: true,
      screen: 'keep',
      blocks: [{ type: 'lines', stream: 'stdout', lines: [[{ text: '^C' }]] }],
    };
    if (origin !== 'boot') remembered.push(line);
    options.screen?.commit({ ...result, id, line, origin: origin ?? 'keyboard', prompt, startedAt, endedAt: now() });
    return result;
  };

  const start = (line: string, origin?: JobOrigin): JobHandle => {
    if (shell !== null) return shell.start(line, origin);
    nextId -= 1;
    const id = nextId;
    const prompt = renderPrompt();
    const startedAt = now();
    job.set({ name: line.trim().split(/\s+/)[0] ?? '', label: null, startedAt });
    let entry: Waiting | undefined;
    const done = new Promise<JobResult>((resolve) => {
      let settled = false;
      const settle = (result: JobResult | Promise<JobResult>): void => {
        if (settled) return;
        settled = true;
        resolve(result);
      };
      entry = {
        line,
        origin,
        started: (handle) => settle(handle.done),
        failed: (error) => settle(failure(line, origin, id, error, prompt, startedAt)),
        cancel: () => {
          const at = waiting.indexOf(entry as Waiting);
          if (at === -1) return;
          waiting.splice(at, 1);
          settle(interrupted(line, origin, id, prompt, startedAt));
          if (waiting.length === 0) job.set(null);
        },
      };
    });
    const waits = entry as Waiting;
    waiting.push(waits);
    return {
      id,
      done,
      abort: () => {
        if (shell === null) waits.cancel();
      },
    };
  };

  return {
    ready,
    cwd: readonly(cwd),
    lastStatus: readonly(lastStatus),
    job: readonly(job),
    preflight: (line): PreflightResult | null => shell?.preflight(line) ?? null,
    start,
    run: (line, origin) => start(line, origin).done,
    abort: () => {
      if (shell !== null) return shell.abort();
      if (waiting.length === 0) return false;
      for (const entry of [...waiting]) entry.cancel();
      return true;
    },
    remember: (line) => {
      if (shell !== null) shell.remember(line);
      else remembered.push(line);
    },
    renderPrompt,
  };
}
