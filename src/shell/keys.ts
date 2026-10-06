// The keys the terminal answers to, for `help keys` and `man vesen`: generated from the prompt's
// own key table (src/shell/editor/keymap.ts), so what help says is what the keys do.

import { keyHelp, type KeyHelp } from './editor/keymap';

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
