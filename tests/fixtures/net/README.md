# Recorded network fixtures

Response bodies served by the mocked `fetch` in tests, so no test touches the network. Captured on 2026-10-06 (Sydney time).

| File | Endpoint | Notes |
|---|---|---|
| `wttr-oslo.txt` | `GET https://wttr.in/Oslo?ATm` | The body exactly as captured, including wttr.in's closing attribution line. |
| `yahoo-chart-aapl.json` | `GET https://query2.finance.yahoo.com/v8/finance/chart/AAPL` | `meta` is untouched. The 391 one-minute points in `timestamp` and `indicators.quote[0]` are cut to the first 5 to keep the file small. `query1` answered 429 at capture time; both hosts serve the same body. |
| `httpbin-get.json` | `GET https://httpbin.org/get` | `origin` and `X-Amzn-Trace-Id` are replaced with a documentation address (203.0.113.0/24) and a zeroed id. |
| `ipify.json` | `GET https://api.ipify.org?format=json` | A documentation address, not a capture. |

`stock` reaches Yahoo through `https://api.allorigins.win/get?url=…`. The tests wrap the body in that service's JSON envelope (`{ contents, status }`) at runtime, so the files hold only the upstream body and stay reusable once the proxy changes. `curl`, `weather` and `fastfetch --net` fetch their hosts directly.
