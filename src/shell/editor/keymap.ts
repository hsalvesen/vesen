// The keys the prompt answers to (docs/plan/03-terminal-input.md, "Readline, keymap and history
// store"; F046, F095). One table, BINDINGS, says what every key does in every mode, and on which
// platform. The prompt controller asks resolveKey() for each key press on the input; `help keys`
// and `man vesen` list the same table (src/shell/keys.ts), so the two never drift apart.
//
// Keys are captured only while the prompt has focus. Ctrl+A, E, U, K, Y, R, L and D are readline
// keys everywhere; Ctrl+W, P, N, F, B and T only on a Mac, because elsewhere the browser owns
// them (Ctrl+W closes the tab) or they mean something people rely on. Cmd shortcuts on a Mac are
// always the browser's. Alt keys are matched on the physical key, because Option+B on a Mac
// types ∫ rather than b. A key pressed while an input method is composing is the IME's.

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
  /** A moving key in a search: the line found goes on the prompt, then the key moves in it. */
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
  /** What `help keys` says it does; bindings with the same words share a row. */
  readonly does: string;
  /** How `help keys` writes the keys, when not from `keys`. */
  readonly shown?: string;
  /** Left out of `help keys`: another row already says it. */
  readonly hidden?: boolean;
  /** Where `help keys` lists it: after the editing keys, the search keys, then leaving. */
  readonly section?: 'search' | 'leave';
}

const NATIVE: Action = { a: 'native' };
const op = (name: EditOp): Action => ({ a: 'op', op: name });

const searching = (c: KeyCtx): boolean => c.mode === 'search';
const ghostAtEnd = (c: KeyCtx): boolean => c.atEnd && c.hasGhost && c.mode === 'edit';
const MAC: readonly KeyPlatform[] = ['mac'];
const OTHER: readonly KeyPlatform[] = ['other'];

/** Every binding, in order: the first that matches a key press wins. */
export const BINDINGS: readonly Binding[] = [
  // Reverse-i-search: Ctrl+R older, Ctrl+S newer, Enter runs, moving keys edit, Escape cancels.
  { keys: ['Enter'], when: searching, action: { a: 'searchAccept' }, does: 'in a search: run the line found', shown: 'Enter', section: 'search' },
  { keys: ['C-r'], when: searching, action: { a: 'search', dir: -1 }, does: 'in a search: an older line', shown: 'Ctrl+R', section: 'search' },
  { keys: ['C-s'], when: searching, action: { a: 'search', dir: 1 }, does: 'in a search: a newer line', shown: 'Ctrl+S', section: 'search' },
  { keys: ['Escape', 'C-g'], when: searching, action: { a: 'searchCancel' }, does: 'in a search: put back what you typed', section: 'search' },
  {
    keys: ['Left', 'Right', 'Up', 'Down', 'Home', 'End', 'Tab', 'C-a', 'C-e', 'M-b', 'M-f'],
    when: searching,
    action: { a: 'searchExit' },
    does: 'in a search: edit the line found',
    shown: '← → ↑ ↓',
    section: 'search',
  },
  { keys: ['C-b', 'C-f', 'C-p', 'C-n'], platforms: MAC, when: searching, action: { a: 'searchExit' }, does: 'in a search: edit the line found', hidden: true, section: 'search' },

  // Escape, then Tab within a second: out of the terminal, so the keyboard is never trapped.
  { keys: ['Tab', 'S-Tab'], when: (c) => c.escArmed, action: { a: 'leave' }, does: 'leave the terminal for the rest of the page', shown: 'Escape, Tab', section: 'leave' },

  { keys: ['Enter'], action: { a: 'submit' }, does: 'run the line' },
  { keys: ['Tab'], action: { a: 'tab', reverse: false }, does: 'complete; again to list the choices, again to step through them' },
  { keys: ['S-Tab'], action: { a: 'tab', reverse: true }, does: 'step back through the choices' },
  {
    keys: ['C-c'],
    when: (c) => !c.hasSelection,
    action: { a: 'interrupt' },
    does: 'stop the running command, or abandon the line; with text selected, copy it',
  },
  { keys: ['Escape'], action: { a: 'escape' }, does: 'stop the running command; in the choices, put back what you typed' },
  { keys: ['C-l'], action: { a: 'clearScreen' }, does: 'clear the screen, keeping the line' },
  { keys: ['C-d'], when: (c) => c.empty && c.mode !== 'search', action: { a: 'eof' }, does: 'on an empty line, exit; otherwise delete the character under the cursor' },
  { keys: ['C-d'], action: op('deleteChar'), does: 'on an empty line, exit; otherwise delete the character under the cursor', hidden: true },

  // The grey suggestion after the cursor.
  { keys: ['Right', 'End', 'C-e'], when: ghostAtEnd, action: { a: 'acceptGhost', unit: 'all' }, does: 'at the end of the line, take the grey suggestion', shown: '→' },
  { keys: ['C-f'], platforms: MAC, when: ghostAtEnd, action: { a: 'acceptGhost', unit: 'all' }, does: 'at the end of the line, take the grey suggestion', hidden: true },
  { keys: ['M-f', 'M-Right'], when: ghostAtEnd, action: { a: 'acceptGhost', unit: 'word' }, does: 'at the end of the line, take one word of it', shown: 'Alt+→' },

  // Moving.
  { keys: ['C-a', 'Home'], action: op('bol'), does: 'go to the start of the line' },
  { keys: ['C-e', 'End'], action: op('eol'), does: 'go to the end of the line' },
  { keys: ['C-b'], platforms: MAC, action: op('charLeft'), does: 'back one character' },
  { keys: ['C-f'], platforms: MAC, action: op('charRight'), does: 'forward one character' },
  { keys: ['M-b', 'M-Left'], action: op('wordLeft'), does: 'back one word' },
  { keys: ['M-f', 'M-Right'], action: op('wordRight'), does: 'forward one word' },

  // Cutting and pasting, through the kill ring.
  { keys: ['C-u'], action: op('killToStart'), does: 'cut to the start of the line' },
  { keys: ['C-k'], action: op('killToEnd'), does: 'cut to the end of the line' },
  { keys: ['C-w'], platforms: MAC, action: op('killWordBackUnix'), does: 'cut back to the last space' },
  { keys: ['M-Backspace'], action: op('killWordBackAlnum'), does: 'cut the word before the cursor' },
  { keys: ['C-Backspace'], platforms: OTHER, action: op('killWordBackAlnum'), does: 'cut the word before the cursor' },
  { keys: ['M-d'], action: op('killWordFwd'), does: 'cut the word after the cursor' },
  { keys: ['C-y'], action: op('yank'), does: 'paste what was cut last' },
  { keys: ['M-y'], action: op('yankPop'), does: 'after Ctrl+Y, swap in what was cut before it' },
  { keys: ['C-t'], platforms: MAC, action: op('transpose'), does: 'swap the two characters at the cursor' },
  { keys: ['M-.'], action: { a: 'yankLastArg' }, does: 'insert the last word of the line before; again for older lines' },

  // History.
  { keys: ['Up'], action: { a: 'history', dir: -1 }, does: 'an older line from history, starting with what is typed' },
  { keys: ['Down'], action: { a: 'history', dir: 1 }, does: 'a newer line; past the newest, what you were typing' },
  { keys: ['C-p'], platforms: MAC, action: { a: 'history', dir: -1 }, does: 'an older line from history, starting with what is typed' },
  { keys: ['C-n'], platforms: MAC, action: { a: 'history', dir: 1 }, does: 'a newer line; past the newest, what you were typing' },
  { keys: ['C-r'], action: { a: 'search', dir: -1 }, does: 'search the history: (reverse-i-search)' },
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
 * or Alt is named by its physical key, whatever the layout makes of it.
 */
export function chordOf(e: KeyChord): string {
  const named = Object.prototype.hasOwnProperty.call(NAMED, e.key) ? NAMED[e.key] : undefined;
  let name: string;
  if (named !== undefined) name = named;
  else if ((e.ctrlKey || e.altKey) && /^Key[A-Z]$/.test(e.code)) name = e.code.slice(3).toLowerCase();
  else if ((e.ctrlKey || e.altKey) && e.code === 'Period') name = '.';
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

const SHOWN_KEYS: Readonly<Record<string, string>> = { Up: '↑', Down: '↓', Left: '←', Right: '→' };

/** A chord as people write it: `C-a` is Ctrl+A, `M-Left` Alt+←, `S-Tab` Shift+Tab. */
export function showChord(chord: string): string {
  const parts: string[] = [];
  let rest = chord;
  for (const [prefix, word] of [
    ['Cmd-', 'Cmd'],
    ['C-', 'Ctrl'],
    ['M-', 'Alt'],
    ['S-', 'Shift'],
  ] as const) {
    if (rest.startsWith(prefix)) {
      parts.push(word);
      rest = rest.slice(prefix.length);
    }
  }
  const key = SHOWN_KEYS[rest] ?? (rest.length === 1 ? rest.toUpperCase() : rest);
  return [...parts, key].join('+');
}

/** One row of `help keys`. */
export interface KeyHelp {
  readonly keys: string;
  readonly does: string;
}

/**
 * The rows of `help keys`, from BINDINGS: one per description, with every key for it. Keys bound
 * only on a Mac say so. With a platform, only that platform's keys are listed.
 */
export function keyHelp(platform?: KeyPlatform): KeyHelp[] {
  const rows = new Map<string, string[]>();
  const sections = new Map<string, number>();
  for (const binding of BINDINGS) {
    if (binding.hidden === true) continue;
    if (platform !== undefined && binding.platforms !== undefined && !binding.platforms.includes(platform)) continue;
    const macOnly = platform === undefined && binding.platforms !== undefined && binding.platforms.length === 1 && binding.platforms[0] === 'mac';
    const otherOnly = platform === undefined && binding.platforms !== undefined && binding.platforms.length === 1 && binding.platforms[0] === 'other';
    const shown = binding.shown ?? binding.keys.map(showChord).join(', ');
    const keys = macOnly ? `${shown} (Mac)` : otherOnly ? `${shown} (not Mac)` : shown;
    const row = rows.get(binding.does);
    if (row === undefined) rows.set(binding.does, [keys]);
    else if (!row.includes(keys)) row.push(keys);
    sections.set(binding.does, binding.section === 'search' ? 1 : binding.section === 'leave' ? 2 : 0);
  }
  // A stable sort: the editing keys in table order, then the search keys, then leaving.
  return [...rows]
    .map(([does, keys]) => ({ keys: keys.join(', '), does }))
    .sort((a, b) => (sections.get(a.does) ?? 0) - (sections.get(b.does) ?? 0));
}
