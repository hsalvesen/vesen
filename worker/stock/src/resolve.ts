// What to show when a symbol does not exist: a known alias, or a ticker the search ranks far
// ahead of everything else, or else did-you-mean suggestions. Resolution is deliberately
// conservative, because a wrong guess is worse than asking.

import { SYMBOL_ALIASES, type SearchHit } from './contract';
import { toSearchHit, type RankedHit } from './providers/yahooSearch';

export const MAX_SUGGESTIONS = 5;

/** The alias target for a name such as SP500, or null. */
export function aliasFor(query: string): string | null {
  return SYMBOL_ALIASES.get(query.toUpperCase())?.symbol ?? null;
}

const letters = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/**
 * The ticker `query` stands for, or null when no hit clearly wins:
 * - a listing whose base symbol is the query (`CBA` → CBA.AX);
 * - otherwise the top hit, when it scores at least twice the runner-up and its name contains
 *   the query (`APPLE` → AAPL, 247,248 against 20,686 once futures are filtered out).
 */
export function pickResolution(query: string, hits: readonly RankedHit[]): string | null {
  const wanted = query.toUpperCase();
  const sameBase = hits.find((hit) => hit.symbol !== wanted && hit.symbol.split('.')[0] === wanted);
  if (sameBase) return sameBase.symbol;

  const [top, runnerUp] = hits;
  if (!top || top.symbol === wanted) return null;
  const dominant = !runnerUp || top.score >= 2 * runnerUp.score;
  const needle = letters(query);
  const named = needle !== '' && top.name !== null && letters(top.name).includes(needle);
  return dominant && named ? top.symbol : null;
}

export function suggestionsFrom(hits: readonly RankedHit[], exclude?: string): SearchHit[] {
  return hits
    .filter((hit) => hit.symbol !== exclude)
    .slice(0, MAX_SUGGESTIONS)
    .map(toSearchHit);
}
