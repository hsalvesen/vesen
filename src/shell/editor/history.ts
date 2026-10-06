// History at the prompt (docs/plan/designs/terminal-input.md, historyStore; F069): Up and Down
// step through the lines that start with what was typed, skipping repeats, and Down past the
// newest gives back the line that was being typed (the draft). Ctrl+R searches backwards for a
// line containing the query, as readline's reverse-i-search does. Pure: the lines are the
// session's history, oldest first.

import type { EditState } from '../complete/types';

export interface HistoryNav {
  /** The history line on the prompt, by index; null while the draft is. */
  readonly index: number | null;
  /** What was typed when stepping began: only lines starting with it are offered. */
  readonly prefix: string;
  /** The line being typed when stepping began, which Down past the newest line restores. */
  readonly draft: EditState | null;
}

export const NAV_IDLE: HistoryNav = { index: null, prefix: '', draft: null };

/**
 * Up (-1) or Down (+1) from where `nav` is. Null when there is nothing further that way: Up past
 * the oldest match, or Down while the draft is already on the prompt.
 */
export function stepHistory(
  lines: readonly string[],
  nav: HistoryNav,
  state: EditState,
  dir: -1 | 1,
): { nav: HistoryNav; state: EditState } | null {
  const starting = nav.index === null;
  if (starting && dir === 1) return null;
  const prefix = starting ? state.text : nav.prefix;
  const draft = starting ? state : nav.draft;
  const shown = state.text;
  for (let i = (nav.index ?? lines.length) + dir; i >= 0 && i < lines.length; i += dir) {
    const line = lines[i] ?? '';
    if (!line.startsWith(prefix) || line === shown) continue;
    return { nav: { index: i, prefix, draft }, state: { text: line, cursor: line.length } };
  }
  if (dir === 1) return { nav: NAV_IDLE, state: draft ?? { text: '', cursor: 0 } };
  return null;
}

export interface SearchHit {
  /** The history line's index. */
  readonly index: number;
  readonly line: string;
  /** Where the query starts in the line. */
  readonly at: number;
}

/**
 * The next line containing `query`, searching from index `from` (inclusive) towards older lines
 * (-1) or newer ones (+1), and skipping lines the same as `skip` (the hit already shown).
 */
export function searchHistory(
  lines: readonly string[],
  query: string,
  from: number,
  dir: -1 | 1,
  skip: string | null = null,
): SearchHit | null {
  if (query === '') return null;
  for (let i = Math.min(from, lines.length - 1); i >= 0 && i < lines.length; i += dir) {
    const line = lines[i] ?? '';
    if (line === skip) continue;
    const at = dir === -1 ? line.lastIndexOf(query) : line.indexOf(query);
    if (at !== -1) return { index: i, line, at };
  }
  return null;
}

/** Reverse-i-search, as the prompt shows it. */
export interface SearchState {
  readonly query: string;
  /** The line found, or null before anything matched. */
  readonly hit: SearchHit | null;
  /** The last search found nothing: `(failed reverse-i-search)`. The last hit stays shown. */
  readonly failed: boolean;
  /** The line on the prompt before Ctrl+R, which Escape and Ctrl+G put back. */
  readonly saved: EditState;
}

/** Ctrl+R pressed at the prompt: an empty search over the line being typed. */
export function startSearch(saved: EditState): SearchState {
  return { query: '', hit: null, failed: false, saved };
}

/**
 * The search after its query changed. A longer query keeps looking from the line found so far,
 * as readline does; anything else starts again from the newest line.
 */
export function updateSearch(lines: readonly string[], search: SearchState, query: string): SearchState {
  if (query === '') return { ...search, query, hit: null, failed: false };
  const from = search.hit !== null && query.startsWith(search.query) ? search.hit.index : lines.length - 1;
  const hit = searchHistory(lines, query, from, -1);
  return hit === null ? { ...search, query, failed: true } : { ...search, query, hit, failed: false };
}

/** Ctrl+R again (-1) for an older line with the query, or Ctrl+S (+1) for a newer one. */
export function stepSearch(lines: readonly string[], search: SearchState, dir: -1 | 1): SearchState {
  if (search.query === '') return search;
  const from = search.hit === null ? lines.length - 1 : search.hit.index + dir;
  const hit = searchHistory(lines, search.query, from, dir, search.hit?.line ?? null);
  return hit === null ? { ...search, failed: true } : { ...search, hit, failed: false };
}

/** What the search puts on the prompt when it ends: the line found, the cursor where it matched. */
export function searchResult(search: SearchState): EditState {
  const hit = search.hit;
  if (hit === null) return search.saved;
  return { text: hit.line, cursor: hit.at };
}

/** The label before the query: `(reverse-i-search)` or `(failed reverse-i-search)`. */
export function searchLabel(search: SearchState): string {
  return search.failed ? '(failed reverse-i-search)' : '(reverse-i-search)';
}
