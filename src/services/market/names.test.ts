// The known names the interim source resolves and searches with while the Worker's search is
// not deployed.
import { describe, expect, it } from 'vitest';
import { SYMBOL_RE } from './contract';
import { LOCAL_NAMES, resolveLocal, searchLocal, suggestLocal } from './names';

describe('the known names', () => {
  it('are canonical tickers, each once', () => {
    for (const hit of LOCAL_NAMES) expect(SYMBOL_RE.test(hit.symbol), hit.symbol).toBe(true);
    expect(new Set(LOCAL_NAMES.map((hit) => hit.symbol)).size).toBe(LOCAL_NAMES.length);
  });

  it('search by name or ticker, best first', () => {
    expect(searchLocal('commonwealth bank').map((hit) => hit.symbol)).toEqual(['CBA.AX']);
    expect(searchLocal('apple')[0]?.symbol).toBe('AAPL');
    expect(searchLocal('cba')[0]?.symbol).toBe('CBA.AX');
    expect(searchLocal('bank').map((hit) => hit.symbol)).toEqual(['CBA.AX', 'WBC.AX', 'NAB.AX']);
    expect(searchLocal('s&p').map((hit) => hit.symbol)).toEqual(['^AXJO', '^GSPC']);
    expect(searchLocal('zzzzqq')).toEqual([]);
    expect(searchLocal('  ')).toEqual([]);
    expect(searchLocal('a', 2)).toHaveLength(2);
  });

  it('resolve an alias, a listing with the same base, or one name with the word', () => {
    expect(resolveLocal('SP500')).toEqual({ symbol: '^GSPC', label: 'S&P 500' });
    expect(resolveLocal('CBA')).toEqual({ symbol: 'CBA.AX', label: null });
    expect(resolveLocal('APPLE')).toEqual({ symbol: 'AAPL', label: null });
    expect(resolveLocal('ATLASSIAN')).toEqual({ symbol: 'TEAM', label: null });
    // Part of a word, or a word in more than one name, is not enough.
    expect(resolveLocal('APPL')).toBeNull();
    expect(resolveLocal('BANK')).toBeNull();
    expect(resolveLocal('ZZZZQQ')).toBeNull();
  });

  it('suggest close tickers and names for a ticker that does not exist', () => {
    expect(suggestLocal('APPL').map((hit) => hit.symbol)).toContain('AAPL');
    expect(suggestLocal('MSFTT').map((hit) => hit.symbol)).toContain('MSFT');
    expect(suggestLocal('ZZZZQQ')).toEqual([]);
    expect(suggestLocal('A').length).toBeLessThanOrEqual(5);
  });
});
