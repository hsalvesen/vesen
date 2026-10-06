// Writing the controller's line into the real <input>. The input stays the editing surface on
// every device (docs/plan/02-architecture-and-contracts.md, section 5), so a programmatic edit
// (Tab, a chip, Ctrl+U) goes in as an edit the browser knows: the text that changes is selected
// and replaced with execCommand('insertText'), which keeps undo working and fires the input
// event a typed edit fires. Where that is unavailable (the input has no focus, or the browser
// refuses), setRangeText does it, and failing that the value is set outright.

import type { EditState } from '../../shell/complete/types';

/** The smallest replacement that turns `before` into `after`: [from, to) of `before` becomes `insert`. */
export function diffRange(before: string, after: string): { from: number; to: number; insert: string } {
  let start = 0;
  const shorter = Math.min(before.length, after.length);
  while (start < shorter && before.charCodeAt(start) === after.charCodeAt(start)) start += 1;
  let end = 0;
  while (end < shorter - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end += 1;
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}

/** Puts the caret at `cursor`, ignoring inputs that refuse (one detached from the page). */
export function placeCaret(input: HTMLInputElement, cursor: number): void {
  try {
    input.setSelectionRange(cursor, cursor);
  } catch {
    // Not in the page any more.
  }
}

/**
 * Writes `next` into `input`. With `undoable`, through execCommand where it can, so Cmd+Z undoes
 * it; otherwise the value is replaced outright, which also clears the browser's undo history:
 * what a secret prompt needs when it is emptied.
 */
export function writeInput(input: HTMLInputElement, next: EditState, options: { readonly undoable: boolean }): void {
  const before = input.value;
  if (before !== next.text) {
    let done = false;
    const doc = input.ownerDocument;
    if (options.undoable && doc.activeElement === input && typeof doc.execCommand === 'function') {
      const { from, to, insert } = diffRange(before, next.text);
      try {
        input.setSelectionRange(from, to);
        done = insert === '' ? doc.execCommand('delete', false) : doc.execCommand('insertText', false, insert);
      } catch {
        done = false;
      }
      done = done && input.value === next.text;
    }
    if (!done && options.undoable && typeof input.setRangeText === 'function') {
      const { from, to, insert } = diffRange(input.value, next.text);
      try {
        input.setRangeText(insert, from, to, 'end');
        done = input.value === next.text;
      } catch {
        done = false;
      }
    }
    if (!done) input.value = next.text;
  }
  placeCaret(input, Math.min(next.cursor, next.text.length));
}
