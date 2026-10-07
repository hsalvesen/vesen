// The body of stock; its spec, in stock.ts, loads this the first time stock runs. It reads the
// words, asks the market client (services/market, reached through its port) and writes a
// `quote-card` for one ticker or a `quote-table` for several, with their plain text for pipes.
// Every failure is said in plain words; no exception text ever reaches the screen.

import { DeadlineExceeded } from '../../lib/signals';
import { out, type ChipItem, type Line, type SpanStyle } from '../../output/model';
import { RANGES, isRange, normaliseSymbol, type InstrumentType, type Range, type SearchHit } from '../../services/market/contract';
import { getMarket, type FetchPhase, type Market, type MarketFailure, type QuoteOutcome } from '../../services/market/port';
import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { cardText, tableText } from './stock/text';
import {
  EXAMPLE_SYMBOLS,
  cardAlt,
  cardView,
  hitChips,
  resolvedNote,
  stockLine,
  symbolChips,
  tableAlt,
  tableView,
  type ChipView,
} from './stock/view';

/** What --help, help and man say about stock, besides its spec (stock.ts). */
export const doc: CommandDoc = {
  description:
    "Shows a ticker's price in its own currency, the change since the previous close (24 hours for crypto), today's market phase, a chart and the day and 52-week ranges. Several tickers make a table. Exchange prefixes and a leading $ are understood (ASX:CBA, or '$aapl' in quotes, since the shell expands $aapl), and a company name finds its ticker with a note saying which.",
  man: [
    {
      heading: 'DATA',
      body: "Quotes come through vesen's stock service from Yahoo Finance and, for US listings when it is down, Cboe; a copy of vesen built without that service reads Yahoo through a public proxy, which is slower and says so on every card. Quotes may be delayed, and every card says where its data came from and how old it is. When live data cannot be reached, the last good copy kept in this browser is shown, marked STALE. Not investment advice.",
    },
    {
      heading: 'EXIT STATUS',
      body: '0 when a quote (live or saved) or a search result was shown, 1 otherwise.',
    },
  ],
};

/** The most tickers one line may ask for. */
export const MAX_SYMBOLS = 6;

/** Quotes asked for at once, for a table. */
const CONCURRENCY = 3;

/** The client's budget when the kernel gives no deadline: the spec's 10 s, less time to draw. */
export const LOOKUP_BUDGET_MS = 9500;

/** What is kept back from the command's budget to draw the card or the table. */
export const DRAW_MS = 500;

/**
 * The time left for lookups: until the kernel's deadline (counted from before this body loaded)
 * less time to draw, so a table's later lookups share what the first ones left and none runs
 * past it. Zero when none is left; the client then asks nothing and gives the saved copy.
 */
function budget(ctx: CommandContext): () => number {
  const end = ctx.deadline !== undefined ? ctx.deadline - DRAW_MS : ctx.clock.now() + LOOKUP_BUDGET_MS;
  return () => Math.max(0, end - ctx.clock.now());
}

/**
 * A lookup as it stands once the client has answered. ^C stops the command. When the budget ran
 * out with the lookup still in flight, it is asked again with no time, which makes no request
 * and gives the saved copy or a timeout, so whatever is in hand can still be drawn.
 */
async function settled(ctx: CommandContext, market: Market, symbol: string, range: Range, outcome: QuoteOutcome): Promise<QuoteOutcome> {
  if (!ctx.signal.aborted) return outcome;
  if (!(ctx.signal.reason instanceof DeadlineExceeded)) throw ctx.signal.reason;
  return outcome.ok === false && outcome.error.code === 'cancelled' ? market.quote(symbol, range, { budgetMs: 0 }) : outcome;
}

/**
 * A quote as --json prints it, with where it came from (`via`: the stock Worker, or the interim
 * public proxy) and how fresh it is; a saved copy says that it is one, and why.
 */
function jsonQuote(outcome: Extract<QuoteOutcome, { ok: true }>): unknown {
  const labelled = { ...outcome.quote, via: outcome.via, freshness: outcome.freshness };
  if (outcome.freshness !== 'saved') return labelled;
  return { ...labelled, stale: true, savedCopy: { savedAt: Math.floor(outcome.savedAt / 1000), reason: outcome.reason } };
}

const ERROR: SpanStyle = { fg: 'error' };
const WARN: SpanStyle = { fg: 'warn' };
const MUTED: SpanStyle = { fg: 'muted' };

export const USAGE = 'usage: stock [-r RANGE] [-s QUERY] [-f] [--json|--plain] SYMBOL...';

/** The synopsis on an output too narrow for USAGE, broken between forms rather than inside one. */
export const USAGE_NARROW = ['usage: stock [-r RANGE] [-f] SYMBOL...', '       stock -s QUERY'] as const;

type Mode = 'card' | 'plain' | 'json';

interface Wanted {
  /** As typed: 'cba'. */
  readonly typed: string;
  /** Canonical: 'CBA'. */
  readonly symbol: string;
}

const chipItems = (chips: readonly ChipView[]): ChipItem[] => chips.map(({ label, action }) => ({ label, action }));

/** Runs stock. */
export async function run(ctx: CommandContext): Promise<ExitCode> {
  const rangeOpt = ctx.opts.range;
  const range = typeof rangeOpt === 'string' ? rangeOpt : '1d';
  if (!isRange(range)) return ctx.usage(`invalid range '${range}' (choose ${RANGES.join(', ')})`);
  const json = ctx.opts.json === true;
  const plain = ctx.opts.plain === true;
  if (json && plain) return ctx.usage('--json and --plain cannot be used together');
  const mode: Mode = json ? 'json' : plain ? 'plain' : 'card';

  if (ctx.opts.search === true) return search(ctx, ctx.args.join(' ').replace(/\s+/g, ' ').trim(), mode);
  if (ctx.args.length === 0) return usage(ctx);
  if (ctx.args.length > MAX_SYMBOLS) return ctx.usage(`at most ${MAX_SYMBOLS} tickers at once`);

  const wanted: Wanted[] = [];
  for (const typed of ctx.args) {
    const check = normaliseSymbol(typed);
    // Checked before any request: a word that cannot be a ticker never leaves the page.
    if (check.ok === false) return invalid(ctx, typed);
    if (!wanted.some((seen) => seen.symbol === check.symbol)) wanted.push({ typed, symbol: check.symbol });
  }

  const left = budget(ctx);
  const market = await connect(ctx);
  if (typeof market === 'number') return market;
  const first = wanted[0];
  if (wanted.length === 1 && first !== undefined) return single(ctx, market, first, range, mode, left);
  return many(ctx, market, wanted, range, mode, left);
}

// ── The client ─────────────────────────────────────────────────────────────────────────────

/** The market client, or the status after saying why there is none. */
async function connect(ctx: CommandContext): Promise<Market | ExitCode> {
  const loading = getMarket();
  if (loading === null) return notAvailable(ctx);
  try {
    return await loading;
  } catch {
    if (ctx.signal.aborted) throw ctx.signal.reason;
    await ctx.stderr.line(out.span('stock: could not load the quote service. Check the connection and try again.', ERROR));
    ctx.tty.bell();
    return 1;
  }
}

/** Tells the status line when a lookup is slow, and when it retries. */
function phases(ctx: CommandContext, what: string): (phase: FetchPhase, attempt: number) => void {
  return (phase, attempt) => {
    if (phase === 'slow') ctx.tty.status(`still fetching ${what}…`);
    else if (phase === 'very-slow') ctx.tty.status('taking longer than usual — market data is slow…');
    else ctx.tty.status(`retrying ${what} (${attempt}/2)…`);
  };
}

// ── One ticker ─────────────────────────────────────────────────────────────────────────────

async function single(ctx: CommandContext, market: Market, wanted: Wanted, range: Range, mode: Mode, left: () => number): Promise<ExitCode> {
  const asked = await market.quote(wanted.symbol, range, {
    signal: ctx.signal,
    force: ctx.opts.force === true,
    budgetMs: left(),
    onPhase: phases(ctx, wanted.symbol),
  });
  const outcome = await settled(ctx, market, wanted.symbol, range, asked);
  if (outcome.ok === false) return failure(ctx, outcome.error, wanted, range);

  if (mode === 'json') {
    await ctx.stdout.write(`${JSON.stringify(jsonQuote(outcome), null, 2)}\n`);
    return 0;
  }
  const note = resolvedNote(wanted.typed, outcome.quote);
  if (note !== null) await ctx.stdout.line(out.span(note, MUTED));
  const view = cardView(outcome, range, ctx.clock.now());
  const text = cardText(view, outcome.quote.series);
  if (mode === 'plain') await ctx.stdout.write(text);
  else await ctx.stdout.block(out.component('quote-card', view, text, cardAlt(view)));
  return 0;
}

// ── Several ────────────────────────────────────────────────────────────────────────────────

/** Runs `task` over `items`, at most `limit` at a time, keeping their order. */
async function eachLimited<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await task(items[index] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** A word that may be part of a search typed for the visitor: letters, digits, dots and dashes. */
const SEARCH_WORD = /^[\p{L}\p{N}][\p{L}\p{N}.-]{0,39}$/u;

async function many(ctx: CommandContext, market: Market, wanted: readonly Wanted[], range: Range, mode: Mode, left: () => number): Promise<ExitCode> {
  const what = wanted.map((item) => item.symbol).join(', ');
  const asked = await eachLimited(wanted, CONCURRENCY, (item) =>
    market.quote(item.symbol, range, {
      signal: ctx.signal,
      force: ctx.opts.force === true,
      budgetMs: left(),
      onPhase: phases(ctx, what),
    }),
  );
  // Rows already in hand are drawn even when the budget cut the last lookups off.
  const outcomes = await Promise.all(wanted.map((item, i) => settled(ctx, market, item.symbol, range, asked[i] as QuoteOutcome)));
  const rows = wanted.map((item, i) => ({ symbol: item.symbol, outcome: outcomes[i] as QuoteOutcome }));
  const shown = rows.filter((row) => row.outcome.ok === true).length;

  if (mode === 'json') {
    const list = rows.map(({ symbol, outcome }) => (outcome.ok === true ? jsonQuote(outcome) : { symbol, error: { code: outcome.error.code } }));
    await ctx.stdout.write(`${JSON.stringify(list, null, 2)}\n`);
  } else {
    const view = tableView(rows, ctx.clock.now());
    const text = tableText(view);
    if (mode === 'plain') await ctx.stdout.write(text);
    else await ctx.stdout.block(out.component('quote-table', view, text, tableAlt(view)));
  }

  // Two or more words, none a ticker: likely a company's name typed without -s.
  const allMissing = rows.every((row) => row.outcome.ok === false && row.outcome.error.code === 'not_found');
  const words = wanted.map((item) => item.typed);
  if (allMissing && words.every((word) => SEARCH_WORD.test(word))) {
    const query = `stock -s ${words.join(' ').toLowerCase()}`;
    await ctx.stderr.line(out.span('Looking for a company? Try ', MUTED), out.insert(query, query, { fg: 'link' }));
  }
  if (shown === 0) ctx.tty.bell();
  return shown === 0 ? 1 : 0;
}

// ── Search ─────────────────────────────────────────────────────────────────────────────────

const TYPE_WORDS: Readonly<Record<InstrumentType, string>> = {
  EQUITY: 'stock',
  ETF: 'ETF',
  INDEX: 'index',
  CRYPTOCURRENCY: 'crypto',
  CURRENCY: 'currency',
  MUTUALFUND: 'fund',
  FUTURE: 'future',
  OTHER: 'other',
};

async function search(ctx: CommandContext, query: string, mode: Mode): Promise<ExitCode> {
  if (query === '') return ctx.usage('-s needs a company name, such as: stock -s commonwealth bank');
  if (query.length > 40) return ctx.usage('a search is at most 40 characters');
  const market = await connect(ctx);
  if (typeof market === 'number') return market;
  const outcome = await market.search(query, { signal: ctx.signal });
  if (ctx.signal.aborted) throw ctx.signal.reason;
  if (outcome.ok === false) return searchFailure(ctx, outcome.error);

  if (mode === 'json') {
    await ctx.stdout.write(`${JSON.stringify({ query, hits: outcome.hits }, null, 2)}\n`);
    return outcome.hits.length > 0 ? 0 : 1;
  }
  if (outcome.hits.length === 0) {
    await ctx.stderr.line(out.span(`stock: nothing found for '${query}'`, ERROR));
    await ctx.stderr.line(out.span('Try a shorter name, or the ticker itself.', MUTED));
    ctx.tty.bell();
    return 1;
  }
  if (!ctx.stdout.isTTY || mode === 'plain') {
    for (const hit of outcome.hits) await ctx.stdout.write(`${hitText(hit)}\n`);
    return 0;
  }
  const chips = new Map(hitChips(outcome.hits).map((chip) => [chip.label, chip]));
  const rows = outcome.hits.map((hit): Line[] => {
    const chip = chips.get(hit.symbol);
    const symbol = chip === undefined ? out.span(hit.symbol, { fg: 'accent', bold: true }) : { ...out.span(hit.symbol, { fg: 'accent', bold: true }), action: chip.action };
    return [[symbol], [out.span(hit.name ?? '—')], [out.span(hit.exchange ?? '—', MUTED)], [out.span(TYPE_WORDS[hit.type], MUTED)]];
  });
  await ctx.stdout.block(out.table(rows, { head: [[out.span('SYMBOL')], [out.span('NAME')], [out.span('EXCHANGE')], [out.span('TYPE')]], stackBelowCols: 50 }));
  if (outcome.from === 'local') await ctx.stdout.line(out.span("From vesen's short list of well-known names.", MUTED));
  return 0;
}

function hitText(hit: SearchHit): string {
  return [hit.symbol, hit.name ?? '—', hit.exchange ?? '—', TYPE_WORDS[hit.type]].join('\t');
}

async function searchFailure(ctx: CommandContext, error: MarketFailure): Promise<ExitCode> {
  if (error.code === 'cancelled') throw ctx.signal.reason;
  if (error.code === 'origin_not_allowed' || error.code === 'not_configured') return notAvailable(ctx);
  const message = error.code === 'offline' ? "stock: you're offline, so search is unavailable." : 'stock: search is unavailable right now. Try again in a minute.';
  await ctx.stderr.line(out.span(message, ERROR));
  ctx.tty.bell();
  return 1;
}

// ── Usage and failures ─────────────────────────────────────────────────────────────────────

/** Bare `stock`: how to use it, and tickers to tap. No request is made. */
async function usage(ctx: CommandContext): Promise<ExitCode> {
  // On a narrow phone the one line would wrap inside an option ('[-' then 'f]').
  if (ctx.stdout.isTTY && ctx.stdout.columns < USAGE.length) for (const text of USAGE_NARROW) await ctx.stdout.line(out.span(text));
  else await ctx.stdout.line(out.span(USAGE));
  await ctx.stdout.line(out.span('Delayed quotes for up to 6 tickers, or find one by name with -s.', MUTED));
  let recent: readonly string[] = [];
  const loading = getMarket();
  if (loading !== null) {
    try {
      recent = (await loading).recent().slice(0, 3);
    } catch {
      // No recent tickers without the client; the examples still show.
    }
  }
  if (!ctx.stdout.isTTY) {
    await ctx.stdout.write(`Try: ${EXAMPLE_SYMBOLS.map((symbol) => `stock ${symbol}`).join(', ')}\n`);
    return 0;
  }
  await ctx.stdout.block(out.chips(chipItems(symbolChips(EXAMPLE_SYMBOLS)), 'Try:'));
  const recentChips = symbolChips(recent);
  if (recentChips.length > 0) await ctx.stdout.block(out.chips(chipItems(recentChips), 'Recent:'));
  return 0;
}

async function invalid(ctx: CommandContext, typed: string): Promise<ExitCode> {
  await ctx.stderr.line(out.span(`stock: '${typed}' isn't a valid ticker`, ERROR));
  await ctx.stderr.line(out.span('Tickers look like AAPL, CBA.AX, ^AXJO, BTC-USD or AUDUSD=X.', MUTED));
  ctx.tty.bell();
  return 1;
}

async function notAvailable(ctx: CommandContext): Promise<ExitCode> {
  await ctx.stderr.line(out.span("stock: live quotes aren't available on this host.", ERROR));
  await ctx.stderr.line(out.span("vesen's quote proxy only serves vesen.app — set VITE_STOCK_API to your own (README → Stock quotes).", MUTED));
  ctx.tty.bell();
  return 1;
}

/** [↻ try again], which asks afresh. */
async function tryAgain(ctx: CommandContext, symbol: string, range: Range): Promise<void> {
  const line = stockLine(symbol, { range, force: true });
  if (line !== null) await ctx.stdout.block(out.chips([{ label: '↻ try again', action: out.action.run(line) }]));
}

async function failure(ctx: CommandContext, error: MarketFailure, wanted: Wanted, range: Range): Promise<ExitCode> {
  const say = (text: string, style: SpanStyle = ERROR): Promise<void> => ctx.stderr.line(out.span(text, style));
  switch (error.code) {
    case 'cancelled':
      throw ctx.signal.reason;
    case 'invalid_symbol':
    case 'bad_request':
      return invalid(ctx, wanted.typed);
    case 'not_found': {
      await say(`stock: no market data for '${wanted.typed}'`);
      const chips = symbolChips((error.suggestions ?? []).map((hit) => hit.symbol));
      if (chips.length > 0) {
        if (ctx.stdout.isTTY) await ctx.stdout.block(out.chips(chipItems(chips), 'Did you mean:'));
        else await say(`Did you mean: ${chips.map((chip) => chip.label).join(', ')}`, MUTED);
      } else {
        await say('Try a company name, e.g. stock -s atlassian', MUTED);
      }
      ctx.tty.bell();
      return 1;
    }
    case 'rate_limited':
      await say(`stock: too many requests — try again in ${error.retryAfter === undefined ? 'a minute' : `${Math.max(1, Math.round(error.retryAfter))} s`}.`);
      ctx.tty.bell();
      return 1;
    case 'origin_not_allowed':
    case 'not_configured':
      return notAvailable(ctx);
    case 'offline':
      await say(`stock: you're offline and there's no saved quote for ${wanted.symbol}.`);
      ctx.tty.bell();
      return 1;
    case 'timeout':
      await say('stock: no response after 10 s — your connection or the quote service is slow.');
      await tryAgain(ctx, wanted.symbol, range);
      ctx.tty.bell();
      return 1;
    default:
      // The service's side, not the visitor's: said calmly, with no bell.
      await say("stock: market data is unavailable right now. This is on vesen's side, not yours. Try again in a minute.", WARN);
      await tryAgain(ctx, wanted.symbol, range);
      return 1;
  }
}
