// Reading a line from the terminal for a running command (ctx.tty.readLine): `rm -i` asking
// before each removal, sudo asking for a password. The kernel puts the request in a store; the
// prompt shows its prompt in place of PS1, under the command's entry and what it has printed so
// far, and answers with what was typed, or null for ^C or ^D.
// DOM-free: the UI subscribes to `request` and calls `answer`.
//
// A secret answer (sudo's password) is handed to the command and to nothing else: it is never
// kept here, never written to the screen, history or storage, and the prompt clears it.

import { readonly, writable, type Readable } from './observable';

export interface ReadOptions {
  /** Shown where PS1 would be, and echoed with the answer: `rm: remove regular file 'a'? `. */
  readonly prompt: string;
  /** Masked as it is typed, never echoed and never stored: a password. */
  readonly secret?: boolean;
  /** A dim line above the prompt: sudo's `(this is a joke; nothing you type is kept)`. */
  readonly hint?: string;
  /** Aborts the read (with null) when the job is interrupted. */
  readonly signal?: AbortSignal;
  /**
   * A URL to open inside the key press that answers, as a command's opens() does inside the
   * Enter that runs it; `opened` hears how that went.
   */
  readonly opens?: string;
  readonly opened?: (result: 'opened' | 'blocked' | 'skipped') => void;
}

/** A read waiting for the prompt, as the UI sees it. */
export interface ReadRequest {
  readonly id: number;
  readonly prompt: string;
  readonly secret: boolean;
  readonly hint: string | null;
}

export interface LineReader {
  /** The read waiting for an answer, or null. */
  readonly request: Readable<ReadRequest | null>;
  /** Waits for the prompt to answer; null on ^C, ^D, or when the signal aborts. */
  read(options: ReadOptions): Promise<string | null>;
  /**
   * The prompt's answer to read `id`: what was typed, or null for ^D. Call it synchronously
   * inside the key press, so a URL the read opens may open.
   */
  answer(id: number, text: string | null): void;
}

export function createLineReader(preflight?: (url: string) => 'opened' | 'blocked' | 'skipped'): LineReader {
  const request = writable<ReadRequest | null>(null);
  let nextId = 0;
  let pending: { readonly id: number; readonly options: ReadOptions; settle(text: string | null): void } | null = null;

  const answer = (id: number, text: string | null): void => {
    const current = pending;
    if (current === null || current.id !== id) return;
    const { opens, opened } = current.options;
    if (opens !== undefined && text !== null) opened?.(preflight?.(opens) ?? 'skipped');
    current.settle(text);
  };

  return {
    request: readonly(request),
    answer,
    read(options) {
      // A read already waiting is ended first: one prompt at a time.
      if (pending !== null) pending.settle(null);
      const signal = options.signal;
      if (signal?.aborted === true) return Promise.resolve(null);
      const id = ++nextId;
      return new Promise<string | null>((resolve) => {
        const onAbort = (): void => entry.settle(null);
        const entry = {
          id,
          options,
          settle(text: string | null): void {
            if (pending !== entry) return;
            pending = null;
            signal?.removeEventListener('abort', onAbort);
            request.set(null);
            resolve(text);
          },
        };
        pending = entry;
        signal?.addEventListener('abort', onAbort, { once: true });
        request.set({ id, prompt: options.prompt, secret: options.secret === true, hint: options.hint ?? null });
      });
    },
  };
}
