import { describe, expect, it } from 'vitest';
import { normaliseYahooSearch, searchUrl, type RankedHit } from '../src/providers/yahooSearch';
import { aliasFor, pickResolution, suggestionsFrom } from '../src/resolve';
import { fixtureJson } from './support/fixtures';

function hits(name: string): RankedHit[] {
  const result = normaliseYahooSearch(fixtureJson(`yahoo-search-${name}.json`));
  if (!result) throw new Error('unreadable');
  return result;
}

describe('normaliseYahooSearch', () => {
  it('keeps equities, ETFs, indices, crypto and currencies, best first', () => {
    const apple = hits('apple');
    expect(apple.map((h) => h.symbol)).toEqual(['AAPL', 'APLE', 'AAPL.TO', 'APC.DE']);
    expect(apple[0]).toEqual({ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', type: 'EQUITY', score: 247_248 });
    // The futures SAAPL=F and XAAPL=F are gone.
    expect(apple.some((h) => h.symbol.endsWith('=F'))).toBe(false);
  });

  it('drops mutual funds', () => {
    expect(hits('cba').map((h) => h.symbol)).toEqual(['CBAT', 'CBA.AX', 'CBAN', 'CBAV.MC', 'CBAUF']);
  });

  it('prefers the long name and the display exchange', () => {
    expect(hits('commonwealth-bank')[0]).toMatchObject({ symbol: 'CBA.AX', name: 'Commonwealth Bank of Australia', exchange: 'Australian' });
  });

  it('returns an empty list for no matches and null for something that is not a search response', () => {
    expect(hits('zzzzqq')).toEqual([]);
    expect(normaliseYahooSearch({ quotes: 'none' })).toBeNull();
    expect(normaliseYahooSearch(undefined)).toBeNull();
  });

  it('drops symbols that fail validation and duplicates', () => {
    const raw = {
      quotes: [
        { symbol: 'AAPL', quoteType: 'EQUITY', score: 3 },
        { symbol: 'aapl', quoteType: 'EQUITY', score: 2 },
        { symbol: '<script>', quoteType: 'EQUITY', score: 1 },
        { symbol: 'X', quoteType: 'OPTION', score: 9 },
      ],
    };
    expect(normaliseYahooSearch(raw)?.map((h) => h.symbol)).toEqual(['AAPL']);
  });

  it('encodes the query', () => {
    expect(searchUrl('query2.finance.yahoo.com', 'commonwealth bank')).toBe(
      'https://query2.finance.yahoo.com/v1/finance/search?q=commonwealth%20bank&quotesCount=10&newsCount=0&listsCount=0',
    );
  });
});

describe('pickResolution', () => {
  it('maps a bare ASX code to its listing', () => {
    expect(pickResolution('CBA', hits('cba'))).toBe('CBA.AX');
  });

  it('maps a company name when one hit dominates and is named for it', () => {
    expect(pickResolution('APPLE', hits('apple'))).toBe('AAPL');
  });

  it('does not guess when hits are close', () => {
    // CBA.AX scores 20,217 and the runner-up 20,036.
    expect(pickResolution('COMMONWEALTH', hits('commonwealth-bank'))).toBeNull();
    expect(pickResolution('ZZZZQQ', hits('zzzzqq'))).toBeNull();
  });

  it('does not resolve when the name does not contain the query', () => {
    const lone: RankedHit[] = [{ symbol: 'AAPL', name: 'Apple Inc.', exchange: 'NASDAQ', type: 'EQUITY', score: 100 }];
    expect(pickResolution('PEAR', lone)).toBeNull();
    expect(pickResolution('AAPL', lone)).toBeNull();
  });
});

describe('aliases and suggestions', () => {
  it('maps index and crypto names', () => {
    expect(aliasFor('sp500')).toBe('^GSPC');
    expect(aliasFor('ASX200')).toBe('^AXJO');
    expect(aliasFor('BITCOIN')).toBe('BTC-USD');
    expect(aliasFor('AAPL')).toBeNull();
    expect(aliasFor('CONSTRUCTOR')).toBeNull();
  });

  it('offers at most five, without scores', () => {
    const suggestions = suggestionsFrom(hits('cba'), 'CBA');
    expect(suggestions).toHaveLength(5);
    expect(suggestions[0]).toEqual({ symbol: 'CBAT', name: 'CBAK Energy Technology Limited', exchange: 'NASDAQ', type: 'EQUITY' });
  });
});
