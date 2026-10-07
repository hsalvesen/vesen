// stock: a quote card for one ticker, a table for several, and search by company name
// (docs/plan/07-stock-and-proxy.md). The body, the client and the cards all load on first use;
// bare `stock` makes no request at all.

import { defineCommand } from '../../shell/types';

// Copies of the contract's RANGES and CURATED_SYMBOLS (stock.test.ts holds them equal), so the
// kernel's chunk, which carries every spec, does not carry the market contract too.
export const RANGE_VALUES = ['1d', '5d', '1mo', '6mo', '1y', '5y'] as const;
export const TICKER_VALUES = ['AAPL', 'TEAM', 'CBA.AX', 'BHP.AX', '^AXJO', '^GSPC', 'BTC-USD', 'AUDUSD=X', 'MSFT', 'NVDA'] as const;

/** The status line while stock runs: 'fetching CBA.AX…', 'searching for apple…'. */
export function stockLabel(argv: readonly string[]): string {
  const operands: string[] = [];
  let search = false;
  const words = argv.slice(1);
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i] ?? '';
    if (word === '--') {
      operands.push(...words.slice(i + 1));
      break;
    }
    if (word === '-r' || word === '--range') {
      i += 1;
    } else if (word === '--search' || (/^-[a-z]+$/.test(word) && word.includes('s'))) {
      search = true;
    } else if (!word.startsWith('-') || word === '-') {
      operands.push(word);
    }
  }
  if (search) return operands.length > 0 ? `searching for ${operands.join(' ')}…` : 'searching…';
  const symbols = operands.map((word) => word.replace(/^\$/, '').toUpperCase());
  if (symbols.length === 0) return 'stock';
  if (symbols.length <= 3) {
    const last = symbols.pop() ?? '';
    return `fetching ${symbols.length > 0 ? `${symbols.join(', ')} and ${last}` : last}…`;
  }
  return `fetching ${symbols.slice(0, 2).join(', ')} and ${symbols.length - 2} more…`;
}

export default defineCommand({
  name: 'stock',
  category: 'network',
  summary: 'show the price of a stock',
  synopsis: ['stock [-r RANGE] [-f] [--plain | --json] SYMBOL...', 'stock -s QUERY...'],
  flags: [
    {
      short: 'r',
      long: 'range',
      description: 'chart RANGE: 1d (the default), 5d, 1mo, 6mo, 1y or 5y',
      value: { name: 'RANGE', source: { kind: 'enum', values: () => RANGE_VALUES.map((value) => ({ value })) } },
    },
    { short: 's', long: 'search', description: 'find tickers by company name' },
    { short: 'f', long: 'force', description: 'ask again, rather than reuse an answer from the last 30 s' },
    { long: 'plain', description: 'print the card as plain text' },
    { long: 'json', description: 'print the quote as JSON' },
  ],
  args: [
    {
      name: 'SYMBOL',
      source: { kind: 'enum', values: () => TICKER_VALUES.map((value) => ({ value })), caseInsensitive: true },
      optional: true,
      variadic: true,
    },
  ],
  examples: [
    { line: 'stock', note: 'how to use it, with tickers to try', offline: true },
    { line: 'stock AAPL', note: 'Apple, on the Nasdaq' },
    { line: 'stock CBA.AX', note: 'Commonwealth Bank, on the ASX' },
    { line: 'stock TEAM', note: 'Atlassian' },
    { line: 'stock ^AXJO', note: 'the S&P/ASX 200' },
    { line: 'stock BTC-USD', note: 'Bitcoin in US dollars' },
    { line: 'stock AAPL CBA.AX BTC-USD', note: 'several at once, as a table' },
    { line: 'stock -r 5d AAPL', note: 'the last five days' },
    { line: 'stock -s commonwealth bank', note: 'find a ticker by name' },
  ],
  seeAlso: ['privacy'],
  network: true,
  // The client keeps half a second of this for drawing a saved copy (MARKET_LIMITS.budgetMs).
  budgetMs: 10_000,
  loadingLabel: stockLabel,
  load: () => import('./stock.run'),
});
