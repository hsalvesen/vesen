// The keys the terminal answers to, for `help keys` and `man vesen`: generated from the prompt's
// own key table (src/shell/editor/keymap.ts), so what help says is what the keys do. The words of
// each row are kept here, with the help, rather than beside the table, which the prompt loads
// with the first paint.

import { BINDINGS, type KeyPlatform, type KeyRow } from './editor/keymap';

/** Where `help keys` lists a row: after the editing keys, the search keys, then leaving. */
type KeySection = 'search' | 'leave';

/** What each row of `help keys` says the keys do, and where it is listed. */
export const KEY_ROWS: Readonly<Record<KeyRow, { readonly does: string; readonly section?: KeySection }>> = {
  searchRun: { does: 'in a search: run the line found', section: 'search' },
  searchOlder: { does: 'in a search: an older line', section: 'search' },
  searchNewer: { does: 'in a search: a newer line', section: 'search' },
  searchCancel: { does: 'in a search: put back what you typed', section: 'search' },
  searchEdit: { does: 'in a search: edit the line found', section: 'search' },
  leave: { does: 'leave the terminal for the rest of the page', section: 'leave' },
  run: { does: 'run the line' },
  complete: { does: 'complete; again to list the choices, again to step through them' },
  completeBack: { does: 'step back through the choices' },
  interrupt: { does: 'stop the running command, or abandon the line' },
  interruptOrCopy: { does: 'stop the running command, or abandon the line; with text selected, copy it' },
  escape: { does: 'stop the running command; in the choices, put back what you typed' },
  clear: { does: 'clear the screen, keeping the line' },
  eof: { does: 'on an empty line, exit; otherwise delete the character under the cursor' },
  ghost: { does: 'at the end of the line, take the grey suggestion' },
  ghostWord: { does: 'at the end of the line, take one word of it' },
  bol: { does: 'go to the start of the line' },
  eol: { does: 'go to the end of the line' },
  charLeft: { does: 'back one character' },
  charRight: { does: 'forward one character' },
  wordLeft: { does: 'back one word' },
  wordRight: { does: 'forward one word' },
  killToStart: { does: 'cut to the start of the line' },
  killToEnd: { does: 'cut to the end of the line' },
  killWordBackUnix: { does: 'cut back to the last space' },
  killWordBack: { does: 'cut the word before the cursor' },
  killWordFwd: { does: 'cut the word after the cursor' },
  yank: { does: 'paste what was cut last' },
  yankPop: { does: 'after Ctrl+Y, swap in what was cut before it' },
  transpose: { does: 'swap the two characters at the cursor' },
  lastArg: { does: 'insert the last word of the line before; again for older lines' },
  older: { does: 'an older line from history, starting with what is typed' },
  newer: { does: 'a newer line; past the newest, what you were typing' },
  search: { does: 'search the history: (reverse-i-search)' },
};

const SECTION_ORDER: Readonly<Record<KeySection, number>> = { search: 1, leave: 2 };

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

/** Where a row is listed: 0 for the editing keys, then the search keys, then leaving. */
function sectionOf(row: KeyRow): number {
  const section = KEY_ROWS[row].section;
  return section === undefined ? 0 : SECTION_ORDER[section];
}

/**
 * The rows of `help keys`, from BINDINGS: one per row, with every key for it. Keys bound only on
 * a Mac say so. With a platform, only that platform's keys are listed.
 */
export function keyHelp(platform?: KeyPlatform): KeyHelp[] {
  const rows = new Map<KeyRow, string[]>();
  for (const binding of BINDINGS) {
    if (binding.row === undefined) continue;
    if (platform !== undefined && binding.platforms !== undefined && !binding.platforms.includes(platform)) continue;
    const macOnly = platform === undefined && binding.platforms !== undefined && binding.platforms.length === 1 && binding.platforms[0] === 'mac';
    const otherOnly = platform === undefined && binding.platforms !== undefined && binding.platforms.length === 1 && binding.platforms[0] === 'other';
    const shown = binding.shown ?? binding.keys.map(showChord).join(', ');
    const keys = macOnly ? `${shown} (Mac)` : otherOnly ? `${shown} (not Mac)` : shown;
    const row = rows.get(binding.row);
    if (row === undefined) rows.set(binding.row, [keys]);
    else if (!row.includes(keys)) row.push(keys);
  }
  // A stable sort: the editing keys in table order, then the search keys, then leaving.
  return [...rows]
    .sort(([a], [b]) => sectionOf(a) - sectionOf(b))
    .map(([row, keys]) => ({ keys: keys.join(', '), does: KEY_ROWS[row].does }));
}

export type KeyBinding = KeyHelp;

/** On a keyboard: every binding, with the ones bound only on a Mac marked. */
export const KEY_BINDINGS: readonly KeyBinding[] = keyHelp();

/** On a touch screen, which has no Tab, arrow or Ctrl keys: the dock above the keyboard. */
export const TOUCH_BINDINGS: readonly KeyBinding[] = [
  { keys: 'a suggestion', does: 'tap it to use it; one marked ⏎ runs, and holding it puts it at the prompt instead' },
  { keys: 'tab ↑ ↓', does: 'what Tab and the arrows do; hold ↑ for a list of your commands' },
  { keys: '^C', does: 'stop the running command, or abandon the line' },
  { keys: 'clear', does: 'clear the screen, keeping the line' },
  { keys: '•••', does: 'symbols: esc | > / - ~ * " $, and ← → to move' },
  { keys: '▾', does: 'put the keyboard away' },
  { keys: 'a name in help', does: 'tap it to put it at the prompt' },
  { keys: 'a status line', does: 'tap it to stop the running command' },
];
