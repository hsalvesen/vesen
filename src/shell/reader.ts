// Reading a line from the terminal for a running command (ctx.tty.readLine): `rm -i` asking
// before each removal, sudo asking for a password. The kernel puts the request in a store; the
// prompt shows its prompt in place of PS1, under the command's entry and what it has printed so
// far, and answers with what was typed, or null for ^C or ^D. A tap read is answered by a tap
// instead: its prompt is a button, and the answer the empty string.
// DOM-free: the UI subscribes to `request` and calls `answer`.
//
// A secret answer (sudo's password, `read -s`) is handed to the command and to nothing else: it
// is never kept here, never written to the screen, history or storage, and the prompt clears it.
// With feedback (sudo's, as sudoers' pwfeedback gives it) each character typed shows as an
// asterisk, and the asterisks stay on the line when it is answered; without, nothing shows.

import { readonly, writable, type Readable } from './observable';

/** What each character of a secret read with feedback shows as, while typed and after. */
export const FEEDBACK_MASK = '*';

export interface ReadOptions {
  /** Shown where PS1 would be, and echoed with the answer: `rm: remove regular file 'a'? `. */
  readonly prompt: string;
  /** Masked as it is typed, never echoed and never stored: a password. */
  readonly secret?: boolean;
  /** For a secret: an asterisk for each character, as it is typed and on the line after, as sudo's pwfeedback shows. */
  readonly feedback?: boolean;
  /** A dim line above the prompt. */
  readonly hint?: string;
  /** Aborts the read (with null) when the job is interrupted. */
  readonly signal?: AbortSignal;
  /**
   * A URL to open inside the key press that answers, as a command's opens() does inside the
   * Enter that runs it; `opened` hears how that went.
   */
  readonly opens?: string;
  readonly opened?: (result: 'opened' | 'blocked' | 'skipped') => void;
  /**
   * A track the command will play once answered, readied inside the key press that answers:
   * Safari, every browser on iOS and in-app browsers let a page start sound only inside a gesture
   * (services/warm-show.ts unlockAudio).
   */
  readonly unlocks?: string;
  /**
   * Answered by a tap on the prompt, or Enter or Space on it, rather than by a typed line: the
   * prompt is a button, and the answer is the empty string. A tap is a gesture every browser
   * lets start sound, where a key on a phone's own keyboard may not be. Never with `secret`.
   */
  readonly tap?: boolean;
}

/** A read waiting for the prompt, as the UI sees it. */
export interface ReadRequest {
  readonly id: number;
  readonly prompt: string;
  readonly secret: boolean;
  /** A secret whose characters show as asterisks (ReadOptions.feedback). */
  readonly feedback: boolean;
  readonly hint: string | null;
  /** Answered by a tap, not typed (ReadOptions.tap). */
  readonly tap: boolean;
}

export interface LineReader {
  /** The read waiting for an answer, or null. */
  readonly request: Readable<ReadRequest | null>;
  /** Waits for the prompt to answer; null on ^C, ^D, or when the signal aborts. */
  read(options: ReadOptions): Promise<string | null>;
  /**
   * The prompt's answer to read `id`: what was typed, or null for ^D. Call it synchronously
   * inside the key press, so a URL the read opens may open, and a track it unlocks may play.
   */
  answer(id: number, text: string | null): void;
}

export function createLineReader(
  preflight?: (url: string) => 'opened' | 'blocked' | 'skipped',
  unlock?: (track: string) => void,
): LineReader {
  const request = writable<ReadRequest | null>(null);
  let nextId = 0;
  let pending: { readonly id: number; readonly options: ReadOptions; settle(text: string | null): void } | null = null;

  const answer = (id: number, text: string | null): void => {
    const current = pending;
    if (current === null || current.id !== id) return;
    const { opens, opened, unlocks } = current.options;
    if (opens !== undefined && text !== null) opened?.(preflight?.(opens) ?? 'skipped');
    if (unlocks !== undefined && text !== null) unlock?.(unlocks);
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
        const secret = options.secret === true;
        request.set({ id, prompt: options.prompt, secret, feedback: secret && options.feedback === true, hint: options.hint ?? null, tap: !secret && options.tap === true });
      });
    },
  };
}
