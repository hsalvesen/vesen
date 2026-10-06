# Recorded upstream responses

Bodies served by the fake `fetch` in `../support/fixtures.ts`, so no test touches the network. All were captured with curl on 6 October 2026 between 03:27 and 03:33 UTC (14:27 to 14:33 in Sydney: the ASX open, New York closed), with the Worker's User-Agent `Mozilla/5.0 (compatible; vesen-stock/1.0; +https://www.vesen.app)`, unless noted. Every body is exactly as received.

| File | Request | Status |
|---|---|---|
| `yahoo-chart-aapl-1d.json` | `https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=5m&includePrePost=false` | 200 |
| `yahoo-chart-aapl-5d.json` | the same with `range=5d&interval=15m` (131 bars, so it exercises downsampling) | 200 |
| `yahoo-chart-cba-ax-1d.json` | `…/chart/CBA.AX?range=1d&interval=5m&includePrePost=false` | 200 |
| `yahoo-chart-bhp-ax-1d.json` | `…/chart/BHP.AX?…` | 200 |
| `yahoo-chart-team-1d.json` | `…/chart/TEAM?…` | 200 |
| `yahoo-chart-msft-1d.json` | `…/chart/MSFT?…` | 200 |
| `yahoo-chart-nvda-1d.json` | `…/chart/NVDA?…` | 200 |
| `yahoo-chart-axjo-1d.json` | `…/chart/%5EAXJO?…` | 200 |
| `yahoo-chart-gspc-1d.json` | `…/chart/%5EGSPC?…` | 200 |
| `yahoo-chart-btc-usd-1d.json` | `…/chart/BTC-USD?…` | 200 |
| `yahoo-chart-audusd-x-1d.json` | `…/chart/AUDUSD%3DX?…` | 200 |
| `yahoo-chart-zzzzqq-404.json` | `…/chart/ZZZZQQ?…`, a ticker that does not exist | 404 |
| `yahoo-chart-cba-404.json` | `…/chart/CBA?…`: Yahoo needs the `.AX` suffix | 404 |
| `yahoo-chart-429.txt` | `…/chart/AAPL?…` with curl's default User-Agent | 429 |
| `yahoo-search-apple.json` | `https://query2.finance.yahoo.com/v1/finance/search?q=apple&quotesCount=6&newsCount=0&listsCount=0` | 200 |
| `yahoo-search-commonwealth-bank.json` | the same with `q=commonwealth%20bank` | 200 |
| `yahoo-search-cba.json` | the same with `q=CBA` | 200 |
| `yahoo-search-zzzzqq.json` | the same with `q=ZZZZQQ`: no results | 200 |
| `cboe-quote-aapl.json` | `https://cdn-api.cboe.com/api/global/delayed_quotes/quotes/AAPL.json` | 200 |
| `cboe-quote-spx.json` | `…/quotes/_SPX.json`, Cboe's name for the S&P 500 | 200 |
| `cboe-quote-cba-403.xml` | `…/quotes/CBA.json`: Cboe covers US listings only | 403 |
| `finnhub-quote-401.json` | `https://finnhub.io/api/v1/quote?symbol=AAPL` with no key | 401 |

The Worker asks search for 10 results rather than 6; the fake `fetch` matches search requests by `q` only. Requests with no recording get what the real hosts answer for an unknown symbol: Yahoo's chart 404 body, the empty search result, Cboe's 403 or Finnhub's 401.

To refresh a recording:

```bash
UA='Mozilla/5.0 (compatible; vesen-stock/1.0; +https://www.vesen.app)'
curl -sS -A "$UA" -o yahoo-chart-aapl-1d.json \
  'https://query1.finance.yahoo.com/v8/finance/chart/AAPL?range=1d&interval=5m&includePrePost=false'
```

Then update the expected values in the tests, and regenerate the Worker's built-in snapshot with `npx vitest run --project worker -u`.
