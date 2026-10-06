// The keys the terminal answers to, for `help keys` and `man vesen`: generated from the prompt's
// own key table (src/shell/editor/keymap.ts), so what help says is what the keys do.

import { keyHelp, type KeyHelp } from './editor/keymap';

export type KeyBinding = KeyHelp;

/** On a keyboard: every binding, with the ones bound only on a Mac marked. */
export const KEY_BINDINGS: readonly KeyBinding[] = keyHelp();

/** On a touch screen, which has no Tab, arrow or Ctrl keys. */
export const TOUCH_BINDINGS: readonly KeyBinding[] = [
  { keys: 'a suggestion', does: 'tap it to use it' },
  { keys: 'a name in help', does: 'tap it to put it at the prompt' },
  { keys: 'a status line', does: 'tap it to stop the running command' },
];
