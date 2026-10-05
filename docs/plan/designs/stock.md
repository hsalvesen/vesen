# Reliable stock quotes: reference design

> **How to read this file.** This is the full design that a three-way design panel produced and a judge synthesised for this workstream. It is the detailed reference: interfaces, file plan, steps and tests. Where it conflicts with the shared decisions in [../02-architecture-and-contracts.md](../02-architecture-and-contracts.md) or with the sequencing in [../07-stock-and-proxy.md](../07-stock-and-proxy.md), **those documents win**. Line numbers refer to `main` at commit 23758b9 (5 October 2026).

**Chosen approach:** Ticker Tape, staged: an owned, portable edge quote proxy (Yahoo primary, Cboe US fallback, optional keyed tier) plus a lazy-loaded phone-first stock card with tap actions and honest freshness

## How it was chosen

- **Strangler swap: thin Cloudflare Worker quote proxy, keeping today's allorigins path as a last-resort fallback** scored 6.6. Strengths:
- Feasibility and risk are the best of the three. Each step ships on its own.
- One shared normaliser.
- Uses the correct crypto change basis: Yahoo's 24-hour change percent, labelled '24h'.
- Does not rewrite BRK.B. I confirmed BRK.B returns 404 and BRK-B returns 200, so search handles it.
- Tests live outside src/, so the svelte-check baseline does not move.
- Cheapest at about 3.5 days.

The premise it relies on is partly wrong. It says Yahoo returned 429 'with or without a browser User-Agent'. I re-probed today: User-Agent 'Mozilla/5.0' gets 200 on both query1 and query2 (about 0.4 s, 7.8 KB). A full Chrome UA string and curl's default UA get 429. So its fallback ordering is built on a misreading.

Weaker on UX:
- It keeps api.allorigins.win as a third tier. That adds up to 8 s to the failure path before the saved copy shows, and contradicts F038.
- It keeps shouldUseStackedLayout(600), which freezes layout from window width at run time (F016).
- No tappable cancel (F047), no tap chips, no lookup by company name.
- Nasdaq as the fallback took 2.3–3.3 s in my probe against a 3.5 s provider timeout, which leaves little margin.

- **Owned edge proxy plus a typed market feature module (ports and adapters)** scored 7.4. Strengths:
- The best maintainability. The handler is platform-agnostic and index.ts is the only Cloudflare file, so it could move to Firebase or Cloud Run.
- An in-process contract test runs the Worker handler and the client decoder against each other.
- Shared lib code: escape, linkSignals, renderNotice.
- isInterruptible replaces the three hard-coded lists (commands.ts:343, Input.svelte:207, Input.svelte:295).
- Guards the history.ts localStorage writes.
- One fluid layout with no JavaScript width maths.
- Honours Retry-After only up to 3 s.
- Good UX: cancel chip, did-you-mean chips, aliases, multiple tickers.

Weaknesses:
- A correctness gap. It takes the session window and sparkline x-axis from currentTradingPeriod. I checked CBA.AX today: currentTradingPeriod.regular is already the next session (10-05 23:00 to 10-06 05:12 UTC) while the bars span 10-04 23:00 to 10-05 05:10. Outside trading hours every bar would fall before the window.
- About 7.5 days of effort.
- Its ceremony (branded types, Result types, a decorator stack) is heavy for a codebase of about 5,100 lines.
- Its fallback is Twelve Data, which needs the owner to register a key.

- **"Ticker Tape": an owned edge quote proxy (Cloudflare Worker, Yahoo primary with Cboe fallback) plus a phone-first stock card with tap actions, honest stale/error states and tickers found by company name** scored 8.2. It has the highest UX impact for the owner's real audience, Instagram visitors on phones:
- Tap chips run real commands without focusing the input, so the keyboard stays down.
- A cancel chip on the status line.
- 'opens in 2h 5m' timing.
- Range chips.
- Lookup by company name. I confirmed CBA and APPLE both return 404 from the chart endpoint, and search ranks AAPL first for 'apple' and CBA.AX first for 'commonwealth bank'.

Its provider claims all held up when I re-checked:
- the User-Agent sensitivity;
- the CBA.AX trading-period roll-over, which it handles by taking the chart window from tradingPeriods;
- Cboe returns 200 for AAPL in 0.8 s with no CORS header, and 403 for CBA.

Other strengths:
- Phase-aware cache lifetimes and serve-stale-while-revalidate.
- LTTB downsampling.
- A not_configured path for self-hosted copies.
- A CommandSpec interface that matches the planned command registry.
- About 6 days.

Weaknesses:
- A batch endpoint that does not need to exist.
- The not_configured state is detected by a heuristic rather than reported by the Worker.
- The tap path and the scroll anchor depend on other workstreams.
- Cutover is one big step instead of small staged PRs.


Ideas grafted from the other candidates:

- From D1:
- Staged, independently shippable PRs, with the provider spike as a hard go/no-go gate before any repo change.
- Crypto change uses meta.regularMarketChangePercent, labelled '24h' (changeBasis field), with an explicit test.
- No BRK.B to BRK-B rewrite; search-resolve handles it (verified BRK.B 404, BRK-B 200).
- Help text keeps the 'Usage:', 'Examples:' and 'Tip:' labels that getCommandHelp parses (commands.ts:378-380).
- Unit tests live in a root tests/ folder, so the svelte-check baseline stays at the 2 known theme.ts errors.
- A per-provider UPSTREAM limiter protects Yahoo from bursts.
- try/catch around every Intl call, for old WKWebViews.
- A .dockerignore keeps worker/ and node_modules out of the Docker build context.
- Workers logging never records IPs.
- From D1, as a fallback only: Nasdaq info stays as a spike-gated alternative US fallback if Cboe is blocked from Cloudflare egress.
- From D2:
- Platform-agnostic handle(req, deps), with index.ts the only Cloudflare-specific file. This is the escape hatch to a Firebase Function or Cloud Run if Yahoo blocks Cloudflare egress.
- An in-process contract test: the Worker's handle() output is decoded by the client's proxySource.
- Retry-After is honoured only when it is 3 s or less.
- src/utils/commandMeta.ts isInterruptible() replaces the three hard-coded lists.
- renderNotice() de-duplicates the cancel block copied at network.ts:205, network.ts:440 and Input.svelte:124.
- safeStorage guards history.ts:6-7 and :22-28.
- One fluid card layout with no window.innerWidth arithmetic.
- Multi-ticker fans out from the client and reuses per-symbol cache keys, instead of D3's /v1/quotes batch endpoint.
- Both Firebase workflows run npm test.
- A small alias table (sp500, asx200, nasdaq, dow, ftse, nikkei, btc, eth).
- The upstream User-Agent is a wrangler var.
- A /v1/health?deep=1 daily canary.
- Judge additions:
- A 403 origin_not_allowed response still echoes Access-Control-Allow-Origin, so a self-hosted copy can read the error and show the exact 'deploy your own proxy' message. D3's guess from the hostname becomes the fallback only.
- Tap actions use an allowlist: History only runs data-cmd values whose command is marked tapSafe and whose argument passes SYMBOL_RE. An injected button therefore cannot trigger reset or email.
- A generic src/lib/memo.ts (TTL, in-flight de-duplication, failure cool-down) per F065, reusable by weather.
- The stock module is lazy-loaded with a dynamic import, keeping it out of the 142.85 kB initial bundle for first paint inside Instagram.
- The Escape key and the elapsed seconds in the spinner (per F047) apply to every interruptible command.
- Each SVG gradient gets a unique id, so several cards in history do not collide.
- 'Open' is documented as the first-bar open. It differs slightly from the official open: AAPL today showed 332.795 from Yahoo's first bar against Cboe's official 332.96.

## Summary

A free Cloudflare Worker (vesen-stock) replaces the stock command's public CORS proxy. CORS ('cross-origin resource sharing') is the browser rule that blocks one site from reading another's data unless that site allows it, which is why Yahoo cannot be called from the page directly. The Worker:
- calls only fixed upstream URLs;
- validates every symbol;
- caches for 60 s while a market is open and 300 s while it is closed, merges concurrent requests for the same symbol into one upstream call, and serves stale data for up to 24 h when every source fails;
- rate-limits each IP and each upstream;
- answers browser requests only from vesen.app, its Firebase channels and localhost.

Its sources:
- Yahoo v8 chart, with User-Agent 'Mozilla/5.0 (compatible; vesen-stock/1.0; +https://www.vesen.app)'. Re-verified today: 200 on query1 and query2 in about 0.4 s; a full Chrome UA or curl's UA gets 429; no CORS header.
- Cboe delayed quotes as the fallback for US symbols (verified 200 in 0.8 s for AAPL, 403 for CBA).
- Yahoo search, to resolve company names ('stock apple' gives AAPL, 'stock cba' gives CBA.AX) and to offer 'did you mean'.
- Optionally a keyed provider (Finnhub or Twelve Data) whose key lives only as a Worker secret.

The handler is platform-agnostic, so if the spike shows Yahoo blocks Cloudflare, the same code moves to a Firebase Function or Cloud Run behind a small adapter.

On the client, the old 228-line command (network.ts:222-449) is deleted. A lazy-loaded src/commands/stock module replaces it, made of four layers:
- a resilient client: 8 s per attempt, at most one retry and only after a fast failure, a 10 s total budget, a 30 s in-memory cache with de-duplication, an offline check, and a last-good copy in localStorage, all storage guarded;
- pure, escaped HTML renderers: one fluid card with an SVG session sparkline, Day and 52-week bars built from CSS, a market phase line ('Pre-market · opens in 1h 39m'), currency-correct prices, and an honest footer showing source and age;
- tap chips (refresh, 1d, 5d, 1mo, 1y, did-you-mean, examples) that run real commands without opening the phone keyboard;
- a status line with phase text, elapsed seconds and a tappable cancel, plus Escape.

The work ships in five PRs, each deployable on its own, after a half-day spike that gates the provider choice.

It resolves F035, F036 and F037 fully, and resolves for stock the parts of F005, F016, F038, F047 and F065 that concern it. It adds no new scroll path, which is what F010 asks for.

## Architecture

0. CONSTRAINTS THAT SHAPE THE DESIGN (all verified)
- **Hosting.** firebase.json:9-14 rewrites every path to /index.html, so there is no same-origin API without Firebase Functions, which need the Blaze billing plan.
- **Domain.** vesen.app DNS is on Google Cloud DNS, so the Worker runs at vesen-stock.<acct>.workers.dev and the call is cross-origin.
- **Yahoo from a browser** gets 429 and sends no CORS header.
- **Yahoo from a server** works only with a short UA: 'Mozilla/5.0…' gets 200, a full Chrome UA string gets 429.
- **No open price in Yahoo's meta.** It has no regularMarketOpen; the meta keys checked on VOD.L include currency 'GBp', tradingPeriods, currentTradingPeriod, regularMarketChangePercent and fulldayChange.
- **currentTradingPeriod rolls forward.** After the close it already describes the next session. CBA.AX today: currentTradingPeriod.regular is 10-05 23:00 to 10-06 05:12 UTC while the bars run 10-04 23:00 to 10-05 05:10. So the chart window must come from tradingPeriods, and the phase and next open from currentTradingPeriod.
- **Output pipeline.** Command output is an HTML string rendered with {@html} inside a whitespace-pre div (History.svelte:19-20). On screens ≤768 px it is also wrapped in a pre-wrap div whose width is frozen in px at run time (textWrap.ts:29-37, 135-146). So the card root must set white-space:normal and contain no newlines between tags.

1. EDGE: worker/stock (separate npm package, not a root workspace; deployed with wrangler)
- **src/index.ts** is the only Cloudflare-specific file. It builds HandlerDeps from env (rate-limit bindings, vars, the optional secret) and ctx.waitUntil.
- **src/handler.ts** runs this pipeline in order:
  1. Method guard: GET and OPTIONS only; OPTIONS returns 204.
  2. Origin policy:
     - allowed exact origins: www.vesen.app, vesen.app, vesenterminal.web.app, vesenterminal.firebaseapp.com;
     - allowed patterns: ^https://vesenterminal--[a-z0-9-]+\.web\.app$ and ^http://(localhost|127\.0\.0\.1)(:\d+)?$;
     - no Origin header: allowed, with a 10/min limit;
     - a disallowed origin gets 403 origin_not_allowed, with ACAO still echoing that origin so the page can read the reason. No upstream call is made.
  3. Route: /v1/quote, /v1/search or /v1/health; anything else is 404 bad_request.
  4. Validate with shared normaliseSymbol and SYMBOL_RE, the range against RANGE_SPEC, and q as 1–40 characters.
  5. Per-IP rate limit, keyed on CF-Connecting-IP: quote 30/60 s, search 20/60 s. Over the limit: 429 with Retry-After.
  6. Cache. L1 is an in-isolate LRU of 500 entries. L2 is caches.default, best-effort, because it has no effect on workers.dev. Keys look like q1:AAPL:1d.
     - fresh: hit;
     - within the stale-while-revalidate window: answer from cache and refresh through waitUntil;
     - negative entry (not_found within 10 min): 404;
     - a request for the same key already in flight: join it.
  7. Provider chain. One 6.5 s deadline overall; each attempt gets min(its own timeout, time remaining).
     - Yahoo query1 (3.0 s), then query2 (2.5 s). After a Yahoo 429, a 60 s isolate cooldown skips Yahoo.
     - Cboe, only when isUsListed(symbol) and range = 1d (2.5 s). Sets delayed:true.
     - Optional FINNHUB_KEY tier for US symbols.
     - Yahoo not_found is authoritative and stops the chain.
     - An UPSTREAM limiter (100/60 s per provider per location) skips a provider when tripped.
  8. Not-found resolution:
     - Check the alias table first.
     - Otherwise run Yahoo search, filtered to EQUITY, ETF, INDEX, CRYPTOCURRENCY and CURRENCY.
     - Resolve when either the base symbol equals the query (CBA gives CBA.AX), or the top score is at least twice the runner-up and the name contains the query (apple: 213982 vs 30085).
     - On a match, fetch that quote and return it with resolvedFrom. Otherwise 404 not_found with up to 5 suggestions.
     - Resolutions are cached for 24 h.
  9. Normalise to Quote:
     - open = first non-null bar open, with openApprox:true;
     - prevClose = previousClose, falling back to chartPreviousClose;
     - crypto uses changeBasis '24h' from regularMarketChangePercent;
     - currency is passed through verbatim (GBp, ZAc, ILA);
     - volume 0 becomes null;
     - chart.window comes from tradingPeriods for 1d, otherwise from the first to last bar;
     - LTTB downsampling to ≤160 points stored as [dt, close], rounded to priceHint+2.
  10. Cache lifetime by phase:
     - open: fresh 60 s plus 60 s stale-while-revalidate;
     - pre, post or closed: 300 s;
     - crypto and FX: 60 s;
     - search: 24 h;
     - not_found: 10 min;
     - stale-if-error: 24 h.
  11. If every provider fails: 200 with cache:'stale' when a stale entry exists, otherwise 503 upstream_unavailable with Retry-After: 30.
- **Response headers:** Content-Type application/json; ACAO with the echoed origin; Vary: Origin; Access-Control-Expose-Headers: Retry-After, X-Vesen-Cache, X-Vesen-Source; Cache-Control public, max-age=15; X-Vesen-Cache hit|miss|revalidating|stale; X-Vesen-Source; Server-Timing.
- **Not an open relay:** the upstream hosts are a fixed set and every symbol is encodeURIComponent'd after validation.
- **Logging:** Workers observability on with sampling 0.1; never log IPs.

2. SHARED: shared/stock (pure TS, no DOM, no import.meta.env)
- contract.ts: wire types, hand-written guards, SYMBOL_RE, RANGE_SPEC.
- symbols.ts: normaliseSymbol (trim, strip '$', uppercase, exchange prefix map such as ASX:CBA → CBA.AX, aliases), CURATED, isUsListed.
- marketPhase.ts: phaseAt(), which the client recomputes at render time so a stale copy never claims 'Open'.
Both sides import these, and root tsconfig include gains shared/**/*.ts.

3. CLIENT: src/commands/stock (lazy-loaded with import(), so it is not in the initial bundle)
- **data/client.ts**: createStockClient. Validates locally first, so an invalid symbol makes no request. Then:
  - offline check;
  - memo (30 s, in-flight de-duplication, 5 s failure cooldown);
  - fetchWithTimeout(8 s), linked to the user's AbortSignal through linkSignals (no AbortSignal.any or AbortSignal.timeout, which older WKWebViews lack);
  - exactly one retry, only after a fast failure (TypeError, 5xx, or a non-JSON body such as Cloudflare error 1027 within 3 s), after a 400–800 ms jittered wait, and only if at least 3 s of the 10 s budget remains;
  - never retry other 4xx; on 429, retry once only if Retry-After ≤3 s and the budget allows;
  - validate the envelope with the shared guards;
  - on success, save the last-good copy;
  - on failure, return the last-good copy (≤7 days old) as stale-local, otherwise a typed ClientError.
- **data/lastGood.ts**: an LRU of 12 under key 'vesen.stock.v1', 1d range only, series trimmed to 48 points, built on safeStorage. Also keeps a recents list of 8.
- **view/**:
  - format.ts: fixed en-US grouping; priceHint decimals; ISO currency shown as a suffix code ('332.89 USD'); minor units as GBp → '127.20p', ZAc → 'c', ILA → 'ag'; U+2212 minus plus ▲/▼; compact volume with a fallback; exchange clock using meta tz abbreviation; relative age; time until open.
  - sparkline.ts: SVG with viewBox 300×60 and non-scaling-stroke; colours via style or class, never var() in presentation attributes; a hard-stop gradient at the previous close with a unique id; a dashed baseline; role=img with an aria-label.
  - card.ts, table.ts, states.ts.
  - stock.css: .stk-* classes on var(--theme-*), white-space:normal on the root, chips at least 44 px on (pointer: coarse), no color-mix, prefers-reduced-motion respected.
- **args.ts**, **man.ts** and **complete.ts** (local completions only, for the suggestion row and the future completion registry).
- **index.ts** exports stock(argv, abortController) with the legacy signature and stockSpec (CommandSpec) for the registry. It drives commandStatus phases, playBeep on failures (not on cancel or stale) and the lazy CSS import.

4. SHARED CLIENT SEAMS (small, reusable by weather, curl and qr)
- src/lib/html.ts: escapeHtml, escapeAttr, h``. Replaces the DOM-based copies at network.ts:127 and :454.
- src/lib/net.ts: linkSignals, fetchWithTimeout, TimeoutError.
- src/lib/memo.ts.
- src/lib/storage.ts: safeStorage.
- src/lib/notice.ts: renderNotice. Replaces network.ts:205, network.ts:440 and Input.svelte:124.
- src/stores/commandStatus.ts: {label, startedAt, cancellable}, setCanceller/cancelCurrentCommand, and a runRequest store for tap actions.
- src/utils/commandMeta.ts: isInterruptible and isTapSafe.
- Input.svelte:
  - shows $commandStatus.label plus elapsed seconds after 2.5 s (lines 624-627);
  - Escape cancels;
  - the execute path is extracted from the Enter handler (about lines 286-357) so runRequest can call it;
  - the window onclick (lines 645-651) skips focus when the target is inside .term-action.
- App.svelte:87-91: the status row gets role=status, aria-live=polite and a [cancel] chip.
- History.svelte: one delegated click handler for button.term-action[data-cmd]. It validates the command against the tapSafe allowlist and the argument against SYMBOL_RE or RANGE_SPEC, then sets runRequest.

REQUEST FLOW
'stock cba' → normaliseSymbol → CBA → memo miss → GET {STOCK_API}/v1/quote?symbol=CBA&range=1d. This is a simple GET with no custom headers, so there is no preflight. The Worker gets a Yahoo 404, searches, resolves to CBA.AX, fetches and normalises the quote, and caches 300 s while the market is closed. The client receives a QuoteEnvelope with resolvedFrom 'CBA', saves the last-good copy, and calls renderResolvedNote plus renderQuoteCard. The HTML string goes into the existing {@html} pipeline.

## Key interfaces

```ts
// ===== shared/stock/contract.ts =====
export const STOCK_API_VERSION = 1 as const;
export const SYMBOL_RE = /^\^?[A-Z0-9][A-Z0-9.\-=]{0,14}$/;
export type Range = '1d' | '5d' | '1mo' | '6mo' | '1y' | '5y';
export const RANGE_SPEC: Record<Range, { interval: '5m' | '15m' | '60m' | '1d' | '1wk' }>; // 1d:5m 5d:15m 1mo:60m 6mo:1d 1y:1d 5y:1wk
export type InstrumentType = 'EQUITY' | 'ETF' | 'INDEX' | 'CRYPTOCURRENCY' | 'CURRENCY' | 'MUTUALFUND' | 'FUTURE' | 'OTHER';
export type ProviderId = 'yahoo' | 'cboe' | 'finnhub';
export type MarketPhase = 'pre' | 'open' | 'post' | 'closed' | 'always_open' | 'unknown';
export interface MarketPeriods { pre: [number, number] | null; regular: [number, number]; post: [number, number] | null } // from currentTradingPeriod
export interface ChartSeries {
  range: Range; interval: string;
  window: { start: number; end: number };  // 1d: meta.tradingPeriods (NOT currentTradingPeriod); else first..last bar
  t0: number; points: Array<[dt: number, close: number]>;  // <=160, LTTB
  baseline: number | null;                  // prevClose for 1d, first close otherwise
}
export interface Quote {
  symbol: string; name: string; type: InstrumentType; exchange: string;
  currency: string;            // verbatim: 'USD' | 'AUD' | 'GBp' | 'ZAc' | 'ILA' ...
  priceHint: number; price: number; prevClose: number | null;
  change: number | null; changePct: number | null; changeBasis: 'prev_close' | '24h';
  open: number | null; openApprox: boolean;  // first regular-session bar open
  dayLow: number | null; dayHigh: number | null; low52: number | null; high52: number | null;
  volume: number | null; asOf: number;
  market: { tz: string; tzAbbr: string; periods: MarketPeriods | null };
  chart: ChartSeries | null; delayed: boolean; source: ProviderId;
}
export interface SearchHit { symbol: string; name: string; exchange: string; type: InstrumentType }
export type StockErrorCode = 'invalid_symbol' | 'bad_request' | 'not_found' | 'rate_limited' | 'origin_not_allowed' | 'upstream_unavailable' | 'internal';
export interface ApiError { code: StockErrorCode; message: string; retryAfter?: number; suggestions?: SearchHit[] }
export interface QuoteEnvelope { v: 1; quote: Quote; resolvedFrom?: string; cache: 'hit' | 'miss' | 'revalidating' | 'stale'; fetchedAt: number; stale?: { reason: StockErrorCode; since: number } }
export interface SearchEnvelope { v: 1; query: string; hits: SearchHit[] }
export interface ErrorEnvelope { v: 1; error: ApiError }
export function isQuoteEnvelope(x: unknown): x is QuoteEnvelope;
export function isSearchEnvelope(x: unknown): x is SearchEnvelope;
export function isErrorEnvelope(x: unknown): x is ErrorEnvelope;

// ===== shared/stock/symbols.ts & marketPhase.ts =====
export type SymbolCheck = { ok: true; symbol: string; note?: 'alias' | 'prefix-mapped' | 'dollar-stripped' } | { ok: false; reason: 'empty' | 'chars' | 'length' };
export function normaliseSymbol(raw: string): SymbolCheck;
export const ALIASES: Readonly<Record<string, { symbol: string; label: string }>>;
export const CURATED: readonly string[];
export function isUsListed(symbol: string): boolean;
export interface PhaseInfo { phase: MarketPhase; nextOpen: number | null; closesAt: number | null }
export function phaseAt(q: Pick<Quote, 'type' | 'market'>, nowSec: number): PhaseInfo;

// ===== worker/stock/src (platform-agnostic core) =====
export type ProviderResult = { ok: true; quote: Omit<Quote, 'source'> } | { ok: false; kind: 'not_found' | 'rate_limited' | 'unavailable'; detail: string };
export interface QuoteProvider { id: ProviderId; supports(symbol: string, range: Range): boolean; quote(symbol: string, range: Range, signal: AbortSignal): Promise<ProviderResult> }
export interface RateLimiter { limit(key: string): Promise<{ success: boolean; retryAfterSec: number }> }
export interface OriginPolicy { classify(origin: string | null): 'allowed' | 'anonymous' | 'denied' }
export interface TieredCache {
  get<T>(key: string): Promise<{ value: T; storedAt: number; freshUntil: number; swrUntil: number; staleUntil: number } | null>;
  put<T>(key: string, value: T, ttl: { freshSec: number; swrSec: number; staleSec: number }): Promise<void>;
  coalesce<T>(key: string, load: () => Promise<T>): Promise<T>;
}
export interface HandlerDeps {
  providers: readonly QuoteProvider[]; search(q: string, limit: number, signal: AbortSignal): Promise<SearchHit[] | null>;
  cache: TieredCache; limiters: { quote: RateLimiter; search: RateLimiter; anon: RateLimiter; upstream: RateLimiter };
  origins: OriginPolicy; now(): number; waitUntil(p: Promise<unknown>): void; budgetMs: 6500;
}
export function handle(req: Request, deps: HandlerDeps): Promise<Response>;

// ===== src/lib =====
export function escapeHtml(s: string): string; export function escapeAttr(s: string): string;
export function h(strings: TemplateStringsArray, ...vals: unknown[]): string; // escapes interpolations unless wrapped by raw()
export function linkSignals(...s: Array<AbortSignal | undefined>): { signal: AbortSignal; dispose(): void };
export class TimeoutError extends Error { readonly afterMs: number }
export function fetchWithTimeout(url: string, init: RequestInit & { timeoutMs: number; fetchImpl?: typeof fetch }): Promise<Response>;
export function createMemo<T>(o: { ttlMs: number; failureCooldownMs: number; now?: () => number }): { get(key: string, fn: () => Promise<T>, opts?: { bypass?: boolean }): Promise<T>; clear(): void };
export interface SafeStorage { get(k: string): string | null; set(k: string, v: string): boolean; remove(k: string): void }
export const safeStorage: SafeStorage;
export function renderNotice(tone: 'cancelled' | 'warning' | 'error' | 'info', html: string): string;

// ===== src/stores/commandStatus.ts & src/utils/commandMeta.ts =====
export const commandStatus: Writable<{ label: string; startedAt: number; cancellable: boolean } | null>;
export function setCanceller(fn: (() => void) | null): void;
export function cancelCurrentCommand(): void;
export const runRequest: Writable<{ cmd: string; source: 'tap' } | null>;
export function isInterruptible(name: string): boolean;
export function isTapSafe(name: string): boolean;

// ===== src/commands/stock/data/client.ts =====
export type FetchPhase = 'request' | 'slow' | 'very-slow' | 'retry';
export type ClientErrorCode = StockErrorCode | 'timeout' | 'offline' | 'network' | 'not_configured' | 'cancelled';
export interface ClientError { code: ClientErrorCode; message: string; retryAfter?: number; suggestions?: SearchHit[] }
export type QuoteResult =
  | { ok: true; data: QuoteEnvelope; freshness: 'live' | 'memory' | 'stale-server' }
  | { ok: true; data: QuoteEnvelope; freshness: 'stale-local'; savedAt: number; reason: ClientErrorCode }
  | { ok: false; error: ClientError };
export interface StockClientOptions {
  baseUrl: string; attemptTimeoutMs?: 8000; retryTimeoutMs?: 4000; totalBudgetMs?: 10000; memoryTtlMs?: 30000;
  fastFailureMs?: 3000; maxRetryAfterMs?: 3000; slowAfterMs?: 2500; verySlowAfterMs?: 6000;
  storage?: SafeStorage; fetchImpl?: typeof fetch; now?: () => number; isOnline?: () => boolean; random?: () => number; hostname?: string;
}
export interface StockClient {
  quote(symbol: string, range: Range, o?: { signal?: AbortSignal; onPhase?: (p: FetchPhase, i: { attempt: number; elapsedMs: number }) => void; bypassMemory?: boolean }): Promise<QuoteResult>; // never throws
  search(q: string, o?: { signal?: AbortSignal; limit?: number }): Promise<SearchHit[]>; // never throws; [] on failure
  recent(): string[];
}
export function createStockClient(o: StockClientOptions): StockClient;

// ===== src/commands/stock =====
export type StockMode = 'usage' | 'card' | 'table' | 'search' | 'json' | 'plain';
export interface StockArgs { mode: StockMode; symbols: string[]; range: Range; query?: string; fresh: boolean }
export function parseStockArgs(argv: string[]): { ok: true; args: StockArgs } | { ok: false; message: string };
export function stock(argv: string[], abortController?: AbortController): Promise<string>; // legacy signature used by commands.ts
export interface CommandSpec { name: 'stock'; summary: string; interruptible: true; tapSafe: true; complete(tokens: string[]): string[]; run(argv: string[], ctx: { signal: AbortSignal; setStatus(s: { label: string; cancellable: boolean } | null): void; now(): number }): Promise<{ html: string; text: string; status: 0 | 1 | 2 }> }
export const stockSpec: CommandSpec;

// ===== src/commands/stock/view (pure) =====
export function renderQuoteCard(env: QuoteEnvelope, o: { nowSec: number; local?: { savedAt: number; reason: ClientErrorCode }; idSeed: string }): string;
export function sparklineSvg(c: ChartSeries, o: { id: string; label: string; tone: 'up' | 'down' | 'flat' }): string;
export function renderQuoteTable(rows: Array<{ symbol: string; result: QuoteResult }>, o: { nowSec: number }): string;
export function renderUsage(recent: string[]): string;
export function renderInvalid(input: string): string;
export function renderNotFound(input: string, suggestions: SearchHit[]): string;
export function renderResolvedNote(from: string, to: string, exchange: string): string;
export function renderStockError(e: ClientError, symbol?: string): string;
export function renderStockText(env: QuoteEnvelope, cols: number): string; // --plain
export function formatPrice(v: number, currency: string, priceHint: number): string; // '332.89 USD', '127.20p', '2,893.50 JPY'
// Tap contract: <button type="button" class="term-action" data-cmd="stock -r 5d AAPL" aria-label="Show AAPL over 5 days">5d</button>
// data-cmd built only from SYMBOL_RE-valid symbols + RANGE_SPEC keys + fixed flags, then escapeAttr'd; History re-validates with isTapSafe.
```

## What the visitor sees

COMMAND SURFACE
- `stock`: usage plus tap chips [AAPL] [TEAM] [CBA.AX] [^AXJO] [BTC-USD] and up to 3 recent tickers. No network call.
- `stock AAPL`, `stock aapl`, `stock $aapl`, `stock ASX:CBA`: one card.
- Aliases and names resolve with a note:
  - `stock sp500` prints "showing ^GSPC (S&P 500)".
  - `stock cba` prints "'cba' isn't a ticker on its own — showing CBA.AX (ASX)".
  - `stock apple` prints the same kind of note for AAPL.
- `stock AAPL CBA.AX BTC-USD` (up to 6): a table of SYMBOL, LAST and CHG%. Wide screens add CHG and a 64 px mini sparkline. Each symbol is a chip. A failed row shows '— not found' or '— unavailable' inline.
  - If 2 or more words all fail, a hint chip appears: [stock -s commonwealth bank].
- `stock -s commonwealth bank`: up to 6 search rows (symbol, name, exchange, type), each one a chip.
- `stock -r 5d AAPL` (1d, 5d, 1mo, 6mo, 1y, 5y) changes the chart range.
- `stock -f AAPL` skips the 30 s local cache.
- `stock --plain AAPL`: a text card for copying and future pipes.
- `stock --json AAPL`: the escaped envelope.
- `stock -h`, `stock --help` and `man stock`: help. -h is intercepted by the dispatcher at commands.ts:336.

LOADING (status row below the prompt, aria-live=polite)
- '⠹ stock: fetching CBA.AX…'.
- After 2.5 s: '⠼ stock: still fetching CBA.AX… 3s'.
- After 6 s: '⠦ taking longer than usual — market data is slow… 6s'.
- During the retry: '⠧ retrying CBA.AX (2/2)…'.
- Phones show a [cancel] chip of at least 44 px. Desktop shows '^C/Esc to cancel'.
- Cancelling prints the shared cancelled notice ('^C stock: cancelled') with no beep.
- Hard ceiling 10 s; typical about 0.5 s.
- Under prefers-reduced-motion the spinner is a static '…'.

CARD (one fluid layout: no JavaScript width maths, max 62ch, no horizontal scroll at 320–430 px)
- Line 1: CBA.AX in bright cyan bold, then 'Commonwealth Bank of Australia' with an ellipsis, plus a STALE badge when applicable.
- Line 2: '151.22 AUD' larger, then '▼ −0.23 (−0.15%)' in bright red ('▲ +…' in bright green; the arrow and sign are always shown). Crypto labels the change '24h'.
- Line 3, the phase line:
  - '● Open · closes 4:00 PM EDT'
  - '○ Pre-market · opens in 1h 39m'
  - '○ After hours · closed 4:00 PM EDT'
  - '○ Closed · opens in 9h 41m'
  - '● Trading 24/7'
  - when the periods are missing: 'Last trade 4:00 PM EDT'
- SVG sparkline at full width, about 4.2em tall:
  - green above and red below the dashed previous-close line, with a dot on the last point;
  - the x-axis spans the session, so mid-session the line stops part-way;
  - axis labels: '10:00 AM · prev close 151.45 · 4:12 PM'.
- 'Day 151.22 ├●────┤ 152.54' and '52w 146.98 ├──●──┤ 185.59': CSS grid bars that share a label column.
- Stats wrap: Open 151.80 · Vol 1.1M · Exch ASX. Volume is hidden for FX and indices; a missing value shows '—'.
- Footer, dim: 'Yahoo Finance · may be delayed · updated 16 h ago', or 'Cboe · 15-min delayed · 4:00 PM EDT'.
- Chips: [↻ refresh] [1d] [5d] [1mo] [1y], with the active range outlined. They are 44 px on touch and low-key outlined text on desktop.
  - Tapping one appends a real history entry (e.g. `stock -r 5d CBA.AX`) and does not focus the input, so the phone keyboard stays down.
- Currency: decimals follow priceHint (4 for AUDUSD=X); LSE pence shows as 127.20p; '$' is never hard-coded.
- Every colour is a var(--theme-*), so `theme set` recolours past cards. Cathode effects do not blur the SVG.

STATES (exact copy; red with a beep unless noted)
- Invalid (no network): "stock: 'AP PL!' isn't a valid ticker" / 'Tickers look like AAPL, CBA.AX, ^AXJO, BTC-USD or AUDUSD=X.'
- Not found: "stock: no market data for 'ZZZZQQ'" / 'Did you mean: [ZS] [ZZZ.TO]'. With no suggestions: 'Try a company name, e.g. stock -s atlassian'.
- Usage error: "stock: unknown option '-x'" / 'usage: stock [-r RANGE] [-s QUERY] [-f] [--json|--plain] SYMBOL...'
- Rate limited: 'stock: too many requests — try again in 20 s.' Shows the saved copy if there is one.
- Upstream down, nothing saved (yellow notice): "stock: market data is unavailable right now. This is on vesen's side, not yours. Try again in a minute." plus a [↻ try again] chip.
- Timeout, nothing saved: 'stock: no response after 10 s — your connection or the quote service is slow.' plus [↻ try again].
- Stale (timeout, offline or a server stale answer): the full card with a yellow STALE badge. The footer reads 'Saved copy from 2 h ago · live data unavailable (timed out)' or '… · you're offline'. The phase is recomputed now. No beep.
- Offline, nothing saved: "stock: you're offline and there's no saved quote for AAPL."
- Origin not allowed or not configured (self-hosted on another domain): "stock: live quotes aren't available on this host." / "vesen's quote proxy only serves vesen.app — set VITE_STOCK_API to your own (README → Stock quotes)." localhost on any port is allowed, so `docker run -p 3000:3000` works.
- Raw exception text such as 'SyntaxError: Unexpected token T' is never shown. Every upstream string is escaped.

PHONE AND INSTAGRAM IN-APP BROWSER
- No window.open or mailto.
- Every storage access is guarded; losing storage only loses recents and saved copies.
- No AbortSignal.any or AbortSignal.timeout, and no color-mix, so iOS 15 and later WKWebViews work.
- The stock code and CSS are lazy-loaded on first use, so first paint from the Instagram link does not pay for them.
- The suggestion row offers recents and curated tickers after 'stock ' (local only, no network). Tab completion comes from complete.ts once the registry lands.

## Files

| Path | Purpose |
|---|---|
| `/Users/has/Documents/Git/vesen/shared/stock/contract.ts` | NEW. Wire contract v1: types plus hand-written guards (isQuoteEnvelope, isSearchEnvelope, isErrorEnvelope), SYMBOL_RE and RANGE_SPEC. Imported by the client and the Worker. |
| `/Users/has/Documents/Git/vesen/shared/stock/symbols.ts` | NEW. normaliseSymbol: '$' strip, uppercase, exchange prefix map (ASX:, LSE:, TSE:, NASDAQ:, NYSE:, AMEX:) and the ALIASES table (SP500→^GSPC, ASX200→^AXJO, NASDAQ→^IXIC, DOW→^DJI, FTSE→^FTSE, NIKKEI→^N225, BTC→BTC-USD, ETH→ETH-USD). Also CURATED (AAPL, TEAM, CBA.AX, BHP.AX, ^AXJO, ^GSPC, BTC-USD, AUDUSD=X) and isUsListed. No BRK.B rewrite. |
| `/Users/has/Documents/Git/vesen/shared/stock/marketPhase.ts` | NEW. phaseAt(quote, nowSec) → {phase, nextOpen, closesAt}. Uses market.periods (from currentTradingPeriod). CRYPTOCURRENCY is always_open; missing periods give unknown. |
| `/Users/has/Documents/Git/vesen/worker/stock/package.json, tsconfig.json, wrangler.toml` | NEW. A separate package (wrangler ^4, @cloudflare/workers-types, typescript, vitest) with scripts dev, test, deploy and tail. The tsconfig includes ../../shared/stock. wrangler.toml contains: - [vars]: ALLOWED_ORIGINS, ALLOWED_ORIGIN_PATTERNS, UPSTREAM_UA, PROVIDER_ORDER='yahoo,cboe'. - [[ratelimits]] QUOTE_RL (30/60), SEARCH_RL (20/60), ANON_RL (10/60) and UPSTREAM_RL (100/60). - [observability] enabled, head_sampling_rate 0.1. - Optional secret FINNHUB_KEY. |
| `/Users/has/Documents/Git/vesen/worker/stock/src/index.ts` | NEW. The only Cloudflare-specific file: maps env and ctx to HandlerDeps and calls handle(). |
| `/Users/has/Documents/Git/vesen/worker/stock/src/handler.ts` | NEW. Platform-agnostic pipeline: method guard → origin → route → validate → rate limit → cache, stale-while-revalidate and coalescing → provider chain under a 6.5 s deadline → resolve → stale-if-error → JSON envelope and headers. Top-level errors map to 'internal' with no stack trace. |
| `/Users/has/Documents/Git/vesen/worker/stock/src/{cors,ratelimit,cache,resolve,downsample}.ts` | NEW. - cors.ts: OriginPolicy and header helpers (ACAO is echoed on every response to an allowed origin and on a 403 origin_not_allowed). - ratelimit.ts: wraps the binding, with an in-isolate token bucket when the binding is absent. - cache.ts: TieredCache (L1 LRU of 500 entries plus best-effort caches.default, in-flight map, negative cache, phase-aware lifetimes). - resolve.ts: alias table, then search, then the resolve rule or suggestions. - downsample.ts: LTTB to 160 points. |
| `/Users/has/Documents/Git/vesen/worker/stock/src/providers/{types,yahoo,cboe,finnhub}.ts` | NEW. QuoteProvider implementations. - yahoo: chart on query1 then query2 with the UA from env, a 60 s cooldown after 429, and normaliseYahoo (open from the first bar, window from tradingPeriods, periods from currentTradingPeriod, crypto 24h basis, currency passthrough, tzAbbr from meta.timezone). Also search. - cboe: cdn-api.cboe.com delayed_quotes quotes plus the intraday chart, US only, delayed:true, index map ^GSPC→_SPX. - finnhub: only when the secret is set. |
| `/Users/has/Documents/Git/vesen/worker/stock/test/** (fixtures + *.test.ts)` | NEW. - Fixtures captured during the spike: Yahoo AAPL, CBA.AX (rolled period), VOD.L (GBp), 7203.T, BTC-USD, AUDUSD=X, ^GSPC, the ZZZZQQ 404 and a 429 body; search for apple, cba and commonwealth bank; Cboe AAPL quote and intraday, plus the CBA 403. - Tests for the normaliser, provider chain, cache, CORS, rate limits and hostile inputs. |
| `/Users/has/Documents/Git/vesen/src/lib/{html,net,memo,storage,notice}.ts` | NEW. Shared client utilities: - html.ts: escapeHtml, escapeAttr and the h`` template. - net.ts: linkSignals, fetchWithTimeout and TimeoutError. - memo.ts: TTL cache, in-flight de-duplication and failure cooldown (F065). - storage.ts: safeStorage, which never throws and falls back to memory. - notice.ts: renderNotice(tone, html), one implementation of the bordered notice block. |
| `/Users/has/Documents/Git/vesen/src/config.ts` | NEW. STOCK_API = import.meta.env.VITE_STOCK_API \|\| 'https://vesen-stock.<acct>.workers.dev'. The default is baked in, so Docker and local builds work without a .env file. |
| `/Users/has/Documents/Git/vesen/src/global.d.ts` | CHANGE. Add `readonly VITE_STOCK_API?: string` to ImportMetaEnv (lines 10-14). |
| `/Users/has/Documents/Git/vesen/src/stores/commandStatus.ts` | NEW. Contents: - commandStatus: writable<{label: string; startedAt: number; cancellable: boolean} \| null> - setCanceller(fn \| null) - cancelCurrentCommand() - runRequest: writable<{cmd: string; source: 'tap'} \| null> |
| `/Users/has/Documents/Git/vesen/src/utils/commandMeta.ts` | NEW. INTERRUPTIBLE = {curl, weather, stock, fastfetch, speedtest} and TAP_SAFE = {stock, help, man, weather, theme}, with isInterruptible() and isTapSafe(). The registry workstream absorbs this later. |
| `/Users/has/Documents/Git/vesen/src/commands/stock/index.ts` | NEW. stock(argv, abortController) uses the legacy signature and returns an HTML string. stockSpec (name, summary, interruptible, tapSafe, complete, run) matches the registry. It orchestrates the status phases, the client and the renderers, and handles the beep policy. |
| `/Users/has/Documents/Git/vesen/src/commands/stock/{args,man,complete}.ts` | NEW. - args.ts, parseStockArgs: -r/--range VALUE (or --range=VALUE), -s/--search QUERY…, -f/--fresh, --json, --plain, -- (end of flags), up to 6 symbols. - man.ts: help keeping the Usage:, Examples: and Tip: labels, plus the summary 'Stock quotes (delayed)'. - complete.ts: flags, ranges, recents plus CURATED by prefix; no network. |
| `/Users/has/Documents/Git/vesen/src/commands/stock/data/{client,lastGood}.ts` | NEW. - client.ts: createStockClient (budget, retry policy, memo, offline check, envelope guard, error mapping including origin_not_allowed and not_configured). - lastGood.ts: LRU of 12 plus recents, on safeStorage. |
| `/Users/has/Documents/Git/vesen/src/commands/stock/view/{format,sparkline,card,table,states}.ts + stock.css` | NEW. Pure renderers returning single-line, escaped HTML: - the card (header, price, phase, SVG sparkline with axis labels, CSS range bars, stats, footer, action chips); - the multi-ticker table (a mini SVG spark on wide screens, hidden under 480 px by CSS); - the states (usage, invalid, not found with chips, resolved note, errors, stale notice, cancelled through renderNotice); - --plain text and --json. |
| `/Users/has/Documents/Git/vesen/src/utils/commands/network.ts` | CHANGE. - Delete the stock implementation (lines 222-449). - Replace the local escapeHtml copies at :127 and :454 with src/lib/html. - Replace the cancel blocks at :205 and :440 with renderNotice('cancelled', …). - Drop the shouldUseStackedLayout and getAvailableWidth imports if nothing else uses them. |
| `/Users/has/Documents/Git/vesen/src/utils/commands.ts` | CHANGE. - Register `stock: (a, c) => import('../commands/stock').then(m => m.stock(a, c ?? undefined))` in the commands map (lines 457-465). - Line 343 uses isInterruptible(command). |
| `/Users/has/Documents/Git/vesen/src/components/Input.svelte` | CHANGE. - Lines 207 and 295 use isInterruptible. - When the AbortController is created, call setCanceller(() => controller.abort()), and clear it in finally. - Escape while processing calls the same abort path. - Lines 624-627: label = $commandStatus?.label \|\| (isSpeedtest && $speedtestPhase) \|\| 'Processing...', with ' · Ns' appended after 2.5 s. - Extract execute(cmd) from the Enter handler (about lines 286-357) and subscribe to runRequest. - Lines 645-651: skip input.focus() when event.target.closest('.term-action'). |
| `/Users/has/Documents/Git/vesen/src/App.svelte` | CHANGE. The status row (lines 87-91) gets role=status, aria-live=polite, and a [cancel] button when commandStatus.cancellable: 44 px on coarse pointers, with a '^C/Esc to cancel' hint on fine pointers. |
| `/Users/has/Documents/Git/vesen/src/components/History.svelte` | CHANGE. One delegated click listener on the history container. It finds closest('button.term-action[data-cmd]'), validates the command with isTapSafe and checks the arguments, ignores the tap while processing, sets runRequest, and calls stopPropagation so the input is not refocused. |
| `/Users/has/Documents/Git/vesen/src/stores/history.ts` | CHANGE. Route lines 6-7 and 22-28 through safeStorage. Without this, a storage that throws crashes the app on import, and larger SVG outputs risk QuotaExceededError. Coordinate with the phone workstream: whichever lands first does it. |
| `/Users/has/Documents/Git/vesen/src/utils/commandSuggestions.ts` | CHANGE. Add a stock branch mirroring weather (lines 55-57 and 87-96) that delegates to stock/complete.ts: recents first, then CURATED, filtered by prefix. |
| `/Users/has/Documents/Git/vesen/src/utils/helpTexts.ts` | CHANGE. - Replace the stock entry (lines 40-48), which wrongly promises 'real-time', with the export from stock/man.ts. - Line 102 becomes 'Stock quotes (delayed)'. |
| `/Users/has/Documents/Git/vesen/tsconfig.json` | CHANGE. Add "shared/**/*.ts" to include (lines 25-30). Tests stay outside src and shared. |
| `/Users/has/Documents/Git/vesen/package.json + vitest.config.ts` | CHANGE/NEW. Add devDependency vitest ^2.1 and the script "test": "vitest run" (node environment; include tests/** and worker/stock/src via the contract test). |
| `/Users/has/Documents/Git/vesen/tests/stock/*.test.ts, tests/lib/*.test.ts` | NEW. Client unit tests (symbols, phase, format, sparkline, card, table, states, args, client, lastGood, memo, net, html, notice) and contract.test.ts, which runs worker handle() in-process and decodes it with the client. |
| `/Users/has/Documents/Git/vesen/.github/workflows/stock-worker.yml` | NEW. - On a push touching worker/stock/** or shared/stock/**: npm ci and test in worker/stock, then deploy with cloudflare/wrangler-action@v3 (secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID). - A daily cron canary curls /v1/health?deep=1 and /v1/quote?symbol=AAPL with Origin https://www.vesen.app. It fails unless it gets 200, ACAO set and cache != 'stale'. |
| `/Users/has/Documents/Git/vesen/.github/workflows/firebase-hosting-merge.yml, firebase-hosting-pull-request.yml` | CHANGE. Line 14 and line 16 respectively become `npm ci && npm test && npm run build`. |
| `/Users/has/Documents/Git/vesen/.dockerignore` | NEW. Excludes node_modules, dist, .git, worker and .firebase. shared/ must NOT be excluded, because the client imports it. |
| `/Users/has/Documents/Git/vesen/README.md + worker/stock/README.md` | CHANGE/NEW. A 'Stock quotes' section: - the sources and the delay disclaimer, with 'not investment advice'; - the proxy architecture; - self-hosting your own Worker, setting ALLOWED_ORIGINS and building with VITE_STOCK_API. The worker README covers deploy, secrets and the API contract. |

## External services

- Owned proxy (new), base STOCK_API = https://vesen-stock.<acct>.workers.dev. Every call is a simple CORS GET with no custom headers, so there is no preflight.
- GET /v1/quote?symbol=SYM&range=1d|5d|1mo|6mo|1y|5y
  - 200: QuoteEnvelope.
  - 400: invalid_symbol or bad_request.
  - 403: origin_not_allowed (ACAO still echoed).
  - 404: not_found, with suggestions.
  - 429: rate_limited, with Retry-After.
  - 503: upstream_unavailable, with Retry-After: 30.
- GET /v1/search?q=TEXT&limit≤10 (q is 1–40 characters) → SearchEnvelope, cached 24 h.
- GET /v1/health[?deep=1] → {ok, version, providers: {yahoo, cboe, finnhub}}.
- Headers: ACAO (echoed origin), Vary: Origin, Access-Control-Expose-Headers (Retry-After, X-Vesen-Cache, X-Vesen-Source), Cache-Control public max-age=15, X-Vesen-Cache, X-Vesen-Source, Server-Timing.
- Yahoo Finance v8 chart, primary, called from the Worker only. URL: https://query1.finance.yahoo.com/v8/finance/chart/{SYM}?range={r}&interval={i}&includePrePost=false, then the same on query2.

Re-verified 2026-10-06:
- UA 'Mozilla/5.0' or 'Mozilla/5.0 (compatible; vesen-stock/1.0; +https://www.vesen.app)' gets 200 in about 0.4 s, 7.8 KB, with Cache-Control public, max-age=10.
- curl's UA, a full Chrome UA or no UA gets 429.
- No ACAO header.
- ZZZZQQ, CBA, APPLE and BRK.B return 404; BHP, TEAM and BRK-B return 200.
- Meta has no regularMarketOpen. The AAPL first-bar open was 332.795 against Cboe's official open of 332.96.
- Yahoo Finance search, Worker only: https://query2.finance.yahoo.com/v1/finance/search?q={q}&quotesCount=6&newsCount=0&listsCount=0.
Verified rankings:
- 'apple': AAPL (213982), then SAAPL=F (30085, a FUTURE, filtered out).
- 'commonwealth bank': CBA.AX first.
- Cboe delayed quotes, the US fallback, Worker only: https://cdn-api.cboe.com/api/global/delayed_quotes/quotes/{SYM}.json and .../charts/intraday/{SYM}.json.
Verified:
- AAPL: 200 in 0.8 s, 525 B, with fields current_price, price_change, price_change_percent, open, high, low, prev_day_close, volume and last_trade_time.
- CBA: 403.
- No ACAO header for vesen.app.
- Works with curl's UA, so it is less UA-sensitive than Yahoo.
- It has no name, currency or 52-week range, so the card hides those rows.
- Optional tier 3, only with a Worker secret: Finnhub https://finnhub.io/api/v1/quote?symbol=SYM&token=… Verified: ACAO * but 401 without a key. The free tier is US only. The alternative is Twelve Data, at 8 credits/min and 800/day.
- Spike-only alternative US fallback: Nasdaq https://api.nasdaq.com/api/quote/{SYM}/info?assetclass=stocks. Verified 200 in 3.3 s, 1.4 KB, but only with a full browser UA; slow and sits behind Akamai. Use it only if the spike shows Cboe is blocked from Cloudflare.
- Cloudflare Workers Free:
- 100,000 requests/day; beyond that, error 1027, which the client treats as a fast failure and then falls back to the saved copy.
- 10 ms CPU and 50 subrequests per request.
- The rate-limit binding takes periods of 10 or 60 s and is per location and eventually consistent.
- The Cache API has no effect on workers.dev.
- KV allows only 1,000 writes/day, so it is not used.
- Fallback host if the spike fails: a Firebase Function in australia-southeast1 (Blaze plan) or Cloud Run, wrapping handle() in a roughly 30-line Fetch adapter. A Hosting rewrite {source: '/api/stock/**', function: {...}} would have to come before the '**' rewrite in firebase.json:9-14.
- Removed:
- api.allorigins.win for stock (network.ts:236): more than 10 s, and timed out at 15 s.
- corsproxy.io: 403.
- Stooq: the quote CSV returns 404 and the history CSV sits behind a JavaScript bot check, which must not be bypassed.

## Steps

1. STAGE 0, spike and gate (0.25–0.5 d). Owner action: create a free Cloudflare account and run `wrangler login`.
- From a scratch folder outside the repo, deploy a 30-line Worker.
- Every 10 minutes for 24 hours, have it fetch the Yahoo chart (query1 and query2, with the vesen UA) for 12 symbols: AAPL, TEAM, CBA.AX, BHP.AX, VOD.L, 7203.T, ^GSPC, ^AXJO, BTC-USD, AUDUSD=X, BRK-B and ZZZZQQ. Also fetch Yahoo search, the Cboe AAPL quote and the Nasdaq AAPL info.
- Trigger it from home Wi-Fi and from phone 4G so at least 2 Cloudflare locations are sampled.
- Gate:
  - If Yahoo returns 200 or 404 for at least 95% of calls: PROVIDER_ORDER = 'yahoo,cboe'.
  - Else if Cboe or Nasdaq works: US tickers go through it, the optional FINNHUB_KEY tier is enabled, and the platform-agnostic handler is re-run on a Google egress (Cloud Run or a Firebase Function in australia-southeast1) before choosing the host.
- Save the responses as fixtures.
2. PR1, foundations with no visible behaviour change (0.75 d).
- Add vitest, the test script, vitest.config.ts and the root tests/ folder.
- Add shared/stock/{contract,symbols,marketPhase}.ts and add shared/** to the tsconfig include.
- Add src/lib/{html,net,memo,storage,notice}.ts.
- Route history.ts:6-7 and :22-28 through safeStorage.
- Add src/utils/commandMeta.ts and replace the lists at commands.ts:343, Input.svelte:207 and Input.svelte:295.
- Replace the cancel blocks at network.ts:205, network.ts:440 and Input.svelte:124 with renderNotice. A byte-identical snapshot test pins the output.
- Replace the DOM escapers at network.ts:127 and :454.
- Add the .dockerignore.
- Run npm run check (exactly the 2 known theme.ts errors), npm test and npm run build.
- Resolves for stock and its neighbours: F005 (one shared escaper) and F065 (memo helper available).
3. PR2, the Worker (1.75 d) in worker/stock.
- Write test-first: downsample.ts, then providers/yahoo.ts with its normaliser, providers/cboe.ts, resolve.ts, cache.ts, cors.ts, ratelimit.ts, handler.ts, index.ts and wrangler.toml.
- Optionally add providers/finnhub.ts, enabled only when the secret is set.
- Tests use the Stage 0 fixtures.
- Resolves F037: an owned Worker with an origin check, a 60 s cache, normalised JSON and honest asOf and source. The provider choice deviates from F037: Yahoo is primary and Cboe the fallback, with Finnhub as an optional tier, because Finnhub's free tier is US-only and the site's audience is Sydney.
4. PR2 deploy and CI (0.5 d).
- `wrangler deploy` (owner holds the account).
- Add the GitHub secrets CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.
- Add .github/workflows/stock-worker.yml with deploy on paths and the daily canary.
- Smoke tests against production:
  - Origin https://www.vesen.app on /v1/quote?symbol=AAPL gives 200, ACAO set, X-Vesen-Cache miss then hit, a body under 4 KB, and Server-Timing upstream under 1.5 s.
  - Origin https://evil.example gives 403 with zero upstream calls.
  - 31 rapid requests give a 429 with Retry-After.
- Write worker/stock/README.md.
5. PR3a, client data layer (0.75 d).
- src/config.ts and the global.d.ts env type.
- src/commands/stock/data/{client,lastGood}.ts: offline check, memo, attempt and retry policy, 10 s budget, Retry-After ≤3 s rule, envelope guards, 403 origin_not_allowed, and not_configured by hostname as a fallback.
- tests/stock/client.test.ts with fake fetch, a fake clock and a storage that throws.
- tests/stock/contract.test.ts imports worker/stock/src/handler.ts with fixture-backed providers and decodes its Response with the client.
- Resolves F035 (status and envelope checks, Number.isFinite, the chartPreviousClose fallback, friendly 429, ticker regex), F047 for stock (bounded timeouts) and F065 for stock (30 s memo, in-flight de-duplication, failure cooldown, 'as of' age). Also F038 for stock: no public CORS proxy, and third parties no longer see the requests.
6. PR3b, rendering (1.0 d).
- view/format.ts, sparkline.ts, card.ts, table.ts and states.ts, plus stock.css.
- Snapshot tests for every fixture and every state.
- Assertions:
  - a hostile name or symbol is escaped;
  - no '\n' between tags and no '<pre' in card mode;
  - every colour is a var(--theme-*);
  - gradient ids are unique across two renders;
  - data-cmd only ever contains SYMBOL_RE or RANGE_SPEC values.
- Resolves F036: currency from meta, one font size, a real sparkline from closes, and a grid layout replacing the degenerate OHLC label column at network.ts:308-362.
- Resolves F005 for stock: symbol and name escaped, which fixes network.ts:247, :369 and :444.
- Resolves the stock part of F016: the card makes no shouldUseStackedLayout or getAvailableWidth calls (network.ts:303-304 removed), and its fluid CSS reflows inside whatever wrapper the F016 work leaves behind.
7. PR3c, command wiring and legacy deletion (0.5 d).
- src/commands/stock/{args,man,complete,index}.ts.
- Lazy registration in commands.ts.
- Delete network.ts:222-449.
- Replace helpTexts.ts:40-48 and line 102.
- Add the stock branch to commandSuggestions.ts.
- Record the bundle size: the initial JS chunk must not grow; the stock chunk is expected at ≤12 kB gzip.
- Ships together with PR3a and PR3b as one deploy, because the Worker must already be live.
8. PR4, phone interactions and the status line (0.75 d). Coordinate with the mobile and autocomplete workstreams.
- Add src/stores/commandStatus.ts.
- Input.svelte:
  - setCanceller when the AbortController is created;
  - Escape aborts;
  - the label plus elapsed seconds at lines 624-627;
  - extract execute() and subscribe to runRequest;
  - skip refocus for .term-action at lines 645-651.
- App.svelte:87-91: role=status and the [cancel] chip.
- History.svelte: the delegated, allowlisted data-cmd handler.
- Adds no scroll logic of its own. The card relies on the single scroll helper F010 calls for; if that helper exists it may set data-scroll-anchor='start' so a tall card's top stays visible above the keyboard.
- Resolves F047 for every interruptible command: a tappable 44 px stop, an Escape alias and elapsed time in the spinner.
9. PR5, QA and docs (0.5 d).
- Check in the Browser pane at 320, 375, 768 and 1280 px, across 2 dark themes and 1 light theme and with cathode on and off: card, table, search, invalid, not found with chips, the resolved note, DevTools offline, Slow 3G (the status copy appears), the Worker stopped (stale card), Ctrl+C, Esc and the cancel chip.
- Check scrollWidth is at most innerWidth.
- iOS Simulator Safari and an Android emulator.
- The owner opens the Instagram profile link on a real iPhone and a real Android phone: bare stock, then tap a chip, refresh, 5d and cancel; rotate; toggle airplane mode for the stale state.
- Update both Firebase workflows to run npm test.
- Write the README 'Stock quotes' section.
- Optional: Playwright e2e on WebKit at 375×667 with hasTouch and Chromium at 1280×800, with the API routed to fixtures.

## Testing

ROOT UNIT TESTS (vitest, node environment, under tests/ so the svelte-check baseline stays at 2 errors)
- symbols: these pass or map:
  - aapl, $AAPL, ^gspc, bhp.ax, 7203.T, BTC-USD, AUDUSD=X, BRK-B;
  - asx:cba → CBA.AX;
  - sp500 → ^GSPC (alias).
  These are rejected: '', 'AP PL!', '<img>', '../x', '%2F' and a 16-character string. BRK.B is NOT rewritten.
- marketPhase:
  - AAPL at 16:55 EDT is post;
  - CBA.AX at 08:21 AEDT is pre with nextOpen 10:00 (today's rolled-period payload);
  - weekend is closed;
  - crypto is always_open;
  - periods null gives unknown;
  - boundaries across the DST changes in America/New_York and Australia/Sydney.
- format:
  - priceHint 0, 2 and 4;
  - GBp → '127.20p'; ZAc;
  - an unknown code becomes a suffix;
  - −0 becomes '0.00';
  - compact volume with a forced Intl failure falls back;
  - the tz abbreviation clock.
- sparkline: empty, one point, flat line, partial session (the line ends mid-width), a unique gradient id, and the aria-label text.
- card, table and states:
  - snapshots for every fixture and state;
  - a malicious name '<img src=x onerror=alert(1)>' is escaped;
  - no newline between tags;
  - the Cboe source hides the 52w row;
  - the stale badge, and the phase recomputed when stale;
  - the cancelled notice is byte-identical to the old block.
- args: every flag form, --range=5d, '--', more than 6 symbols, an invalid range, `-s` joins the remaining words.
- client (fake fetch, fake timers, injected random):
  - 200 is live and saves the last-good copy;
  - a hit within 30 s makes no fetch, and bypassMemory skips the cache;
  - a fast TypeError or 5xx gets one retry after jitter, then success;
  - an 8 s timeout gets no retry and returns stale-local (or a timeout error) within the 10 s budget;
  - a non-JSON 1027 body counts as a fast failure;
  - 404 makes no retry and returns the suggestions;
  - 429 with Retry-After 2 retries once; with Retry-After 30 it fails immediately as rate_limited, returning stale-local if a copy exists;
  - 403 origin_not_allowed;
  - a TypeError on an unknown host gives not_configured;
  - a user abort at any stage gives cancelled, no cache write and no stale copy;
  - storage that throws on get and set still works;
  - isOnline false gives offline without a fetch;
  - onPhase order is request, then slow, then retry.
- lib: linkSignals (parent abort, timeout abort, dispose), memo (TTL, in-flight join, failure cooldown), safeStorage, escapeHtml and escapeAttr.

CONTRACT TEST
- tests/stock/contract.test.ts runs worker/stock/src/handler.ts handle() in-process with fixture-backed providers.
- It decodes the result with the client's guards and asserts the client QuoteResult matches.
- It breaks if either side changes shape.

WORKER TESTS (worker/stock, vitest with injected deps)
- Normaliser:
  - AAPL open = first bar, 332.795, with openApprox;
  - window from tradingPeriods for CBA.AX, not currentTradingPeriod;
  - BTC-USD uses changeBasis '24h' from regularMarketChangePercent;
  - VOD.L keeps GBp;
  - AUDUSD=X has priceHint 4 and volume null;
  - every 1d response is ≤160 points and under 4 KB.
- Chain:
  - Yahoo 429 on query1 and query2, then Cboe for AAPL, gives source cboe and delayed:true;
  - the cooldown skips Yahoo for the next request;
  - non-US with Yahoo down and nothing cached gives 503 with Retry-After;
  - with the cache warm, all providers failing gives 200 with cache:'stale';
  - the deadline is enforced.
- Resolve:
  - CBA → CBA.AX with resolvedFrom;
  - APPLE → AAPL;
  - SAAPL=F is filtered out (FUTURE);
  - ZZZZQQ gives 404 with suggestions and is negative-cached for 10 min.
- Cache:
  - miss, then hit, then revalidating (with one waitUntil refresh);
  - two concurrent misses make one upstream call;
  - lifetimes: 60 s when open, 300 s when closed.
- CORS:
  - exact origins, the preview regex, and localhost on any port are allowed;
  - vesen.app.evil.com and http://www.vesen.app (wrong scheme) are denied;
  - a denied 403 still echoes ACAO with zero upstream calls;
  - no Origin uses the anon 10/min limit;
  - Vary: Origin is always present;
  - OPTIONS returns 204.
- Rate limits: the 31st request gives 429 with Retry-After; the upstream limiter skips the provider.
- Hostile inputs give 400 before any fetch.
- The set of upstream hosts is exactly {query1, query2.finance.yahoo.com, cdn-api.cboe.com, finnhub.io}.

REGRESSION AND MANUAL
- npm run check stays at the 2 known theme.ts errors.
- npm run build succeeds; the initial chunk is no larger than 142.85 kB, and the stock chunk size is recorded.
- The PR5 manual matrix, including the real-device Instagram check.
- Post-deploy smoke curls, with Server-Timing p50 and p95 over 20 calls.
- The daily canary is green.

## Risks

- Yahoo may throttle Cloudflare's shared egress IPs. The User-Agent findings were verified only from a residential IP. That is why Stage 0 is a hard gate.

Mitigations:
- query1/query2 rotation with a cooldown;
- 60–300 s caching with request coalescing and stale-if-error;
- Cboe for US symbols;
- an optional Finnhub tier;
- the portable handler, which can move to a Google egress.

Worst case: non-US tickers serve only cached or saved copies while US tickers stay live.
- Yahoo, Cboe and Nasdaq are all unofficial: no SLA, terms-of-service grey areas, and response shapes can change. Mitigations:
- defensive normalisers;
- fixture tests;
- the daily canary;
- attribution and 'may be delayed' on every card, plus 'not investment advice' on the man page;
- portfolio-scale, non-commercial volume.
- 'Open' is taken from the first 5-minute bar. It can differ from the official opening price (AAPL today: 332.795 against 332.96). It is flagged as openApprox and documented; the owner may prefer to label it 'First trade'.
- There is no shared cache on workers.dev, because the Cache API does nothing there. The in-isolate cache is per location and ephemeral, so the hit rate is lower until the vesen.app zone moves to Cloudflare (optional).
- Some networks and filters block *.workers.dev. Mitigations: honest errors and the saved copy. The long-term fix is api.vesen.app or a same-origin Firebase rewrite.
- Origin checks are not authentication, and the rate-limit binding is per location and eventually consistent (its free-plan status is unclear, so an in-memory fallback exists). Abuse is bounded by:
- fixed upstream hosts and no open relay;
- per-IP and per-upstream limits;
- the 100,000 requests/day free ceiling. On the free plan, abuse can exhaust the quota but never cost money.
- Two platforms and two secrets for a solo owner. The Worker is optional at runtime, because the client degrades to saved copies, and it is documented in worker/stock/README.md.
- Automatic name resolution may pick an unintended instrument (for example 'gold'). Mitigations:
- resolve only to EQUITY, ETF, INDEX, CRYPTOCURRENCY or CURRENCY, and only on a dominant score with a name match;
- always print the resolved note.
- Cross-workstream sequencing. This work touches Input.svelte, commands.ts, History.svelte, commandSuggestions.ts and history.ts, as do the registry, autocomplete, phone and help workstreams. Mitigations:
- seams are kept tiny (commandMeta, commandStatus, runRequest, data-cmd);
- stockSpec matches the registry;
- merge order: PR1 early, PR4 coordinated;
- features-grep touches only helpTexts.ts lines that are adjacent, not overlapping.
- Tap chips widen the attack surface: an injected element with data-cmd could run commands. Mitigations: everything is escaped, the command must be on the tapSafe allowlist, and the argument is re-validated in History before anything runs.
- History persistence (history.ts:22-24) serialises every SVG card to localStorage on each change, although history.ts:6-7 wipes it on load anyway. safeStorage prevents crashes. Removing the persistence entirely is recommended to the phone workstream.
- Test growth: vitest is a new devDependency in a repo that has no tests yet; CI time goes up by about 20 s.

## Effort

About 6.5 engineer-days (range 5.5–8):

| Stage | Days |
|---|---|
| Stage 0 spike | 0.25–0.5 |
| PR1 foundations | 0.75 |
| PR2 Worker | 1.75 |
| Deploy and CI | 0.5 |
| PR3a client data | 0.75 |
| PR3b rendering | 1.0 |
| PR3c wiring and legacy removal | 0.5 |
| PR4 phone interactions and status line | 0.75 |
| PR5 QA and docs | 0.5 |

Possible additions:
- If the spike forces a Google egress host (Blaze or Cloud Run adapter plus firebase.json rewrite): +1 to 1.5 d.
- Finnhub tier: +0.25 d.
- api.vesen.app after moving DNS to Cloudflare: +0.5 d.
- Playwright e2e: +0.5 d.

Rough size: about 900 lines of client TypeScript and tests, about 700 lines of Worker code and tests, and about 300 lines deleted from network.ts and the duplicated blocks.

## Trade-offs

- **Cloudflare Worker instead of a Firebase Function.**
  - Gained: free with no card, no cold start, runs at the Sydney edge, and works for local and Docker builds.
  - Accepted: a second platform, CORS and a workers.dev hostname.
  - The handler is platform-agnostic, so switching later is an adapter, not a rewrite.
- **Unofficial Yahoo as primary.**
  - Gained: ASX, LSE, Tokyo, indices, FX, crypto and name search with no keys. This fits the Sydney-focused audience.
  - Accepted: terms-of-service and blocking risk. Cboe, the caches and the saved copy bound the impact; a keyed tier is ready behind a secret.
- **allorigins is deleted outright rather than kept as a last resort (unlike D1).**
  - It would add up to 8 s before a saved copy shows, and it contradicts F038.
  - Self-hosters get an exact message instead of a slow, unreliable path.
- **The client fans out for multi-ticker views instead of a batch endpoint.**
  - Gained: a simpler contract, shared cache keys (the table warms the card cache), and failures isolated per row.
  - Accepted: up to 6 requests (3 at a time), well under 30 per minute.
- **SVG sparkline and CSS bars rather than block or braille glyphs.**
  - Gained: font-independent, crisp, fluid and themeable. The bundled CascadiaCode is never loaded, and braille was faint at 0.7rem in D3's prototype.
  - Glyphs remain for --plain.
  - The degenerate OHLC ASCII chart is dropped.
- **Tappable chips inside terminal output.**
  - Gained: the main way to navigate inside Instagram, where there is no Tab key and typing is costly.
  - Accepted: a slight departure from a pure terminal look, kept low-key on desktop.
- **Honest freshness over apparent liveness.**
  - Quotes can be 60–120 s older than the provider's own delay, and the card always says how old.
  - Saved copies show behind a STALE badge rather than as an error.
  - No auto-refresh or watch mode in v1.
- **One retry, and only after a fast failure, with a 10 s budget.**
  - A third try might occasionally have succeeded.
  - In exchange the terminal never hangs, which matters most inside a phone in-app browser.
- **Phase-aware cache lifetimes and stale-while-revalidate add Worker complexity.** In exchange, upstream calls drop by more than 5x outside market hours.
- **Code currency codes ('151.22 AUD') rather than Intl symbols ('A$').**
  - Gained: deterministic across locales and unambiguous between USD, AUD and CAD.
  - The exception: pence shows as '127.20p', because Intl would mis-scale GBp.
- **Lazy-loading the stock module.** A one-time chunk fetch on the first `stock`, in exchange for a smaller first paint.

## Open questions raised by this design

- Will you create and own a Cloudflare account and add the CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID secrets? Or would you rather put the vesenterminal Firebase project on the Blaze plan for a same-origin /api/stock function (needs a billing card; cold starts)?
- Are you comfortable relying on unofficial Yahoo, Cboe and Nasdaq endpoints for a portfolio piece, with attribution and a 'not investment advice' note? Or should a free Finnhub or Twelve Data key, stored only as a Worker secret, be the primary source even though it limits coverage to US/FX/crypto and drops ASX?
- Would you move vesen.app DNS from Google Cloud DNS to Cloudflare later? That allows api.vesen.app, which gives a shared edge cache and avoids filters that block *.workers.dev.
- For self-hosted Docker copies on other domains, is the 'live quotes aren't available on this host, deploy your own proxy' message right, or should the proxy serve read-only quotes to any origin?
- Which tickers should the examples and curated list lead with: Sydney/ASX-first (CBA.AX, BHP.AX, ^AXJO) or US-first (AAPL, TEAM, ^GSPC)?
- Should the Worker resolve company names automatically ('stock apple' shows AAPL with a note), or only offer 'did you mean' chips?
- Are tappable chips inside terminal output acceptable on desktop as low-key outlined text, or should they appear only on touch devices?
- Should the open price be labelled 'Open' (taken from the first 5-minute bar, which can be a few cents off the official open) or 'First trade'?
- Is it acceptable to turn on sampled Cloudflare Workers logs (no IPs recorded) for debugging? When the daily canary fails, should it rely on GitHub's failure email or open an issue?
