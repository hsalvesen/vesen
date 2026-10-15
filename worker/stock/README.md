# vesen-stock

Stock quotes for [vesen.app](https://www.vesen.app). A small Cloudflare Worker on the free plan sits between the terminal and the market-data sources. A browser cannot call Yahoo Finance directly: Yahoo sends no CORS header, and it rate-limits browser-like requests from shared addresses.

The Worker:

- calls only fixed upstream hosts, and validates every symbol before it calls them;
- answers only vesen.app, its Firebase preview channels and localhost;
- caches each quote for 60 s while its market is open and 300 s while it is closed, merges concurrent requests for the same symbol, and serves a stale copy for up to 24 h when every source fails;
- rate-limits each IP address and each upstream;
- keeps a snapshot of ten curated tickers, refreshed every 15 minutes, so the terminal's example chips always have something to show.

The request handler (`src/handler.ts`) uses only the Fetch API. `src/index.ts` is the only file that knows about Cloudflare, so if Cloudflare's addresses are ever blocked, the same handler can run as a Firebase Function or on Cloud Run behind a small adapter.

## Sources

| Source | Role | Notes |
|---|---|---|
| Yahoo Finance v8 chart (`query1`, then `query2`) | Primary, all markets | Answers a short, honest User-Agent (`UPSTREAM_UA`). After a 429 a host is left alone for 60 s |
| Cboe delayed quotes | Fallback for US stocks, ETFs and four indices | 15 minutes delayed. No name, 52-week range or chart |
| Yahoo Finance search | Company names to tickers, and did-you-mean | Only equities, ETFs, indices, crypto and currencies |
| Finnhub | Optional keyed tier, US only | Used only when the `FINNHUB_KEY` secret is set |

Every request gets one 6.5 s budget across all its upstream calls.

## API

The wire format lives in [`src/services/market/contract.ts`](../../src/services/market/contract.ts), which the Worker and the app both compile against. So does the Yahoo chart normaliser, [`src/services/market/normalise.ts`](../../src/services/market/normalise.ts), which the app's interim source uses until this Worker is deployed, so a quote reads the same from either; `test/client.test.ts` runs the app's market client against this handler in-process. All times are Unix seconds. A value the source did not give is `null`, never `0`.

| Request | Answer |
|---|---|
| `GET /v1/quote?symbol=AAPL&range=1d` | `QuoteEnvelope`. `range` is `1d` (default), `5d`, `1mo`, `6mo`, `1y` or `5y` |
| `GET /v1/search?q=commonwealth%20bank&limit=6` | `SearchEnvelope`: up to `limit` (1 to 10) instruments. `q` is 1 to 40 characters |
| `GET /v1/snapshot` | `SnapshotEnvelope`: the ten curated tickers, without chart series |
| `GET /v1/health` | `HealthEnvelope`: version, provider order, whether the snapshot store is bound |

**Symbols.** `normaliseSymbol` trims, drops one `$`, upper-cases and maps exchange prefixes (`ASX:CBA` becomes `CBA.AX`). The result must match `SYMBOL_RE`: AAPL, CBA.AX, ^AXJO, BTC-USD, AUDUSD=X and BRK-B all pass. When Yahoo says a symbol does not exist, the Worker tries, in order:

1. an alias (`SP500` → ^GSPC, `ASX200` → ^AXJO, `BITCOIN` → BTC-USD);
2. a listing whose base symbol is the query (`CBA` → CBA.AX);
3. a search hit that scores at least twice the runner-up and whose name contains the query (`APPLE` → AAPL).

A resolved answer carries `resolvedFrom`. Anything else is `not_found` with up to five suggestions.

**A quote** carries the price, the change and its basis (`24h` for crypto, otherwise the previous close), the open (from the first bar, so `openApprox` is true), the day and 52-week ranges, the volume, the market phase with its trading periods, a series of at most 120 `[seconds since start, close]` points, the source, `asOf` (the last trade) and `fetchedAt`. A 1d answer is under 4 KB. When the Worker serves an older copy because live data failed, `stale` is true and `staleReason` says why. The app recomputes the market phase from `market.periods` with `marketPhaseAt` when it renders, so an old copy never claims a market is open.

**Errors** are an `ErrorEnvelope` `{ v: 1, kind: "error", error: { code, message, retryAfter?, suggestions? } }`:

| Code | Status | When |
|---|---|---|
| `invalid_symbol` | 400 | The symbol fails validation. No upstream call is made |
| `bad_request` | 400, 404, 405 | A bad range, query or limit, an unknown path, or a method other than GET |
| `not_found` | 404 | The symbol does not exist and nothing resolved; includes `suggestions` |
| `rate_limited` | 429 | Too many requests from this address; `Retry-After` says when to try again |
| `origin_not_allowed` | 403 | The browser origin is not on the list. No upstream call is made |
| `upstream_unavailable` | 503 | Every source failed and nothing is saved; `Retry-After: 30` |
| `internal` | 500 | A bug. The response never includes details |

**Headers.** Every response has `Vary: Origin` and `Access-Control-Expose-Headers: Retry-After, X-Vesen-Cache, X-Vesen-Source`. An allowed origin is echoed in `Access-Control-Allow-Origin`; so is a refused one, on its 403 only, so a copy of vesen on another domain can say why it gets no quotes. Answers worth reusing have `Cache-Control: public, max-age=15`, and other errors have `no-store`. `X-Vesen-Cache` is `hit`, `miss` or `stale`, `X-Vesen-Source` names the source, and `Server-Timing` reports the cache state, the upstream time and the total.

**Limits.** Per IP address and per isolate: 30 quote or snapshot requests and 20 searches a minute from vesen.app. Requests with no `Origin` header, such as curl or the canary, share 10 a minute. Each provider is held to 100 calls a minute per isolate.

## Local development

From the repository root, without installing anything in this folder:

```bash
npx vitest run --project worker              # the Worker's tests, against recorded fixtures
npx tsc -p worker/stock/tsconfig.json --noEmit
```

To run the Worker itself:

```bash
cd worker/stock
npm install                                  # wrangler and the Workers types
npx wrangler dev                             # http://localhost:8787
curl -H 'Origin: http://localhost:3000' 'http://localhost:8787/v1/quote?symbol=CBA'
```

`wrangler dev` simulates KV locally, so `/v1/snapshot` answers from the built-in copy until the cron has run. To run the cron by hand, start with `npx wrangler dev --test-scheduled` and request `http://localhost:8787/cdn-cgi/handler/scheduled` (older Wrangler versions use `/__scheduled`).

The type-check uses small local declarations in `src/env.d.ts` for the three Cloudflare types the Worker needs, so it works without installing `@cloudflare/workers-types`.

Tests live in `test/` and run under the root Vitest config as the `worker` project. They use fixtures recorded with curl and the vesen User-Agent, listed in [`test/fixtures/README.md`](test/fixtures/README.md). `src/snapshot-builtin.json` is generated from those fixtures by `test/snapshot-builtin.test.ts`; after refreshing them, regenerate it with `npx vitest run --project worker -u`.

## Stage 0 spike

Yahoo's behaviour was checked only from a home connection. Cloudflare's shared addresses may be treated differently, so before the Worker is relied on, a throwaway Worker in `spike/` samples the sources from Cloudflare for 24 hours.

1. Create the Cloudflare account (owner setup, step 1, below), then from this folder run `npm install` and `npx wrangler login`.
2. From `worker/stock`, create its namespace and paste the id into `spike/wrangler.toml`:

   ```bash
   npx wrangler kv namespace create SPIKE --config spike/wrangler.toml
   npx wrangler deploy --config spike/wrangler.toml
   ```

3. Every 10 minutes a cron calls the Yahoo chart on `query1` and `query2` for 12 symbols (including a ticker that does not exist), Yahoo search and Cboe, and stores the statuses and timings.
4. Open `https://vesen-stock-spike.<account>.workers.dev/sample` once from home Wi-Fi and once from phone data, so that at least two Cloudflare locations are sampled.
5. After 24 hours, open `/report`.

**The gate.** Yahoo stays the primary source if at least 95% of its chart calls get a real answer (200, or 404 for the unknown ticker) over 24 hours from at least two locations. The report gives the verdict and the `PROVIDER_ORDER` to use:

- `yahoo-primary`: keep `PROVIDER_ORDER = "yahoo,cboe"`.
- `cboe-only`: set `PROVIDER_ORDER = "cboe,yahoo"`, add a `FINNHUB_KEY`, and try the same handler on a Google egress (Cloud Run or a Firebase Function) before choosing a host.
- `fail`: do not deploy. Run the handler elsewhere and repeat the spike.

Then delete the spike with `npx wrangler delete --config spike/wrangler.toml`, and delete its namespace in the dashboard.

## Owner setup

Once, and about five minutes. Until it is done, the site reads Yahoo through the public api.allorigins.win proxy, which is slow at best and often down, so `stock` mostly fails.

1. **Create a free Cloudflare account** at [dash.cloudflare.com](https://dash.cloudflare.com/sign-up). The Workers free plan allows 100,000 requests a day and needs no card. Choose a `workers.dev` subdomain when asked.
2. **Create an API token** under My Profile, API Tokens, Create Token, with the "Edit Cloudflare Workers" template.
3. **Add two repository secrets** in GitHub (Settings, Secrets and variables, Actions, Secrets):
   - `CLOUDFLARE_API_TOKEN`: the token from step 2.
   - `CLOUDFLARE_ACCOUNT_ID`: shown on the Workers and Pages overview page.
4. **Deploy:** in GitHub, Actions, Stock Worker, Run workflow. It tests the Worker, deploys it, and its summary gives the Worker's URL, such as `https://vesen-stock.<subdomain>.workers.dev`.
5. **Point the site at it:** add a repository variable (Settings, Secrets and variables, Actions, Variables) named `VITE_STOCK_API`, with that URL and no trailing slash, then run CI on `main` again. The site's next build asks the Worker for quotes, and every card names its source.

From then on, `.github/workflows/stock-worker.yml` tests and deploys the Worker whenever `worker/stock/**` or `src/services/market/**` changes on `main`, and checks `/v1/health` and `/v1/quote?symbol=AAPL` (from `https://www.vesen.app`) every day. Until the secrets and the variable exist, both jobs skip with a notice. GitHub emails you when the canary fails.

**Optional:**

- **The snapshot store.** Without it the curated tickers' snapshot answers from the copy built into the Worker, marked stale. To keep it fresh, run `npx wrangler kv namespace create SNAPSHOT` from this folder and uncomment the `[[kv_namespaces]]` lines in `wrangler.toml` with the id it prints.
- **A third source.** Add a Finnhub key with `npx wrangler secret put FINNHUB_KEY` (US symbols only); it is appended to the provider order automatically.
- **Deploying from your own machine:** `npm install`, `npx wrangler login` and `npx wrangler deploy` from this folder, then step 5. Commit any change `npm install` makes to `package-lock.json`: the workflow installs Wrangler from it with `npm ci`, and the Cloudflare token reaches only its Deploy step, never the steps that install packages.
- **The Stage 0 spike** above, to see how Yahoo treats Cloudflare's addresses before relying on it. From a home connection in October 2026, Yahoo answered the Worker's User-Agent at once for US and ASX symbols alike, and the Worker run locally (`npx wrangler dev`) gave the app every kind of answer it draws; Cloudflare's shared addresses may still be treated differently.

## Terms

- Yahoo Finance and Cboe's delayed-quote feed are unofficial, undocumented endpoints. They have no SLA, can change shape or start refusing requests without notice, and their terms restrict redistribution. The Worker fetches small amounts of data only when a visitor asks, caches it, never resells it, and serves a non-commercial portfolio site.
- Every card in the terminal names its source (Yahoo Finance, Cboe or Finnhub) and its age, and says quotes may be delayed. Cboe data is 15 minutes delayed; ASX data from Yahoo is typically 20 minutes delayed.
- The terminal's help and `man stock` say the quotes are for information only and are **not investment advice**.
- Before launch, review the current terms of each source and record the outcome here.

| Source | Terms reviewed (date, by) | Outcome |
|---|---|---|
| Yahoo Finance | | |
| Cboe delayed quotes | | |
| Finnhub (if used) | | |
