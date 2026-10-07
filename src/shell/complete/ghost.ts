// The grey ghost after the cursor (docs/plan/designs/terminal-input.md, "GHOST"), fish-style:
// the rest of the newest history line that starts with the whole line; otherwise the rest of the
// one candidate, or of the prefix the candidates share; otherwise the argument's placeholder,
// dim and never inserted. Only at the end of the line, with nothing selected and no menu open.
// A history line with a line break in it (a quote continued at `> `) is never a ghost: the
// prompt is one line.

import { accept, extendToCommon } from './engine';
import type { CompletionResult, EditState, Ghost, GhostOptions } from './types';

/** The ghost for a line, or null. `result` is the completion of `state`. */
export function ghostFor(state: EditState, result: CompletionResult | null, history: readonly string[], options: GhostOptions = {}): Ghost | null {
  if (options.selection === true || options.menuOpen === true) return null;
  const { text, cursor } = state;
  if (cursor !== text.length || text.trim() === '') return null;

  for (let i = history.length - 1; i >= 0; i -= 1) {
    const line = history[i] ?? '';
    if (line.length > text.length && line.startsWith(text) && !/[\r\n]/.test(line)) return { text: line.slice(text.length), source: 'history', acceptable: true };
  }
  if (result === null) return null;

  const only = result.candidates[0];
  const next = result.total === 1 && only !== undefined ? accept(result, only, 'final') : extendToCommon(result);
  // A completion that rewrites what was typed (a case fix) cannot be shown after it.
  if (next !== null && next.text.length > text.length && next.text.startsWith(text) && next.text.slice(text.length).trim() !== '') {
    return { text: next.text.slice(text.length), source: 'completion', acceptable: true };
  }
  if (result.placeholder !== undefined && result.prefix === '' && result.state.cursor === cursor) {
    return { text: result.placeholder, source: 'placeholder', acceptable: false };
  }
  return null;
}

/** The line with the ghost accepted: all of it, or up to the end of its next word. */
export function applyGhost(state: EditState, ghost: Ghost, unit: 'all' | 'word' = 'all'): EditState {
  if (!ghost.acceptable || state.cursor !== state.text.length) return state;
  const taken = unit === 'all' ? ghost.text : (/^\s*[^\s/]+\/?/.exec(ghost.text)?.[0] ?? ghost.text);
  const text = state.text + taken;
  return { text, cursor: text.length };
}
