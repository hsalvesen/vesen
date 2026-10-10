// stock (docs/plan/07-stock-and-proxy.md): its spec and words, and what it prints for a quote,
// several, a search, and every failure, with the market client faked through its port. The
// exact error copy is the plan's; no request is made for bare `stock` or an invalid ticker.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runLine, session } from '../../../tests/harness';
import { isTrustedAction, lineText, type Action, type Block } from '../../output/model';
import { CURATED_SYMBOLS, RANGES, SYMBOL_RE } from '../../services/market/contract';
import { provideMarket, type Market, type QuoteOutcome } from '../../services/market/port';
import { RECORDED_AT_MS, fakeMarket, quoteOf } from '../../testing/quotes';
import { buildRegistry } from '../index';
import spec, { RANGE_VALUES, TICKER_VALUES, stockLabel } from './stock';
import { DRAW_MS, USAGE, USAGE_NARROW } from './stock.run';
import type { QuoteCardView, QuoteTableView } from './stock/view';

afterEach(() => provideMarket(null));

function use(market: Market): void {
  provideMarket(() => Promise.resolve(market));
}

const live = (symbol: string): QuoteOutcome => ({ ok: true, quote: quoteOf(symbol), freshness: 'live', via: 'worker' });

/** Every trusted action in the output: chips, spans, and the card's and table's own. */
function actions(blocks: readonly Block[]): Action[] {
  const found: Action[] = [];
  const visit = (value: unknown): void => {
    if (isTrustedAction(value)) {
      found.push(value);
      return;
    }
    if (Array.isArray(value)) value.forEach(visit);
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(visit);
  };
  visit(blocks);
  return found;
}

const runLines = (blocks: readonly Block[]): string[] => actions(blocks).flatMap((action) => (action.kind === 'run' ? [action.line] : []));

const CHIP_LINE = new RegExp(`^stock(?: -f)?(?: -r (?:${RANGES.join('|')}))? (\\S+)$`);

function expectSafeLines(blocks: readonly Block[]): void {
  for (const line of runLines(blocks)) {
    const match = CHIP_LINE.exec(line);
    expect(match, line).not.toBeNull();
    expect(SYMBOL_RE.test(match?.[1] ?? ''), line).toBe(true);
  }
}

const component = (blocks: readonly Block[]) => blocks.find((block) => block.type === 'component');
const chipLabels = (blocks: readonly Block[]): string[] =>
  blocks.flatMap((block) => (block.type === 'chips' ? [`${block.label ?? ''}|${block.items.map((item) => item.label).join(' ')}`] : []));

describe('the spec', () => {
  it('is a network command with a 10 s budget, flags, a lazy body and an offline example', () => {
    expect(spec).toMatchObject({ name: 'stock', category: 'network', network: true, budgetMs: 10_000 });
    expect(spec.run).toBeUndefined();
    expect(spec.load).toBeTypeOf('function');
    expect(spec.flags?.map((flag) => flag.long)).toEqual(['range', 'search', 'force', 'plain', 'json']);
    expect(spec.examples?.filter((example) => example.offline).map((example) => example.line)).toEqual(['stock']);
    expect(spec.summary.length).toBeLessThanOrEqual(50);
    expect(buildRegistry([], [spec]).validate()).toEqual([]);
  });

  it("completes the contract's ranges and curated tickers", () => {
    expect(RANGE_VALUES).toEqual(RANGES);
    expect(TICKER_VALUES).toEqual(CURATED_SYMBOLS);
  });

  it('says what it is fetching on the status line', () => {
    expect(stockLabel(['stock', 'cba.ax'])).toBe('fetching CBA.AX…');
    expect(stockLabel(['stock', '$aapl'])).toBe('fetching AAPL…');
    expect(stockLabel(['stock', '-r', '5d', 'AAPL', '-f'])).toBe('fetching AAPL…');
    expect(stockLabel(['stock', 'AAPL', 'CBA.AX'])).toBe('fetching AAPL and CBA.AX…');
    expect(stockLabel(['stock', 'A', 'B', 'C'])).toBe('fetching A, B and C…');
    expect(stockLabel(['stock', 'A', 'B', 'C', 'D', 'E'])).toBe('fetching A, B and 3 more…');
    expect(stockLabel(['stock', '-s', 'commonwealth', 'bank'])).toBe('searching for commonwealth bank…');
    expect(stockLabel(['stock', '--search=x'])).toBe('stock');
    expect(stockLabel(['stock'])).toBe('stock');
  });
});

describe('bare stock', () => {
  it('prints usage and example chips, with recent tickers, and asks for no quote', async () => {
    const market = fakeMarket({}, { recent: ['MSFT', 'NVDA', '^GSPC', 'TEAM'] });
    use(market);
    const { status, blocks, stdoutPlain } = await runLine('stock');
    expect(status).toBe(0);
    expect(stdoutPlain.split('\n')[0]).toBe('usage: stock [-r RANGE] [-s QUERY] [-f] [--json|--plain] SYMBOL...');
    expect(chipLabels(blocks)).toEqual(['Try:|AAPL TEAM CBA.AX ^AXJO BTC-USD', 'Recent:|MSFT NVDA ^GSPC']);
    expect(runLines(blocks)).toContain('stock CBA.AX');
    expectSafeLines(blocks);
    expect(market.calls).toEqual([]);
  });

  it('breaks its usage between forms on a narrow phone, never inside an option', async () => {
    const narrow = await runLine('stock', { cols: 36 });
    expect(narrow.stdoutPlain.split('\n').slice(0, 2)).toEqual([...USAGE_NARROW]);
    expect((await runLine('stock', { cols: USAGE.length })).stdoutPlain.split('\n')[0]).toBe(USAGE);
    // A pipe keeps the one line, whatever its width.
    expect((await runLine('stock', { cols: 36, tty: false })).stdoutPlain.split('\n')[0]).toBe(USAGE);
  });

  it('works with no client at all, and in a pipe', async () => {
    const terminal = await runLine('stock');
    expect(terminal.status).toBe(0);
    expect(chipLabels(terminal.blocks)).toEqual(['Try:|AAPL TEAM CBA.AX ^AXJO BTC-USD']);
    const piped = await runLine('stock', { tty: false });
    expect(piped.stdoutPlain).toContain('Try: stock AAPL, stock TEAM, stock CBA.AX, stock ^AXJO, stock BTC-USD');
  });
});

describe('one ticker', () => {
  it('draws a quote card, with its plain text, and asks within the budget', async () => {
    const market = fakeMarket({ AAPL: live('AAPL') });
    use(market);
    const { status, blocks, stdoutPlain } = await runLine('stock AAPL');
    expect(status).toBe(0);
    const card = component(blocks);
    expect(card).toMatchObject({ type: 'component', name: 'quote-card' });
    if (card?.type !== 'component') return;
    const view = card.props as QuoteCardView;
    expect(view).toMatchObject({ kind: 'quote-card', symbol: 'AAPL', name: 'Apple Inc.', price: '332.89 USD', stale: null });
    expect(card.plain).toBe(stdoutPlain + '\n');
    expect(stdoutPlain.split('\n')[0]).toBe('AAPL  Apple Inc.');
    expect(card.alt).toMatch(/^AAPL, Apple Inc\.: 332\.89 USD\. down /);
    expect(market.calls).toEqual([{ symbol: 'AAPL', range: '1d', force: false, budgetMs: 9500 }]);
    expect(runLines(blocks)).toEqual(['stock -f AAPL', 'stock AAPL', 'stock -r 5d AAPL', 'stock -r 1mo AAPL', 'stock -r 1y AAPL']);
    expectSafeLines(blocks);
  });

  it.each([
    ['stock aapl', 'AAPL'],
    // Quoted, or the shell expands $aapl as a variable first, as bash does.
    ["stock '$aapl'", 'AAPL'],
    ['stock ASX:CBA', 'CBA.AX'],
    ['stock btc-usd', 'BTC-USD'],
  ])('reads %s as %s', async (line, symbol) => {
    const market = fakeMarket({ [symbol]: live(symbol) });
    use(market);
    expect((await runLine(line)).status).toBe(0);
    expect(market.calls.map((call) => call.symbol)).toEqual([symbol]);
  });

  it('passes the range and -f on', async () => {
    const market = fakeMarket({ AAPL: { ok: true, quote: quoteOf('AAPL', '5d'), freshness: 'live', via: 'worker' } });
    use(market);
    const { blocks } = await runLine('stock -f -r 5d AAPL');
    expect(market.calls).toEqual([{ symbol: 'AAPL', range: '5d', force: true, budgetMs: 9500 }]);
    const view = component(blocks)?.type === 'component' ? ((component(blocks) as { props: QuoteCardView }).props) : null;
    expect(view?.chips.find((chip) => chip.active)?.label).toBe('5d');
    await runLine('stock --range=1y AAPL');
    expect(market.calls[1]?.range).toBe('1y');
  });

  it('says which ticker a name was taken to mean', async () => {
    use(fakeMarket({ CBA: { ok: true, quote: { ...quoteOf('CBA.AX'), resolvedFrom: 'CBA' }, freshness: 'live', via: 'worker' } }));
    const { status, stdoutPlain } = await runLine('stock cba');
    expect(status).toBe(0);
    expect(stdoutPlain.split('\n')[0]).toBe("'cba' isn't a ticker on its own — showing CBA.AX (ASX)");
  });

  it('shows a saved copy as a STALE card, with no error', async () => {
    use(fakeMarket({ AAPL: { ok: true, quote: quoteOf('AAPL'), freshness: 'saved', savedAt: RECORDED_AT_MS, reason: 'timeout', via: 'worker' } }));
    const { status, blocks, stderrPlain } = await runLine('stock AAPL');
    expect(status).toBe(0);
    expect(stderrPlain).toBe('');
    const card = component(blocks);
    expect(card?.type === 'component' && (card.props as QuoteCardView).stale).toBe('timed out');
    expect(card?.type === 'component' && (card.props as QuoteCardView).footer).toMatch(/^Saved copy from .* · live data unavailable \(timed out\)$/);
  });

  it('prints plain text for --plain and into a pipe, and the envelope for --json', async () => {
    use(fakeMarket({ AAPL: live('AAPL') }));
    const plain = await runLine('stock --plain AAPL');
    expect(component(plain.blocks)).toBeUndefined();
    expect(plain.stdoutPlain).toContain('332.89 USD  ▼ −0.80 (−0.24%)');
    const piped = await runLine('stock AAPL', { tty: false });
    expect(piped.stdoutPlain).toBe(plain.stdoutPlain);
    const json = await runLine('stock --json AAPL');
    expect(JSON.parse(json.stdoutPlain)).toEqual({ ...quoteOf('AAPL'), via: 'worker', freshness: 'live' });
  });

  it('says in --json when a quote came through the interim proxy, or from memory', async () => {
    use(fakeMarket({ AAPL: { ok: true, quote: quoteOf('AAPL'), freshness: 'memory', via: 'interim' } }));
    expect(JSON.parse((await runLine('stock --json AAPL')).stdoutPlain)).toMatchObject({ symbol: 'AAPL', via: 'interim', freshness: 'memory' });
  });

  it('marks a saved copy as one in --json', async () => {
    use(fakeMarket({ AAPL: { ok: true, quote: quoteOf('AAPL'), freshness: 'saved', savedAt: RECORDED_AT_MS, reason: 'offline', via: 'worker' } }));
    const { stdoutPlain } = await runLine('stock --json AAPL');
    expect(JSON.parse(stdoutPlain)).toEqual({
      ...quoteOf('AAPL'),
      via: 'worker',
      freshness: 'saved',
      stale: true,
      savedCopy: { savedAt: RECORDED_AT_MS / 1000, reason: 'offline' },
    });
  });
});

describe('the status line', () => {
  it('starts with the label, then says when it is slow and when it retries', async () => {
    const market = fakeMarket({});
    use({
      ...market,
      async quote(_symbol, _range, opts = {}) {
        opts.onPhase?.('slow', 1);
        await Promise.resolve();
        opts.onPhase?.('very-slow', 1);
        await Promise.resolve();
        opts.onPhase?.('retry', 2);
        await Promise.resolve();
        return live('CBA.AX');
      },
    });
    const s = await session();
    const labels: string[] = [];
    const stop = s.app.shell.job.subscribe((job) => {
      if (job?.label != null) labels.push(job.label);
    });
    await s.run('stock CBA.AX');
    stop();
    s.stop();
    expect(labels.filter((label, i) => label !== labels[i - 1])).toEqual([
      'fetching CBA.AX…',
      'still fetching CBA.AX…',
      'taking longer than usual — market data is slow…',
      'retrying CBA.AX (2/2)…',
    ]);
  });
});

describe('failures, in plain words', () => {
  const fail = (code: string, extra: object = {}): QuoteOutcome => ({ ok: false, error: { code, ...extra } }) as QuoteOutcome;

  it("rejects what cannot be a ticker before any request", async () => {
    const market = fakeMarket({});
    use(market);
    const { status, stderrPlain } = await runLine("stock 'AP PL!'");
    expect(status).toBe(1);
    expect(stderrPlain).toBe("stock: 'AP PL!' isn't a valid ticker\nTickers look like AAPL, CBA.AX, ^AXJO, BTC-USD or AUDUSD=X.");
    expect(market.calls).toEqual([]);
    for (const line of ["stock '<img src=x>'", 'stock ../x', 'stock %2F', `stock ${'A'.repeat(16)}`]) {
      expect((await runLine(line)).status, line).toBe(1);
    }
    expect(market.calls).toEqual([]);
  });

  it('offers did-you-mean chips for a ticker that does not exist', async () => {
    use(fakeMarket({ ZZZZQQ: fail('not_found', { suggestions: [{ symbol: 'ZS', name: 'Zscaler', exchange: 'NasdaqGS', type: 'EQUITY' }, { symbol: 'ZZZ.TO', name: 'x', exchange: 'TOR', type: 'EQUITY' }, { symbol: '<b>', name: 'x', exchange: null, type: 'EQUITY' }] }) }));
    const { status, stderrPlain, blocks } = await runLine('stock ZZZZQQ');
    expect(status).toBe(1);
    expect(stderrPlain).toBe("stock: no market data for 'ZZZZQQ'");
    expect(chipLabels(blocks)).toEqual(['Did you mean:|ZS ZZZ.TO']);
    expectSafeLines(blocks);
  });

  it('suggests a search when there is nothing to suggest', async () => {
    use(fakeMarket({}));
    const { stderrPlain } = await runLine('stock ZZZZQQ');
    expect(stderrPlain).toBe("stock: no market data for 'ZZZZQQ'\nTry a company name, e.g. stock -s atlassian");
  });

  it.each([
    ['rate_limited', { retryAfter: 20 }, 'stock: too many requests — try again in 20 s.'],
    ['rate_limited', {}, 'stock: too many requests — try again in a minute.'],
    ['timeout', {}, 'stock: no response after 10 s — your connection or the quote service is slow.'],
    ['offline', {}, "stock: you're offline and there's no saved quote for AAPL."],
    ['upstream_unavailable', { retryAfter: 30 }, "stock: market data is unavailable right now. This is on vesen's side, not yours. Try again in a minute."],
    ['network', {}, "stock: market data is unavailable right now. This is on vesen's side, not yours. Try again in a minute."],
    ['internal', {}, "stock: market data is unavailable right now. This is on vesen's side, not yours. Try again in a minute."],
    [
      'origin_not_allowed',
      {},
      "stock: live quotes aren't available on this host.\nvesen's quote proxy only serves vesen.app — set VITE_STOCK_API to your own (README → Stock quotes).",
    ],
  ])('%s %j', async (code, extra, message) => {
    use(fakeMarket({ AAPL: fail(code, extra) }));
    const { status, stderrPlain, blocks } = await runLine('stock AAPL');
    expect(status).toBe(1);
    expect(stderrPlain).toBe(message);
    const retry = code === 'timeout' || code === 'upstream_unavailable' || code === 'network' || code === 'internal';
    expect(chipLabels(blocks)).toEqual(retry ? ['|try again'] : []);
    if (retry) expect(runLines(blocks)).toEqual(['stock -f AAPL']);
  });

  it('says so when no client was provided, as on a copy built without one', async () => {
    const { status, stderrPlain } = await runLine('stock AAPL');
    expect(status).toBe(1);
    expect(stderrPlain).toContain("stock: live quotes aren't available on this host.");
  });

  it('never shows exception text', async () => {
    use({ ...fakeMarket({}), quote: async () => fail('internal') });
    const { stderrPlain } = await runLine('stock AAPL');
    expect(stderrPlain).not.toMatch(/Error|Unexpected token|undefined/);
  });

  it('checks its words', async () => {
    use(fakeMarket({}));
    expect((await runLine('stock -r 7d AAPL')).stderrPlain).toContain("stock: invalid range '7d' (choose 1d, 5d, 1mo, 6mo, 1y, 5y)");
    expect((await runLine('stock --json --plain AAPL')).stderrPlain).toContain('--json and --plain cannot be used together');
    expect((await runLine('stock A B C D E F G')).stderrPlain).toContain('stock: at most 6 tickers at once');
    expect((await runLine('stock -x AAPL')).status).toBe(1);
  });
});

describe('several tickers', () => {
  it('draw a table, each ticker a chip, failures inline', async () => {
    const market = fakeMarket({ AAPL: live('AAPL'), 'CBA.AX': live('CBA.AX'), 'BTC-USD': live('BTC-USD') });
    use(market);
    const { status, blocks, stdoutPlain } = await runLine('stock AAPL CBA.AX BTC-USD ZZZZQQ aapl');
    expect(status).toBe(0);
    const table = component(blocks);
    expect(table).toMatchObject({ type: 'component', name: 'quote-table' });
    if (table?.type !== 'component') return;
    const view = table.props as QuoteTableView;
    expect(view.rows.map((row) => [row.symbol, row.failure])).toEqual([
      ['AAPL', null],
      ['CBA.AX', null],
      ['BTC-USD', null],
      ['ZZZZQQ', '— not found'],
    ]);
    // Asked once each, the same ticker twice only once.
    expect(market.calls.map((call) => call.symbol)).toEqual(['AAPL', 'CBA.AX', 'BTC-USD', 'ZZZZQQ']);
    expect(stdoutPlain.split('\n')[0]).toMatch(/^SYMBOL +LAST +CHG%$/);
    expect(runLines(blocks)).toEqual(['stock AAPL', 'stock CBA.AX', 'stock BTC-USD', 'stock ZZZZQQ']);
    expectSafeLines(blocks);
  });

  it('fail when none could be shown, and suggest a search for a name typed without -s', async () => {
    use(fakeMarket({}));
    const { status, stderrPlain, blocks } = await runLine('stock commonwealth bank');
    expect(status).toBe(1);
    expect(stderrPlain).toBe('Looking for a company? Try stock -s commonwealth bank');
    // An insert, never a run: the visitor sends it.
    expect(actions(blocks).filter((action) => action.kind === 'insert')).toHaveLength(1);
    expect(runLines(blocks)).toEqual(['stock COMMONWEALTH', 'stock BANK']);
  });

  it('print a JSON list', async () => {
    use(fakeMarket({ AAPL: live('AAPL') }));
    const { stdoutPlain } = await runLine('stock --json AAPL ZZZZQQ');
    expect(JSON.parse(stdoutPlain)).toEqual([{ ...quoteOf('AAPL'), via: 'worker', freshness: 'live' }, { symbol: 'ZZZZQQ', error: { code: 'not_found' } }]);
  });
});

describe('the 10 s budget', () => {
  /** A slow market: each lookup takes all the time it is given, then gives its saved copy. */
  function slowMarket(options: { ignoreBudget?: boolean } = {}): Market & { readonly asked: { symbol: string; at: number; budgetMs: number }[] } {
    const asked: { symbol: string; at: number; budgetMs: number }[] = [];
    const savedCopy = (symbol: string): QuoteOutcome => ({ ok: true, quote: quoteOf(symbol), freshness: 'saved', savedAt: RECORDED_AT_MS, reason: 'timeout', via: 'interim' });
    return {
      ...fakeMarket({}),
      asked,
      quote(symbol, _range, opts = {}) {
        const budgetMs = opts.budgetMs ?? 9500;
        asked.push({ symbol, at: Date.now(), budgetMs });
        // As the client does: with no time left it asks nothing and gives the saved copy.
        if (budgetMs < 250) return Promise.resolve(savedCopy(symbol));
        return new Promise((resolve) => {
          const timer = options.ignoreBudget === true ? undefined : setTimeout(() => resolve(savedCopy(symbol)), budgetMs);
          opts.signal?.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              resolve({ ok: false, error: { code: 'cancelled' } });
            },
            { once: true },
          );
        });
      },
    };
  }

  afterEach(() => vi.useRealTimers());

  it("plans every lookup inside the budget, counted from the command's start, and draws the table", async () => {
    await import('./stock.run');
    vi.useFakeTimers({ now: RECORDED_AT_MS });
    const market = slowMarket();
    use(market);
    const s = await session({ now: () => Date.now() });
    const started = Date.now();
    const pending = s.run('stock AAPL CBA.AX BTC-USD TEAM');
    await vi.advanceTimersByTimeAsync(11_000);
    const { status, blocks, stderrPlain } = await pending;
    s.stop();
    // Three at once take what there is; the fourth, with nothing left, asks nothing.
    expect(market.asked.map((ask) => ask.symbol)).toEqual(['AAPL', 'CBA.AX', 'BTC-USD', 'TEAM']);
    for (const ask of market.asked) expect(ask.at + ask.budgetMs).toBeLessThanOrEqual(started + 10_000 - DRAW_MS);
    expect(market.asked[3]?.budgetMs).toBe(0);
    expect(stderrPlain).not.toContain('timed out');
    expect(status).toBe(0);
    const table = component(blocks);
    expect(table?.type === 'component' && (table.props as QuoteTableView).rows.map((row) => [row.symbol, row.stale])).toEqual([
      ['AAPL', true],
      ['CBA.AX', true],
      ['BTC-USD', true],
      ['TEAM', true],
    ]);
  });

  it('draws the rows in hand when the budget cuts lookups off, with saved copies for the rest', async () => {
    await import('./stock.run');
    vi.useFakeTimers({ now: RECORDED_AT_MS });
    const market = slowMarket({ ignoreBudget: true });
    use(market);
    const s = await session({ now: () => Date.now() });
    const pending = s.run('stock AAPL CBA.AX');
    await vi.advanceTimersByTimeAsync(11_000);
    const { status, blocks, stderrPlain } = await pending;
    s.stop();
    expect(stderrPlain).not.toContain('timed out');
    expect(status).toBe(0);
    const table = component(blocks);
    expect(table?.type === 'component' && (table.props as QuoteTableView).rows.map((row) => row.symbol)).toEqual(['AAPL', 'CBA.AX']);
    // Asked again with no time once cut off: no request, only the saved copy.
    expect(market.asked.slice(2).map((ask) => ask.budgetMs)).toEqual([0, 0]);
  });

  it('still stops at once on ^C', async () => {
    const market = slowMarket({ ignoreBudget: true });
    use(market);
    const s = await session();
    const pending = s.run('stock AAPL CBA.AX');
    await vi.waitFor(() => expect(market.asked).toHaveLength(2));
    s.app.shell.abort();
    expect((await pending).status).toBe(130);
    expect(market.asked).toHaveLength(2);
    s.stop();
  });
});

describe('search', () => {
  const hits = [
    { symbol: 'CBA.AX', name: 'Commonwealth Bank of Australia', exchange: 'ASX', type: 'EQUITY' as const },
    { symbol: 'CMWAY', name: '<i>ADR</i>', exchange: 'OTC', type: 'EQUITY' as const },
    { symbol: 'not a ticker', name: 'x', exchange: null, type: 'OTHER' as const },
  ];

  it('lists results, each ticker a chip, and says when they are the known names only', async () => {
    use(fakeMarket({}, { search: { ok: true, hits, from: 'local' } }));
    const { status, blocks, stdoutPlain } = await runLine('stock -s commonwealth bank');
    expect(status).toBe(0);
    const table = blocks.find((block) => block.type === 'table');
    expect(table?.type === 'table' && table.rows.map((row) => row.map(lineText))).toEqual([
      ['CBA.AX', 'Commonwealth Bank of Australia', 'ASX', 'stock'],
      ['CMWAY', '<i>ADR</i>', 'OTC', 'stock'],
      ['not a ticker', 'x', '—', 'other'],
    ]);
    expect(runLines(blocks)).toEqual(['stock CBA.AX', 'stock CMWAY']);
    expect(stdoutPlain).toContain("From vesen's short list of well-known names.");
  });

  it('says when nothing was found, and when search failed', async () => {
    use(fakeMarket({}, { search: { ok: true, hits: [], from: 'worker' } }));
    expect((await runLine('stock -s zzzz')).stderrPlain).toBe("stock: nothing found for 'zzzz'\nTry a shorter name, or the ticker itself.");
    use(fakeMarket({}, { search: { ok: false, error: { code: 'upstream_unavailable' } } }));
    expect((await runLine('stock -s apple')).stderrPlain).toBe('stock: search is unavailable right now. Try again in a minute.');
    expect((await runLine('stock -s')).stderrPlain).toContain('-s needs a company name');
  });

  it('is tab-separated in a pipe', async () => {
    use(fakeMarket({}, { search: { ok: true, hits: hits.slice(0, 1), from: 'worker' } }));
    expect((await runLine('stock -s cba', { tty: false })).stdoutPlain).toBe('CBA.AX\tCommonwealth Bank of Australia\tASX\tstock');
  });
});
