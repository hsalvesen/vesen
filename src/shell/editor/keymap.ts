// The keys the prompt answers to (docs/plan/03-terminal-input.md, "Readline, keymap and history
// store"; F046, F095). One table, BINDINGS, says what every key does in every mode, and on which
// platform. The prompt controller asks resolveKey() for each key press on the input; `help keys`
// and `man vesen` list the same table (src/shell/keys.ts), so the two never drift apart. Each
// binding names its row of `help keys`, and the row's words are in src/shell/keys.ts, which loads
// with the help rather than with the first paint.
//
// Keys are captured only while the prompt has focus. Ctrl+A, E, U, K, Y, R, L and D are readline
// keys everywhere; Ctrl+W, P, N, F, B and T only on a Mac, because elsewhere the browser owns
// them (Ctrl+W closes the tab) or they mean something people rely on. Cmd shortcuts on a Mac are
// always the browser's. A Ctrl or Alt letter is the letter the layout types, as a terminal reads
// it (Ctrl+Y on a German keyboard is Ctrl+Y); only when the key types something else (Option+B
// on a Mac types ∫, and Ctrl+Ф on a Russian layout) is it the physical key's letter. A key
// pressed while an input method is composing is the IME's. On a Mac, where Cmd+C copies, Ctrl+C
// always interrupts, as in Terminal; elsewhere it copies while text is selected.

import type { PromptMode } from '../complete/types';
import type { EditOp } from './readline';

export type KeyPlatform = 'mac' | 'other';

/** What resolveKey reads from a key press; a KeyboardEvent is one. */
export interface KeyChord {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing: boolean;
  readonly keyCode: number;
}

/** What a key asks the prompt to do. */
export type Action =
  | { readonly a: 'op'; readonly op: EditOp }
  | { readonly a: 'tab'; readonly reverse: boolean }
  | { readonly a: 'submit' }
  | { readonly a: 'acceptGhost'; readonly unit: 'all' | 'word' }
  | { readonly a: 'history'; readonly dir: -1 | 1 }
  | { readonly a: 'search'; readonly dir: -1 | 1 }
  /** Enter in a search: run the line found. */
  | { readonly a: 'searchAccept' }
  /** A moving or editing key in a search: the line found goes on the prompt, then the key acts on it. */
  | { readonly a: 'searchExit' }
  /** Escape or Ctrl+G in a search: back to the line from before it. */
  | { readonly a: 'searchCancel' }
  | { readonly a: 'yankLastArg' }
  | { readonly a: 'interrupt' }
  | { readonly a: 'clearScreen' }
  | { readonly a: 'escape' }
  /** Ctrl+D on an empty line. */
  | { readonly a: 'eof' }
  /** Tab within a second of Escape: focus leaves the terminal, as Tab does on any page. */
  | { readonly a: 'leave' }
  /** Not the prompt's: the browser does what it does. */
  | { readonly a: 'native' };

export type ActionName = Action['a'];

/** What the prompt is doing, for the bindings that depend on it. */
export interface KeyCtx {
  readonly mode: PromptMode;
  readonly platform: KeyPlatform;
  /** The cursor is at the end of the line. */
  readonly atEnd: boolean;
  readonly empty: boolean;
  /** Grey text after the cursor that Right would take. */
  readonly hasGhost: boolean;
  /** Text is selected, in the prompt or the page: Ctrl+C copies it. */
  readonly hasSelection: boolean;
  /** Escape was pressed less than a second ago: Tab leaves. */
  readonly escArmed: boolean;
}

export interface Binding {
  /** Chords, as chordOf() writes them: 'C-a', 'M-b', 'S-Tab', 'Up'. */
  readonly keys: readonly string[];
  /** Only on these platforms; everywhere when absent. */
  readonly platforms?: readonly KeyPlatform[];
  /** Only when this holds. */
  readonly when?: (ctx: KeyCtx) => boolean;
  readonly action: Action;
  /**
   * Its row of `help keys`, which says what it does (KEY_ROWS in src/shell/keys.ts); bindings
   * with the same row are listed together. None: left out, as another row already says it.
   */
  readonly row?: KeyRow;
  /** How `help keys` writes the keys, when not from `keys`. */
  readonly shown?: string;
}

/** The rows of `help keys`, in the words src/shell/keys.ts gives each. */
export type KeyRow =
  | 'searchRun'
  | 'searchOlder'
  | 'searchNewer'
  | 'searchCancel'
  | 'searchEdit'
  | 'leave'
  | 'run'
  | 'complete'
  | 'completeBack'
  | 'interrupt'
  | 'interruptOrCopy'
  | 'escape'
  | 'clear'
  | 'eof'
  | 'ghost'
  | 'ghostWord'
  | 'bol'
  | 'eol'
  | 'charLeft'
  | 'charRight'
  | 'wordLeft'
  | 'wordRight'
  | 'killToStart'
  | 'killToEnd'
  | 'killWordBackUnix'
  | 'killWordBack'
  | 'killWordFwd'
  | 'yank'
  | 'yankPop'
  | 'transpose'
  | 'lastArg'
  | 'older'
  | 'newer'
  | 'search';

const NATIVE: Action = { a: 'native' };
const op = (name: EditOp): Action => ({ a: 'op', op: name });

const searching = (c: KeyCtx): boolean => c.mode === 'search';
const ghostAtEnd = (c: KeyCtx): boolean => c.atEnd && c.hasGhost && c.mode === 'edit';
const MAC: readonly KeyPlatform[] = ['mac'];
const OTHER: readonly KeyPlatform[] = ['other'];

/** Every binding, in order: the first that matches a key press wins. */
export const BINDINGS: readonly Binding[] = [
  // Reverse-i-search: Ctrl+R older, Ctrl+S newer, Enter runs, moving and editing keys act on the
  // line found, as readline ends the search on any key that is not its own; Escape and Ctrl+G
  // cancel (designs/terminal-input.md).
  { keys: ['Enter'], when: searching, action: { a: 'searchAccept' }, row: 'searchRun', shown: 'Enter' },
  { keys: ['C-r'], when: searching, action: { a: 'search', dir: -1 }, row: 'searchOlder', shown: 'Ctrl+R' },
  { keys: ['C-s'], when: searching, action: { a: 'search', dir: 1 }, row: 'searchNewer', shown: 'Ctrl+S' },
  { keys: ['Escape', 'C-g'], when: searching, action: { a: 'searchCancel' }, row: 'searchCancel' },
  {
    keys: ['Left', 'Right', 'Up', 'Down', 'Home', 'End', 'Tab', 'C-a', 'C-e', 'M-b', 'M-f', 'C-j'],
    when: searching,
    action: { a: 'searchExit' },
    row: 'searchEdit',
    shown: '← → ↑ ↓',
  },
  // The editing keys end a search too; the row above says so for all of them.
  { keys: ['C-k', 'C-u', 'C-y', 'C-d', 'C-l', 'M-d', 'M-y', 'M-Backspace', 'M-.'], when: searching, action: { a: 'searchExit' } },
  { keys: ['C-Backspace'], platforms: OTHER, when: searching, action: { a: 'searchExit' } },
  { keys: ['C-b', 'C-f', 'C-p', 'C-n', 'C-w', 'C-t'], platforms: MAC, when: searching, action: { a: 'searchExit' } },

  // Escape, then Tab within a second: out of the terminal, so the keyboard is never trapped.
  { keys: ['Tab', 'S-Tab'], when: (c) => c.escArmed, action: { a: 'leave' }, row: 'leave', shown: 'Escape, Tab' },

  { keys: ['Enter'], action: { a: 'submit' }, row: 'run' },
  { keys: ['Tab'], action: { a: 'tab', reverse: false }, row: 'complete' },
  { keys: ['S-Tab'], action: { a: 'tab', reverse: true }, row: 'completeBack' },
  // A Mac copies with Cmd+C, so Ctrl+C is free to interrupt whatever is selected.
  { keys: ['C-c'], platforms: MAC, action: { a: 'interrupt' }, row: 'interrupt' },
  { keys: ['C-c'], platforms: OTHER, when: (c) => !c.hasSelection, action: { a: 'interrupt' }, row: 'interruptOrCopy' },
  { keys: ['Escape'], action: { a: 'escape' }, row: 'escape' },
  { keys: ['C-l'], action: { a: 'clearScreen' }, row: 'clear' },
  { keys: ['C-d'], when: (c) => c.empty && c.mode !== 'search', action: { a: 'eof' }, row: 'eof' },
  // Listed in the row above.
  { keys: ['C-d'], action: op('deleteChar') },

  // The grey suggestion after the cursor.
  { keys: ['Right', 'End', 'C-e'], when: ghostAtEnd, action: { a: 'acceptGhost', unit: 'all' }, row: 'ghost', shown: '→' },
  // Listed in the row above.
  { keys: ['C-f'], platforms: MAC, when: ghostAtEnd, action: { a: 'acceptGhost', unit: 'all' } },
  { keys: ['M-f', 'M-Right'], when: ghostAtEnd, action: { a: 'acceptGhost', unit: 'word' }, row: 'ghostWord', shown: 'Alt+→' },

  // Moving.
  { keys: ['C-a', 'Home'], action: op('bol'), row: 'bol' },
  { keys: ['C-e', 'End'], action: op('eol'), row: 'eol' },
  { keys: ['C-b'], platforms: MAC, action: op('charLeft'), row: 'charLeft' },
  { keys: ['C-f'], platforms: MAC, action: op('charRight'), row: 'charRight' },
  { keys: ['M-b', 'M-Left'], action: op('wordLeft'), row: 'wordLeft' },
  { keys: ['M-f', 'M-Right'], action: op('wordRight'), row: 'wordRight' },

  // Cutting and pasting, through the kill ring.
  { keys: ['C-u'], action: op('killToStart'), row: 'killToStart' },
  { keys: ['C-k'], action: op('killToEnd'), row: 'killToEnd' },
  { keys: ['C-w'], platforms: MAC, action: op('killWordBackUnix'), row: 'killWordBackUnix' },
  { keys: ['M-Backspace'], action: op('killWordBackAlnum'), row: 'killWordBack' },
  { keys: ['C-Backspace'], platforms: OTHER, action: op('killWordBackAlnum'), row: 'killWordBack' },
  { keys: ['M-d'], action: op('killWordFwd'), row: 'killWordFwd' },
  { keys: ['C-y'], action: op('yank'), row: 'yank' },
  { keys: ['M-y'], action: op('yankPop'), row: 'yankPop' },
  { keys: ['C-t'], platforms: MAC, action: op('transpose'), row: 'transpose' },
  { keys: ['M-.'], action: { a: 'yankLastArg' }, row: 'lastArg' },

  // History.
  { keys: ['Up'], action: { a: 'history', dir: -1 }, row: 'older' },
  { keys: ['Down'], action: { a: 'history', dir: 1 }, row: 'newer' },
  { keys: ['C-p'], platforms: MAC, action: { a: 'history', dir: -1 }, row: 'older' },
  { keys: ['C-n'], platforms: MAC, action: { a: 'history', dir: 1 }, row: 'newer' },
  { keys: ['C-r'], action: { a: 'search', dir: -1 }, row: 'search' },
];

const NAMED: Readonly<Record<string, string>> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Up: 'Up',
  Down: 'Down',
  Left: 'Left',
  Right: 'Right',
  Enter: 'Enter',
  Tab: 'Tab',
  Escape: 'Escape',
  Esc: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
};

/**
 * The chord for a key press: modifiers as `Cmd-`, `C-` (Ctrl), `M-` (Alt or Option) and `S-`
 * (Shift, with a named key or another modifier), then the key. A letter or `.` held with Ctrl
 * or Alt is the one the layout types (Ctrl+Y on QWERTZ is C-y, Ctrl+A on AZERTY is C-a); when
 * the key types anything else (Option+B's ∫ on a Mac, Ctrl+Ф on a Russian layout), it is named
 * by its physical key.
 */
export function chordOf(e: KeyChord): string {
  const named = Object.prototype.hasOwnProperty.call(NAMED, e.key) ? NAMED[e.key] : undefined;
  const held = e.ctrlKey || e.altKey;
  let name: string;
  if (named !== undefined) name = named;
  else if (held && (/^[a-z]$/i.test(e.key) || e.key === '.')) name = e.key.toLowerCase();
  else if (held && /^Key[A-Z]$/.test(e.code)) name = e.code.slice(3).toLowerCase();
  else if (held && e.code === 'Period') name = '.';
  else name = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  const shift = e.shiftKey && (named !== undefined || e.ctrlKey || e.altKey) ? 'S-' : '';
  return `${e.metaKey ? 'Cmd-' : ''}${e.ctrlKey ? 'C-' : ''}${e.altKey ? 'M-' : ''}${shift}${name}`;
}

/** The binding a key press matches, or undefined. */
export function bindingFor(e: KeyChord, ctx: KeyCtx): Binding | undefined {
  if (e.isComposing || e.keyCode === 229 || e.metaKey) return undefined;
  const chord = chordOf(e);
  return BINDINGS.find(
    (binding) =>
      binding.keys.includes(chord) &&
      (binding.platforms === undefined || binding.platforms.includes(ctx.platform)) &&
      (binding.when === undefined || binding.when(ctx)),
  );
}

/**
 * What a key press on the prompt does. Keys an input method is composing (isComposing, or
 * keyCode 229 from Android keyboards) and Cmd shortcuts are always the browser's.
 */
export function resolveKey(e: KeyChord, ctx: KeyCtx): Action {
  return bindingFor(e, ctx)?.action ?? NATIVE;
}

/** Keys that only modify another: they never disarm Escape-then-Tab. */
export function isModifierKey(key: string): boolean {
  return key === 'Shift' || key === 'Control' || key === 'Alt' || key === 'Meta' || key === 'CapsLock' || key === 'AltGraph' || key === 'OS';
}
