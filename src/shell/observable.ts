// Stores for kernel state (cwd, lastStatus, the job) that follow the Svelte store contract, so
// components can read them with `$cwd`, without the kernel importing svelte.
//
// The contract: subscribe(run) calls `run` at once with the current value and again on every
// change, and returns a function that unsubscribes. As with svelte/store's writable, setting a
// primitive to the value it already has notifies no one; objects always notify.

export type Subscriber<T> = (value: T) => void;
export type Unsubscriber = () => void;

export interface Readable<T> {
  subscribe(run: Subscriber<T>): Unsubscriber;
  /** The current value, without subscribing. */
  get(): T;
}

export interface Writable<T> extends Readable<T> {
  set(value: T): void;
  update(change: (value: T) => T): void;
}

function changed(a: unknown, b: unknown): boolean {
  // Like svelte's safe_not_equal: NaN equals itself, and objects always count as changed.
  return !Object.is(a, b) || (typeof a === 'object' && a !== null) || typeof a === 'function';
}

export function writable<T>(initial: T): Writable<T> {
  let value = initial;
  const subscribers = new Set<Subscriber<T>>();

  const set = (next: T): void => {
    if (!changed(value, next)) return;
    value = next;
    // A copy, so a subscriber that unsubscribes or subscribes during the call is safe.
    for (const run of [...subscribers]) run(value);
  };

  return {
    subscribe(run: Subscriber<T>): Unsubscriber {
      // Wrapped, so the same function may subscribe twice and unsubscribe each separately.
      const entry: Subscriber<T> = (v) => run(v);
      subscribers.add(entry);
      run(value);
      return () => {
        subscribers.delete(entry);
      };
    },
    get: () => value,
    set,
    update: (change) => set(change(value)),
  };
}

/** A read-only view of a writable. */
export function readonly<T>(store: Readable<T>): Readable<T> {
  return { subscribe: (run) => store.subscribe(run), get: () => store.get() };
}
