// The keys the terminal answers to, for `help keys` and `man vesen`: generated from the prompt's
// own key table (src/shell/editor/keymap.ts), so what help says is what the keys do. Kept here,
// with the kernel, rather than beside the table, which the prompt loads with the first paint.

import { BINDINGS, type KeyPlatform } from './editor/keymap';

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
  { keys: '⌄', does: 'put the keyboard away' },
  { keys: 'a name in help', does: 'tap it to put it at the prompt' },
  { keys: 'a status line', does: 'tap it to stop the running command' },
];
