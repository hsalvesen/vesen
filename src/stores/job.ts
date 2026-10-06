// The one command that is running, and how to interrupt it.
// Temporary: the shell Session absorbs this in Phase 2 (docs/plan/02-architecture-and-contracts.md, section 4).
import { writable, type Readable } from 'svelte/store';

export interface Job {
  /** The run token: unique per run, so output that arrives after an interrupt is recognised and dropped. */
  readonly id: number;
  readonly name: string;
  readonly startedAt: number;
}

export type JobOutcome<T> = { readonly status: 'done'; readonly value: T } | { readonly status: 'interrupted' };

const current = writable<Job | null>(null);

/** The running job, or null while the prompt is idle. */
export const job: Readable<Job | null> = { subscribe: current.subscribe };

let active: { readonly id: number; readonly controller: AbortController } | null = null;
let lastId = 0;

/**
 * Runs `task` as the current job. Settles as soon as the task finishes or the job is interrupted,
 * whichever comes first. The task's signal aborts on interrupt; a task that ignores it is
 * abandoned, and whatever it returns later is dropped.
 */
export async function runJob<T>(
  name: string,
  task: (signal: AbortSignal) => T | Promise<T>,
): Promise<JobOutcome<T>> {
  interruptJob();
  const id = ++lastId;
  const controller = new AbortController();
  active = { id, controller };
  current.set({ id, name, startedAt: Date.now() });

  const interrupted = new Promise<JobOutcome<T>>((resolve) => {
    controller.signal.addEventListener('abort', () => resolve({ status: 'interrupted' }), { once: true });
  });
  const finished = (async (): Promise<JobOutcome<T>> => {
    const value = await task(controller.signal);
    return active?.id === id ? { status: 'done', value } : { status: 'interrupted' };
  })();

  try {
    return await Promise.race([finished, interrupted]);
  } finally {
    if (active?.id === id) {
      active = null;
      current.set(null);
    }
  }
}

/** Interrupts the running job, if any. Returns whether there was one. */
export function interruptJob(): boolean {
  if (!active) return false;
  const { controller } = active;
  active = null;
  current.set(null);
  controller.abort();
  return true;
}
