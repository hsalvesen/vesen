# Reliable stock quotes, and an owned proxy

**Goal:** `stock AAPL` answers in under a second, works on phones, says honestly how fresh the data is, and never hangs. `curl` stops depending on anonymous public proxies.

**Reference design:** [designs/stock.md](designs/stock.md). The shared decisions in [02-architecture-and-contracts.md](02-architecture-and-contracts.md) override it where they differ.

## Why the current approach cannot be fixed in place

`stock` fetches Yahoo Finance through `api.allorigins.win` (`network.ts:236`). In testing, that proxy took 10-20 seconds and often failed with Cloudflare 520 or 522 errors. Calling Yahoo directly from a browser is impossible: it sends no CORS header, and from shared IP addresses it returns HTTP 429. The other proxies `curl` falls back on are dead: corsproxy.io now returns 403, cors-anywhere needs a manual opt-in, and thingproxy no longer resolves. Every third-party proxy also sees the full URL and the visitor's IP address (F038). Nothing has a timeout, so on a phone a slow proxy leaves the visitor behind a disabled input with no way to cancel (F047).

There is no free, browser-callable, keyless quote source. Every reliable option needs a small server that vesen owns.

## The design

**A Cloudflare Worker, `vesen-stock`, on the free plan.** The free plan allows 100,000 requests a day and 10 ms of CPU per request, at no cost. The Worker:

- calls only fixed upstream addresses and validates every symbol;
- answers only `vesen.app`, its Firebase preview channels and `localhost`;
- caches for 60 s while a market is open and 300 s while it is closed, merges concurrent requests for the same symbol, and serves stale data for up to 24 h when every source fails;
- rate-limits each IP address and each upstream.

Its sources:

| Source | Role | Verified on 6 October 2026 |
|---|---|---|
| Yahoo v8 chart, with a vesen User-Agent | Primary, all markets | 200 in about 0.4 s from a residential IP; 429 with curl's or Chrome's User-Agent; no CORS |
| Cboe delayed quotes | US fallback | 200 in 0.8 s for AAPL; 403 for CBA |
| Yahoo search | Company name to ticker ("stock apple" gives AAPL) and did-you-mean | Ranks AAPL and CBA.AX first |
| Finnhub or Twelve Data | Optional keyed tier; the key stays a Worker secret | Finnhub returns 401 without a key; its free tier covers US markets only |

The request handler is written against the Fetch API with no Cloudflare-specific code. If the spike shows Yahoo blocks Cloudflare's addresses, the same code moves to a Firebase Function or Cloud Run behind a small adapter.

**A curated snapshot tier.** A scheduled job, either a GitHub Actions cron or a Worker cron, writes quotes for about ten curated tickers to a small JSON file. The example chips (AAPL, TEAM, CBA.AX, ^AXJO, BTC-USD) therefore never fail, and always show "as of HH:MM".

**On the client**, a lazy-loaded `src/commands/network/stock.ts` replaces 228 lines in `network.ts:222-449`. It has three parts:

- **Data client:** 8 s per attempt, at most one retry and only after a fast failure, a 10 s total budget, a 30 s in-memory cache, an offline check, and a last-good copy in storage.
- **Renderers:** a `quote-card` component block for one ticker and a `quote-table` for several. The card shows an SVG session sparkline, day and 52-week range bars, the market phase ("Pre-market · opens in 1h 39m"), prices in the instrument's own currency, and a footer naming the source and the data's age.
- **Tap chips:** [↻ refresh] [1d] [5d] [1mo] [1y] and did-you-mean. They run without opening the phone keyboard.

## What visitors get

| Command | Result |
|---|---|
| `stock` | Usage plus example chips, with no network call |
| `stock AAPL`, `stock aapl`, `stock $aapl`, `stock ASX:CBA` | One card |
| `stock cba`, `stock apple`, `stock sp500` | Resolved with a note, such as "showing CBA.AX (ASX)" |
| `stock AAPL CBA.AX BTC-USD` | A table, with each symbol a chip |
| `stock -s commonwealth bank` | Search results as chips |
| `stock -r 5d AAPL` | A different chart range |
| `stock --plain`, `stock --json` | Text output for copying and future pipes |

Error states are written in plain words. Raw exception text such as `SyntaxError: Unexpected token` is never shown.

| Situation | What the visitor sees |
|---|---|
| Ticker not found | "no market data for 'ZZZZQQ'", plus did-you-mean chips |
| Rate limited | "try again in 20 s", plus the saved copy if there is one |
| Slow or offline | The last good card with a yellow STALE badge and its age |
| Host not allowed | On another domain: "live quotes aren't available on this host" |

## curl

`curl` stops using public proxies. It fetches directly, and when a site blocks browser requests it says so honestly: `curl: (7) blocked by CORS: example.com does not allow browser requests`. Optionally, the Worker can also expose a `/fetch` route for `curl --via-proxy`, so that an honest proxy is available. That route would allow `http` and `https` only, block private address ranges, cap bodies at 1 MB, strip cookies and rate-limit, and stderr would say the proxy was used.

## Decisions that change the reference design

| Topic | Reference design | This plan |
|---|---|---|
| Rendering | HTML strings with `data-cmd` buttons re-validated against an allowlist | `quote-card` and `quote-table` component blocks; actions from the trusted model |
| Shared helpers | Its own `src/lib/{html,net,memo,storage,notice}.ts` | The shared services from the contracts |
| Run state | `stores/commandStatus.ts` with `setCanceller` and `runRequest` | The shell `Session` job store |
| Curated tickers | Example chips only | Example chips backed by the scheduled snapshot, so they always render |
| Terms | Attribution and "may be delayed" | The same, plus a short terms review recorded in `worker/stock/README.md` before launch |

## Work sequence

| Step | Phase | Days | Delivers | Resolves |
|---|---|---|---|---|
| Spike and gate | 1 (parallel) | 0.5 + owner | A throwaway Worker samples Yahoo, Cboe and search every 10 minutes for 24 hours from at least two Cloudflare locations. Yahoo must succeed 95% of the time to stay primary | Removes the main risk |
| Worker | 1 (parallel) | 1.75 | `worker/stock/` built test-first: providers, normaliser, cache, CORS, rate limit, handler | F037 |
| Deploy, CI and canary | 1 (parallel) | 0.5 | `wrangler deploy`, GitHub secrets, a workflow that deploys on path changes and runs a daily canary, production smoke tests | |
| Snapshot tier | 1 (parallel) | 0.25 | A cron writes the curated tickers' quotes | |
| Client data layer | 4 | 0.75 | Budgets, retry policy, memo, last-good copy, envelope guards | F035, F065, F047 |
| Rendering | 4 | 1 | Card, table, sparkline, range bars, states, currency formatting | F036, F005 |
| Wiring and deletion | 4 | 0.5 | The spec, a lazy chunk, deletion of `network.ts:222-449` | F038 |
| Phone interactions and QA | 4 | 0.75 | Chips, status labels, a 44 px Stop, rotation, airplane mode for the stale state | |
| curl rework | 4 | 0.5 | Direct fetch, honest errors, the optional `--via-proxy` | F038 |

About 6.5 days.

## Acceptance checks

- A request from `Origin: https://www.vesen.app` returns 200 with the CORS header and a body under 4 KB. A request from `https://evil.example` returns 403 with no upstream call. Thirty-one rapid requests produce a 429 with `Retry-After`.
- The initial JavaScript chunk does not grow, and the stock chunk is 12 kB gzipped or less.
- A company name containing markup is escaped in the card.
- With the Worker stopped, `stock AAPL` shows the saved copy with a STALE badge within 10 s.

## Questions for the owner

- **Hosting:** will you create and own a free Cloudflare account and add `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub secrets? The alternative is the Firebase Blaze plan for a same-origin function, which needs a billing card and has cold starts.
- **Data sources:** are you comfortable relying on unofficial Yahoo and Cboe endpoints, with attribution and a "not investment advice" note? The alternative is a keyed provider as the primary source, which drops ASX coverage.
- **Example tickers:** should they lead with Sydney (CBA.AX, BHP.AX, ^AXJO) or the US (AAPL, TEAM, ^GSPC)?
- **Name resolution:** should company names resolve automatically ("stock apple" shows AAPL with a note), or only offer did-you-mean chips?
- **curl proxy:** do you want the optional `curl --via-proxy` route on the Worker?
- **DNS:** would you move `vesen.app` DNS to Cloudflare later? That would allow `api.vesen.app`, a shared edge cache, and avoid filters that block `*.workers.dev`.
