// The keys on the phone dock's key bar (docs/plan/designs/phone-and-instagram.md, "C. Typing";
// 02, section 5). Each key names what it does to the prompt, and runKey does it through the same
// controller methods a hardware keyboard reaches: tab and the arrows go through pressKey, so they
// complete, list, cycle and walk history exactly as Tab, ↑ and ↓ do.

import type { DockKey } from '../prompt/promptController.svelte';

export type KeyAction =
  /** What the same key on a keyboard does. */
  | { readonly type: 'key'; readonly key: DockKey }
  /** ^C: stop the running command, or abandon the line. */
  | { readonly type: 'interrupt' }
  /** Clear the screen, keeping the line. */
  | { readonly type: 'clear' }
  /** Text at the cursor: the symbols page. */
  | { readonly type: 'insert'; readonly text: string }
  /** Show or leave the symbols page. */
  | { readonly type: 'symbols' }
  /** Put the keyboard away. */
  | { readonly type: 'hide' }
  /** Open the keyboard at the prompt, inside the tap, and bring the prompt into view. */
  | { readonly type: 'type' };

export interface KeyDef {
  readonly id: string;
  readonly label: string;
  readonly ariaLabel: string;
  readonly action: KeyAction;
  /** Held, it opens the history sheet: ↑. */
  readonly holdForHistory?: boolean;
  /** Held, it repeats: ← and →. */
  readonly repeat?: boolean;
  /** Takes the room the others leave: ⌨ Type a command…. */
  readonly wide?: boolean;
}

const TAB: KeyDef = { id: 'tab', label: 'tab', ariaLabel: 'Tab: complete', action: { type: 'key', key: 'Tab' } };
const UP: KeyDef = {
  id: 'up',
  label: '↑',
  ariaLabel: 'Previous command (hold for history)',
  action: { type: 'key', key: 'ArrowUp' },
  holdForHistory: true,
};
const DOWN: KeyDef = { id: 'down', label: '↓', ariaLabel: 'Next command', action: { type: 'key', key: 'ArrowDown' } };
const INTERRUPT: KeyDef = { id: 'interrupt', label: '^C', ariaLabel: 'Control C: cancel', action: { type: 'interrupt' } };
const CLEAR: KeyDef = { id: 'clear', label: 'clear', ariaLabel: 'Clear the screen', action: { type: 'clear' } };
export const SYMBOLS_KEY: KeyDef = { id: 'symbols', label: '•••', ariaLabel: 'Symbols', action: { type: 'symbols' } };
const HIDE: KeyDef = { id: 'hide', label: '⌄', ariaLabel: 'Hide the keyboard', action: { type: 'hide' } };

/** With the keyboard open: tab ↑ ↓ ^C clear ••• ⌄. */
export const FULL_KEYS: readonly KeyDef[] = [TAB, UP, DOWN, INTERRUPT, CLEAR, SYMBOLS_KEY, HIDE];

/** On a short screen, before the chips in the one row: tab ↑ ^C. */
export const COMPACT_KEYS: readonly KeyDef[] = [TAB, UP, INTERRUPT];

const symbol = (text: string, name: string): KeyDef => ({ id: `sym:${text}`, label: text, ariaLabel: name, action: { type: 'insert', text } });

/**
 * The symbols page, after ••• to go back (SYMBOLS_PAGE): what a phone keyboard hides away. The
 * cursor keys come first, beside •••, so the way back and the arrows are never off the edge.
 */
export const SYMBOL_KEYS: readonly KeyDef[] = [
  { id: 'left', label: '←', ariaLabel: 'Cursor left', action: { type: 'key', key: 'ArrowLeft' }, repeat: true },
  { id: 'right', label: '→', ariaLabel: 'Cursor right', action: { type: 'key', key: 'ArrowRight' }, repeat: true },
  { id: 'esc', label: 'esc', ariaLabel: 'Escape', action: { type: 'key', key: 'Escape' } },
  symbol('|', 'Pipe'),
  symbol('>', 'Greater than'),
  symbol('/', 'Slash'),
  symbol('-', 'Dash'),
  symbol('~', 'Tilde'),
  symbol('*', 'Star'),
  symbol('"', 'Double quote'),
  symbol('$', 'Dollar'),
];

/** The symbols page as drawn: ••• (back to the keys) first, then the cursor keys and symbols. */
export const SYMBOLS_PAGE: readonly KeyDef[] = [SYMBOLS_KEY, ...SYMBOL_KEYS];

/** With the keyboard put away: a bar to bring it back, ↑ and clear. */
export const CLOSED_KEYS: readonly KeyDef[] = [
  { id: 'type', label: '⌨ Type a command…', ariaLabel: 'Type a command', action: { type: 'type' }, wide: true },
  UP,
  CLEAR,
];

/** What the keys act on: the prompt controller is one. */
export interface KeyTarget {
  pressKey(key: DockKey): void;
  interrupt(): void;
  clearScreen(): void;
  insertText(text: string): void;
  blur(): void;
  focus(options?: { keyboard?: boolean }): void;
  /** Brings the prompt into view, however far up the transcript was scrolled. */
  reveal(): void;
}

/** Does what a key does. The symbols page is the key bar's own; it reports that back. */
export function runKey(action: KeyAction, target: KeyTarget): 'symbols' | null {
  switch (action.type) {
    case 'key':
      target.pressKey(action.key);
      return null;
    case 'interrupt':
      target.interrupt();
      return null;
    case 'clear':
      target.clearScreen();
      return null;
    case 'insert':
      target.insertText(action.text);
      return null;
    case 'hide':
      target.blur();
      return null;
    case 'type':
      target.focus({ keyboard: true });
      // The visitor may have scrolled up to read: the line they are about to type is shown.
      target.reveal();
      return null;
    case 'symbols':
      return 'symbols';
  }
}
