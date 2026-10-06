// The keys the terminal answers to, for `help keys` and `man vesen`. They are the bindings the
// prompt (src/components/Input.svelte) implements today; the line editor's keymap replaces this
// list when it lands (docs/plan/03-terminal-input.md).

export interface KeyBinding {
  readonly keys: string;
  readonly does: string;
}

/** On a keyboard. */
export const KEY_BINDINGS: readonly KeyBinding[] = [
  { keys: 'Enter', does: 'run the line' },
  { keys: 'Tab', does: 'complete a command, file or theme name' },
  { keys: '↑ ↓', does: 'step through the command history' },
  { keys: 'Ctrl+C', does: 'stop the running command; with text selected, copy it' },
  { keys: 'Escape', does: 'stop the running command' },
  { keys: 'Ctrl+L', does: 'clear the screen' },
  { keys: 'Escape, Tab', does: 'leave the terminal for the rest of the page' },
];

/** On a touch screen, which has no Tab, arrow or Ctrl keys. */
export const TOUCH_BINDINGS: readonly KeyBinding[] = [
  { keys: 'a suggestion', does: 'tap it to use it' },
  { keys: 'a name in help', does: 'tap it to put it at the prompt' },
  { keys: 'a status line', does: 'tap it to stop the running command' },
];
