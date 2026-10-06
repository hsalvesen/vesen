// Matching for completion (docs/plan/designs/terminal-input.md, "COMPLETION ENGINE", d). A
// case-sensitive prefix match comes first; only when nothing matches does case stop counting,
// so phone keyboards that capitalise the first letter still complete. Lists are sorted by name,
// except subcommands and flags, which keep the order their spec declares. One copy of the
// common-prefix loop the old Tab ladder repeated eight times (F022).

import { editDistance } from '../registry';
import type { Candidate } from '../types';

/** The most candidates a result carries; the uncapped count is kept beside them. */
export const MAX_CANDIDATES = 200;

const collator = new Intl.Collator('en');

/** Name order, as ls sorts: the locale's collation, then code points to break ties. */
export function compareNames(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * The items whose value starts with `prefix`: case-sensitively first, then, when none does (or
 * always, for a case-insensitive source), ignoring case. `caseFolded` says some match needed it.
 */
export function matchPrefix<T extends { readonly value: string }>(
  items: readonly T[],
  prefix: string,
  caseInsensitive = false,
): { matched: T[]; caseFolded: boolean } {
  if (!caseInsensitive) {
    const exact = items.filter((item) => item.value.startsWith(prefix));
    if (exact.length > 0 || prefix === '') return { matched: exact, caseFolded: false };
  }
  const lower = prefix.toLowerCase();
  const matched = items.filter((item) => item.value.toLowerCase().startsWith(lower));
  return { matched, caseFolded: matched.some((item) => !item.value.startsWith(prefix)) };
}

/** Drops later candidates with the same value (ignoring case, for a case-insensitive source). */
export function dedupe(items: readonly Candidate[], caseInsensitive = false): Candidate[] {
  const seen = new Set<string>();
  const kept: Candidate[] = [];
  for (const item of items) {
    const key = caseInsensitive ? item.value.toLowerCase() : item.value;
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(item);
  }
  return kept;
}

/** Candidates in name order, by value. */
export function sortCandidates(items: readonly Candidate[]): Candidate[] {
  return [...items].sort((a, b) => compareNames(a.value, b.value));
}

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;

/**
 * The longest prefix all values share, in the first value's spelling. Ignoring case, 'Kanga' and
 * 'kangaroo' share 'Kanga'. Never ends halfway through a surrogate pair.
 */
export function longestCommonPrefix(values: readonly string[], caseInsensitive = false): string {
  const first = values[0];
  if (first === undefined) return '';
  let length = first.length;
  const fold = (s: string): string => (caseInsensitive ? s.toLowerCase() : s);
  for (const value of values) {
    const a = fold(first);
    const b = fold(value);
    // Lower-casing keeps the length of everything but a few letters; compare char by char on
    // the originals when it does not.
    const sameLength = a.length === first.length && b.length === value.length;
    let i = 0;
    const limit = Math.min(length, value.length);
    while (i < limit && (sameLength ? a[i] === b[i] : first[i] === value[i])) i += 1;
    length = i;
    if (length === 0) break;
  }
  if (length > 0 && isHighSurrogate(first.charCodeAt(length - 1))) length -= 1;
  return first.slice(0, length);
}

/**
 * Names within `maxDistance` edits (insertions, deletions, substitutions and swaps of
 * neighbours) of `word`, nearest first, never the word itself and never a name that shares
 * nothing with it: at most three.
 */
export function didYouMean(word: string, pool: readonly string[], maxDistance = 2): string[] {
  if (word === '') return [];
  const lower = word.toLowerCase();
  const length = Array.from(lower).length;
  const scored: { name: string; distance: number }[] = [];
  for (const name of new Set(pool)) {
    if (name === word) continue;
    const distance = editDistance(lower, name.toLowerCase());
    if (distance <= maxDistance && distance < length) scored.push({ name, distance });
  }
  return scored
    .sort((a, b) => a.distance - b.distance || compareNames(a.name, b.name))
    .slice(0, 3)
    .map(({ name }) => name);
}
