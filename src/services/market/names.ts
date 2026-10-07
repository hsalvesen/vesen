// A short list of well-known instruments, so `stock -s`, did-you-mean and names such as `apple`
// or `cba` still work while the stock Worker (and its search) is not deployed. Pure data and
// string matching; no network.

import { SYMBOL_ALIASES, type SearchHit } from './contract';

export const LOCAL_NAMES: readonly SearchHit[] = [
  { symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NasdaqGS', type: 'EQUITY' },
  { symbol: 'TEAM', name: 'Atlassian Corporation', exchange: 'NasdaqGS', type: 'EQUITY' },
  { symbol: 'MSFT', name: 'Microsoft Corporation', exchange: 'NasdaqGS', type: 'EQUITY' },
  { symbol: 'NVDA', name: 'NVIDIA Corporation', exchange: 'NasdaqGS', type: 'EQUITY' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', exchange: 'NasdaqGS', type: 'EQUITY' },
  { symbol: 'AMZN', name: 'Amazon.com, Inc.', exchange: 'NasdaqGS', type: 'EQUITY' },
  { symbol: 'META', name: 'Meta Platforms, Inc.', exchange: 'NasdaqGS', type: 'EQUITY' },
  { symbol: 'TSLA', name: 'Tesla, Inc.', exchange: 'NasdaqGS', type: 'EQUITY' },
  { symbol: 'CBA.AX', name: 'Commonwealth Bank of Australia', exchange: 'ASX', type: 'EQUITY' },
  { symbol: 'BHP.AX', name: 'BHP Group Limited', exchange: 'ASX', type: 'EQUITY' },
  { symbol: 'CSL.AX', name: 'CSL Limited', exchange: 'ASX', type: 'EQUITY' },
  { symbol: 'WBC.AX', name: 'Westpac Banking Corporation', exchange: 'ASX', type: 'EQUITY' },
  { symbol: 'NAB.AX', name: 'National Australia Bank Limited', exchange: 'ASX', type: 'EQUITY' },
  { symbol: 'ANZ.AX', name: 'ANZ Group Holdings Limited', exchange: 'ASX', type: 'EQUITY' },
  { symbol: 'WES.AX', name: 'Wesfarmers Limited', exchange: 'ASX', type: 'EQUITY' },
  { symbol: 'XRO.AX', name: 'Xero Limited', exchange: 'ASX', type: 'EQUITY' },
  { symbol: '^AXJO', name: 'S&P/ASX 200', exchange: 'ASX', type: 'INDEX' },
  { symbol: '^GSPC', name: 'S&P 500', exchange: 'SNP', type: 'INDEX' },
  { symbol: '^IXIC', name: 'Nasdaq Composite', exchange: 'Nasdaq GIDS', type: 'INDEX' },
  { symbol: '^DJI', name: 'Dow Jones Industrial Average', exchange: 'DJI', type: 'INDEX' },
  { symbol: 'BTC-USD', name: 'Bitcoin USD', exchange: 'CCC', type: 'CRYPTOCURRENCY' },
  { symbol: 'ETH-USD', name: 'Ethereum USD', exchange: 'CCC', type: 'CRYPTOCURRENCY' },
  { symbol: 'AUDUSD=X', name: 'AUD/USD', exchange: 'CCY', type: 'CURRENCY' },
];

/** Letters and digits only, lower case: `Commonwealth Bank` → `commonwealthbank`. */
const letters = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** The part before an exchange suffix: CBA.AX → CBA. */
const base = (symbol: string): string => symbol.replace(/^\^/, '').split('.')[0] ?? symbol;

/** Edits between two short strings, for did-you-mean on mistyped tickers (APPL → AAPL). */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0] ?? 0;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = row[j] ?? 0;
      row[j] = Math.min(above + 1, (row[j - 1] ?? 0) + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length] ?? 0;
}

/**
 * The known instruments matching `query`, best first: an exact ticker or its base (`cba`), then
 * names that start with the query, then names that contain it.
 */
export function searchLocal(query: string, limit = 6): SearchHit[] {
  const needle = letters(query);
  if (needle === '') return [];
  const upper = query.trim().toUpperCase();
  const scored: { hit: SearchHit; score: number }[] = [];
  for (const hit of LOCAL_NAMES) {
    const name = letters(hit.name ?? '');
    let score = 0;
    if (hit.symbol === upper) score = 4;
    else if (base(hit.symbol) === upper.replace(/^\^/, '')) score = 3;
    else if (name.startsWith(needle)) score = 2;
    else if (name.includes(needle)) score = 1;
    if (score > 0) scored.push({ hit, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ hit }) => hit);
}

/**
 * What a symbol Yahoo does not know stands for, as the Worker resolves it: an alias (SP500), a
 * listing whose base is the query (CBA → CBA.AX), or the one known name with it as a word
 * (APPLE → AAPL). Null when nothing clearly wins.
 */
export function resolveLocal(symbol: string): { readonly symbol: string; readonly label: string | null } | null {
  const alias = SYMBOL_ALIASES.get(symbol);
  if (alias) return { symbol: alias.symbol, label: alias.label };
  const sameBase = LOCAL_NAMES.filter((hit) => hit.symbol !== symbol && base(hit.symbol) === symbol);
  if (sameBase.length === 1 && sameBase[0]) return { symbol: sameBase[0].symbol, label: null };
  // A whole word of one name only: APPLE, MICROSOFT, COMMONWEALTH; never part of one (APPL).
  const needle = letters(symbol);
  const words = (name: string | null): string[] => (name ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u);
  const named = needle.length >= 3 ? LOCAL_NAMES.filter((hit) => words(hit.name).includes(needle)) : [];
  if (named.length === 1 && named[0] && named[0].symbol !== symbol) return { symbol: named[0].symbol, label: null };
  return null;
}

/** Up to five known tickers close to a symbol that does not exist: did-you-mean. */
export function suggestLocal(symbol: string): SearchHit[] {
  const wanted = base(symbol);
  const near = LOCAL_NAMES.map((hit) => ({ hit, d: distance(wanted, base(hit.symbol)) }))
    .filter(({ d }) => d > 0 && d <= Math.min(2, Math.max(1, wanted.length - 2)))
    .sort((a, b) => a.d - b.d)
    .map(({ hit }) => hit);
  const named = searchLocal(symbol).filter((hit) => hit.symbol !== symbol);
  const seen = new Set<string>();
  return [...named, ...near].filter((hit) => !seen.has(hit.symbol) && seen.add(hit.symbol)).slice(0, 5);
}
