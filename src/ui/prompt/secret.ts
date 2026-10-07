// sudo's password, kept out of the input (02, section 12; promptController.svelte.ts): what a key
// does to the password itself, while the input holds only a mask.

import type { EditState } from '../../shell/complete/types';
import { nextBoundary, prevBoundary, replaceRange, wordEndAfter, wordStartBefore } from '../../shell/editor/readline';
import { diffRange } from './inputDom';

/**
 * What a key typed, pasted, dropped or deleted (its beforeinput's inputType and text) does to the
 * password, with the mask's selection [start, end); null when it does nothing (undo, formatting).
 */
export function secretEdit(inputType: string, data: string, secret: string, start: number, end: number): EditState | null {
  const at = Math.min(start, secret.length);
  const to = Math.min(Math.max(end, at), secret.length);
  const state = { text: secret, cursor: at };
  if (inputType.startsWith('insert')) return replaceRange(state, at, to, data.replace(/[\r\n]+/g, ''));
  if (!inputType.startsWith('delete')) return null;
  // A selection goes, whatever the key; otherwise the key says how far.
  if (at !== to) return replaceRange(state, at, to, '');
  switch (inputType) {
    case 'deleteContentBackward':
      return replaceRange(state, prevBoundary(secret, at), at, '');
    case 'deleteContentForward':
      return replaceRange(state, at, nextBoundary(secret, at), '');
    case 'deleteWordBackward':
      return replaceRange(state, wordStartBefore(secret, at), at, '');
    case 'deleteWordForward':
      return replaceRange(state, at, wordEndAfter(secret, at), '');
    case 'deleteSoftLineBackward':
    case 'deleteHardLineBackward':
      return replaceRange(state, 0, at, '');
    case 'deleteSoftLineForward':
    case 'deleteHardLineForward':
      return replaceRange(state, at, secret.length, '');
    case 'deleteEntireSoftLine':
      return { text: '', cursor: 0 };
    default:
      return null;
  }
}

/**
 * The password after the input changed under its mask, `shown`, to `value`: what an input method
 * composed, or an undo put back. The characters added join the password; mask characters an
 * undo brought back cannot say what they stood for, and are dropped. `added`: real text reached
 * the input.
 */
export function secretMerge(secret: string, shown: string, value: string, mask: string): { state: EditState; added: boolean } {
  const { from, to, insert } = diffRange(shown, value);
  const added = insert.split(mask).join('');
  return { state: { text: secret.slice(0, from) + added + secret.slice(to), cursor: from + added.length }, added: added !== '' };
}
