// The shell as the UI sees it while the kernel's chunk loads. The kernel (parser, executor,
// streams, the legacy adapter) is the largest part of the app, so it loads right after the first
// paint instead of before it: the banner and the prompt appear at once, and a line typed before
// the chunk arrives runs as soon as it does. ^C still works on such a line.

import type { JobHandle, JobOrigin, JobResult, PreflightResult, ScreenSink, ShellPort } from '../shell/index';
import { readonly, writable, type Readable } from '../shell/observable';
import { GUEST, type ExitCode, type JobInfo } from '../shell/types';

export interface LazyShell extends ShellPort {
  /** Resolves with the shell once its chunk has loaded. */
  readonly ready: Promise<ShellPort>;
}

/** A line typed before the kernel arrived. */
interface Waiting {
  readonly line: string;
  readonly origin: JobOrigin | undefined;
  /** ^C came while it waited. */
  cancelled: boolean;
  started(handle: JobHandle): void;
  failed(error: unknown): void;
}

/** Copies a store's values into another, from now on. */
function forward<T>(from: Readable<T>, to: { set(value: T): void }): void {
  from.subscribe((value) => to.set(value));
}

export interface LazyShellOptions {
  /** Where a line that waited for a chunk that never came is recorded. */
  readonly screen?: ScreenSink;
  readonly now?: () => number;
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

  const failure = (line: string, origin: JobOrigin | undefined, id: number, error: unknown): JobResult => {
    const message = error instanceof Error ? error.message : String(error);
    const text = `vesen: the shell could not load (${message}). Reload the page to try again.`;
    const result: JobResult = {
      status: 1,
      interrupted: false,
      screen: 'keep',
      blocks: [{ type: 'lines', stream: 'stderr', lines: [[{ text, style: { fg: 'error' } }]] }],
    };
    options.screen?.commit({ ...result, id, line, origin: origin ?? 'keyboard' });
    return result;
  };

  const ready = load().then(
    (loaded) => {
      shell = loaded;
      for (const line of remembered.splice(0)) loaded.remember(line);
      // The waiting lines start before the stores are forwarded, so the job never reads as idle
      // in between. Each one interrupts the one before, as lines typed at a busy shell do.
      for (const entry of waiting.splice(0)) {
        const handle = loaded.start(entry.line, entry.origin);
        if (entry.cancelled) handle.abort();
        entry.started(handle);
      }
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

  const start = (line: string, origin?: JobOrigin): JobHandle => {
    if (shell !== null) return shell.start(line, origin);
    nextId -= 1;
    const id = nextId;
    job.set({ name: line.trim().split(/\s+/)[0] ?? '', label: null, startedAt: now() });
    let entry: Waiting | undefined;
    const done = new Promise<JobResult>((resolve) => {
      entry = {
        line,
        origin,
        cancelled: false,
        started: (handle) => resolve(handle.done),
        failed: (error) => resolve(failure(line, origin, id, error)),
      };
    });
    const waits = entry as Waiting;
    waiting.push(waits);
    return {
      id,
      done,
      abort: () => {
        waits.cancelled = true;
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
      for (const entry of waiting) entry.cancelled = true;
      return true;
    },
    remember: (line) => {
      if (shell !== null) shell.remember(line);
      else remembered.push(line);
    },
  };
}
