// Readline's editing commands as pure functions on the line (docs/plan/designs/terminal-input.md,
// "src/shell/editor/readline.ts"; designs/shell-architecture.md, section 7). Each op takes the
// line, the cursor and the kill ring and returns the new line and ring; the prompt controller
// writes the result into the input. Nothing here touches the page.
//
// Words are readline's: Alt+B, Alt+F, Alt+D and Alt+Backspace stop at anything that is not a
// letter or a digit, so `cd /home/guest/docs` is five words to them; Ctrl+W (unix-word-rubout)
// stops only at spaces, so the path is one.
//
// The kill ring keeps the last KILL_RING_MAX kills, newest first. Kills in a row join into one
// entry, as in readline: killing backwards puts the text in front, forwards behind. Ctrl+Y yanks
// the newest; Alt+Y right after it swaps in the one before.

import type { EditState } from '../complete/types';

export type EditOp =
  | 'bol'
  | 'eol'
  | 'charLeft'
  | 'charRight'
  | 'wordLeft'
  | 'wordRight'
  | 'killToStart'
  | 'killToEnd'
  | 'killWordBackUnix'
  | 'killWordBackAlnum'
  | 'killWordFwd'
  | 'yank'
  | 'yankPop'
  | 'deleteChar'
  | 'transpose';

/** The ops that put text in the kill ring. */
export const KILL_OPS: ReadonlySet<EditOp> = new Set(['killToStart', 'killToEnd', 'killWordBackUnix', 'killWordBackAlnum', 'killWordFwd']);

/** How many kills the ring keeps. */
export const KILL_RING_MAX = 10;

export interface KillRing {
  /** Killed text, newest first. */
  readonly entries: readonly string[];
  /** The edit before this one was a kill in this direction, so the next kill joins it. */
  readonly lastKill: 'back' | 'forward' | null;
  /** What the last yank put on the line, so Alt+Y can swap it for an older kill. */
  readonly yank: { readonly from: number; readonly to: number; readonly index: number } | null;
}

export const EMPTY_RING: KillRing = { entries: [], lastKill: null, yank: null };

/** The ring after an edit that is not a kill or a yank: the next kill starts a new entry. */
export function settleRing(ring: KillRing): KillRing {
  return ring.lastKill === null && ring.yank === null ? ring : { entries: ring.entries, lastKill: null, yank: null };
}

const WORD = /[\p{L}\p{N}]/u;
const SPACE = /\s/;

const isWordChar = (ch: string | undefined): boolean => ch !== undefined && WORD.test(ch);
const isSpace = (ch: string | undefined): boolean => ch !== undefined && SPACE.test(ch);

const isHigh = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/** The offset one character before `i`, stepping over a surrogate pair as one character. */
export function prevBoundary(text: string, i: number): number {
  if (i <= 0) return 0;
  return i >= 2 && isLow(text.charCodeAt(i - 1)) && isHigh(text.charCodeAt(i - 2)) ? i - 2 : i - 1;
}

/** The offset one character after `i`, stepping over a surrogate pair as one character. */
export function nextBoundary(text: string, i: number): number {
  if (i >= text.length) return text.length;
  return i + 1 < text.length && isHigh(text.charCodeAt(i)) && isLow(text.charCodeAt(i + 1)) ? i + 2 : i + 1;
}

/** Where Alt+B lands: back over anything that is not a word, then back over the word. */
export function wordStartBefore(text: string, i: number): number {
  let at = Math.min(Math.max(i, 0), text.length);
  while (at > 0 && !isWordChar(text[at - 1])) at -= 1;
  while (at > 0 && isWordChar(text[at - 1])) at -= 1;
  return at;
}

/** Where Alt+F lands: on over anything that is not a word, then to the end of the word. */
export function wordEndAfter(text: string, i: number): number {
  let at = Math.min(Math.max(i, 0), text.length);
  while (at < text.length && !isWordChar(text[at])) at += 1;
  while (at < text.length && isWordChar(text[at])) at += 1;
  return at;
}

/** Where Ctrl+W kills back to: over the spaces, then over everything up to the next space. */
export function unixWordStartBefore(text: string, i: number): number {
  let at = Math.min(Math.max(i, 0), text.length);
  while (at > 0 && isSpace(text[at - 1])) at -= 1;
  while (at > 0 && !isSpace(text[at - 1])) at -= 1;
  return at;
}

function clampCursor(st: EditState): number {
  return Math.min(Math.max(st.cursor, 0), st.text.length);
}

/** Puts `killed` in the ring, joining the newest entry when the edit before was a kill too. */
function remember(ring: KillRing, killed: string, direction: 'back' | 'forward'): KillRing {
  if (killed === '') return { entries: ring.entries, lastKill: direction, yank: null };
  const newest = ring.entries[0];
  if (ring.lastKill !== null && newest !== undefined) {
    const joined = direction === 'back' ? killed + newest : newest + killed;
    return { entries: [joined, ...ring.entries.slice(1)], lastKill: direction, yank: null };
  }
  return { entries: [killed, ...ring.entries].slice(0, KILL_RING_MAX), lastKill: direction, yank: null };
}

function kill(st: EditState, from: number, to: number, direction: 'back' | 'forward', ring: KillRing): { state: EditState; ring: KillRing } {
  const killed = st.text.slice(from, to);
  return { state: { text: st.text.slice(0, from) + st.text.slice(to), cursor: from }, ring: remember(ring, killed, direction) };
}

function move(st: EditState, cursor: number, ring: KillRing): { state: EditState; ring: KillRing } {
  return { state: { text: st.text, cursor }, ring: settleRing(ring) };
}

/** One readline op. Ops that cannot act (Ctrl+T at the start, a yank with an empty ring) change nothing. */
export function applyOp(st: EditState, op: EditOp, ring: KillRing = EMPTY_RING): { state: EditState; ring: KillRing } {
  const { text } = st;
  const cursor = clampCursor(st);
  switch (op) {
    case 'bol':
      return move(st, 0, ring);
    case 'eol':
      return move(st, text.length, ring);
    case 'charLeft':
      return move(st, prevBoundary(text, cursor), ring);
    case 'charRight':
      return move(st, nextBoundary(text, cursor), ring);
    case 'wordLeft':
      return move(st, wordStartBefore(text, cursor), ring);
    case 'wordRight':
      return move(st, wordEndAfter(text, cursor), ring);
    case 'killToStart':
      return kill(st, 0, cursor, 'back', ring);
    case 'killToEnd':
      return kill(st, cursor, text.length, 'forward', ring);
    case 'killWordBackUnix':
      return kill(st, unixWordStartBefore(text, cursor), cursor, 'back', ring);
    case 'killWordBackAlnum':
      return kill(st, wordStartBefore(text, cursor), cursor, 'back', ring);
    case 'killWordFwd':
      return kill(st, cursor, wordEndAfter(text, cursor), 'forward', ring);
    case 'yank': {
      const newest = ring.entries[0];
      if (newest === undefined) return { state: { text, cursor }, ring: settleRing(ring) };
      const next = text.slice(0, cursor) + newest + text.slice(cursor);
      return {
        state: { text: next, cursor: cursor + newest.length },
        ring: { entries: ring.entries, lastKill: null, yank: { from: cursor, to: cursor + newest.length, index: 0 } },
      };
    }
    case 'yankPop': {
      // Only straight after a yank, and only while what it put there is still there.
      const last = ring.yank;
      if (last === null || ring.entries.length < 2 || last.to !== cursor || last.to > text.length) {
        return { state: { text, cursor }, ring: settleRing(ring) };
      }
      const index = (last.index + 1) % ring.entries.length;
      const older = ring.entries[index] ?? '';
      const next = text.slice(0, last.from) + older + text.slice(last.to);
      return {
        state: { text: next, cursor: last.from + older.length },
        ring: { entries: ring.entries, lastKill: null, yank: { from: last.from, to: last.from + older.length, index } },
      };
    }
    case 'deleteChar': {
      const end = nextBoundary(text, cursor);
      return { state: { text: text.slice(0, cursor) + text.slice(end), cursor }, ring: settleRing(ring) };
    }
    case 'transpose': {
      // As readline's transpose-chars: the two characters either side of the cursor change
      // places and the cursor moves on; at the end of the line, the last two do.
      if (text.length < 2 || cursor === 0) return { state: { text, cursor }, ring: settleRing(ring) };
      const at = cursor === text.length ? prevBoundary(text, cursor) : cursor;
      const before = prevBoundary(text, at);
      const after = nextBoundary(text, at);
      const swapped = text.slice(0, before) + text.slice(at, after) + text.slice(before, at) + text.slice(after);
      return { state: { text: swapped, cursor: after }, ring: settleRing(ring) };
    }
  }
}

/** A word of a command line: quoted parts and backslash escapes stay inside it. */
const SHELL_WORD = /(?:[^\s"'\\]|\\.|"(?:[^"\\]|\\.)*"?|'[^']*'?)+/g;

/** The last word of a line as typed, quotes and all: what Alt+. inserts. */
export function lastArgument(line: string): string | null {
  const words = line.match(SHELL_WORD);
  return words === null ? null : (words[words.length - 1] ?? null);
}

/** Where Alt+. last inserted an argument, so pressing it again swaps in an older line's. */
export interface LastArgState {
  readonly from: number;
  readonly to: number;
  /** How many lines back the inserted argument came from; 1 is the newest. */
  readonly back: number;
}

/**
 * Alt+.: inserts the last argument of the newest history line at the cursor. Pressed again
 * straight after (with `previous`), it replaces that with the last argument of the line before.
 * Returns null when there is nothing (more) to insert.
 */
export function yankLastArg(
  st: EditState,
  history: readonly string[],
  previous: LastArgState | null = null,
): { state: EditState; inserted: LastArgState } | null {
  const repeat = previous !== null && previous.to === st.cursor && previous.to <= st.text.length;
  let back = repeat ? previous.back + 1 : 1;
  let word: string | null = null;
  for (; back <= history.length; back += 1) {
    word = lastArgument(history[history.length - back] ?? '');
    if (word !== null) break;
  }
  if (word === null) return null;
  const from = repeat ? previous.from : clampCursor(st);
  const to = repeat ? previous.to : from;
  const text = st.text.slice(0, from) + word + st.text.slice(to);
  return { state: { text, cursor: from + word.length }, inserted: { from, to: from + word.length, back } };
}

/** The line with `insert` in place of the selection [from, to), and the cursor after it. */
export function replaceRange(st: EditState, from: number, to: number, insert: string): EditState {
  const start = Math.min(Math.max(from, 0), st.text.length);
  const end = Math.min(Math.max(to, start), st.text.length);
  return { text: st.text.slice(0, start) + insert + st.text.slice(end), cursor: start + insert.length };
}
