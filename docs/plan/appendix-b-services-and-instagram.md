# Appendix B. External services and the Instagram in-app browser

## External services

Each endpoint was called on 5 or 6 October 2026 with an `Origin: https://www.vesen.app` header, to check whether a browser page on vesen.app could use it directly. "CORS" means the browser rule that blocks a page from reading another site's response unless that site allows it.

| Service | Used for | Callable from the page | Result | Constraints |
|---|---|---|---|---|
| `api.open-meteo.com/v1/forecast` | Weather data | Yes (`*`) | 200, current and daily JSON | Non-commercial; under 10,000 calls a day, 5,000 an hour, 600 a minute; CC BY 4.0 credit required |
| `geocoding-api.open-meteo.com/v1/search` | Place search | Yes (`*`) | Sydney, Wellington and Gaza resolve. **Gadigal and Aotearoa return nothing** | Same terms |
| `nominatim.openstreetmap.org/search` | Fallback place search | Yes (`*`) | Gadigal resolves to Sydney | At most 1 request a second for the whole site; identify the app (the default Referer does this); ODbL credit; **no autocomplete**; cache results |
| `wttr.in` | Today's weather | Yes (`*`) | 200 | Text scraping, no schema; HTTP 500 without CORS for unknown places |
| `get.geojs.io/v1/ip/geo.json`, `ipinfo.io/json`, `ipwho.is` | Approximate location for a bare `weather` | Yes (`*`) | 200 | Free tiers; only on request |
| `ipapi.co` | Approximate location | Yes | 429 | Rate-limited; rejected |
| `api.allorigins.win` | Today's stock and curl proxy | Yes | 200 in 2.6 s once; 10-20 s and 520/522 at other times | An anonymous third party sees every URL |
| `corsproxy.io`, `cors-anywhere.herokuapp.com`, `thingproxy.freeboard.io` | Today's curl fallbacks | — | 403, opt-in only, and no DNS respectively | Dead |
| `query1/query2.finance.yahoo.com` | Stock data | **No** | 429 from shared IPs; 200 server-side with a short User-Agent | Unofficial; rate-limited |
| `cdn-api.cboe.com` delayed quotes | US stock fallback | No | 200 for AAPL, 403 for CBA | Unofficial; US only |
| `stooq.com` quote CSV | Stock candidate | — | 404 | Endpoint gone |
| `finnhub.io/api/v1/quote` | Keyed stock tier | Yes | 401 without a key | The key must stay on a server; free tier is US only |
| `cloudflare-dns.com/dns-query` (JSON) | `dig`, `host`, `nslookup` | Yes (`*`) | 200 | Free |
| `dns.google/resolve` | DNS fallback | Yes (`*`) | 200 | Free |
| `rdap.org/domain/<name>` | `whois` | Yes (`*`) | 302 to the registry, then 200 | Coverage varies by TLD |
| `api.ipify.org` | `fastfetch` "Local IP" today | Yes (`*`) | 200 | Shows the public IP, mislabelled as local |
| `speed.cloudflare.com/__down`, `/__up` | `speedtest` | Yes | 200 | Undocumented endpoint; the client's measurement code is the problem |
| `api.github.com/repos/hsalvesen/vesen` | `repo` card, `git log` | Yes | 200 | 60 requests an hour per IP without a token |

**Owned proxy.** The Cloudflare Workers free plan allows 100,000 requests a day, 1,000 a minute in bursts, and 10 ms of CPU per request, at no cost. That is enough for the stock Worker described in [07-stock-and-proxy.md](07-stock-and-proxy.md). Firebase Functions would also work, but need the paid Blaze plan.

## What the Instagram in-app browser allows

This combines published reports from 2025-2026 with what WebKit and Android WebView are documented to do. **None of it has been checked on a device yet.** The capability probe in [04-phone-and-instagram.md](04-phone-and-instagram.md#the-device-capability-probe) turns this table into facts.

| Behaviour | iOS (WKWebView inside Instagram) | Android (WebView inside Instagram) | What vesen should do |
|---|---|---|---|
| `window.open` | Blocked | Usually blocked | Always print a real link. Never print "Opening…" without one |
| Redirects to another app or scheme | Dropped unless triggered by a tap | Work from a tap | Put every escape and `mailto:` behind something the visitor taps |
| Opening the page in the real browser | `instagram://extbrowser/?url=<encoded>` from a tap shows Meta's confirmation sheet; `x-safari-https://` is unreliable inside Instagram | `intent://www.vesen.app/#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=…;end` | Offer it only when an action needs it, next to the manual "••• → Open in browser" instruction |
| Detection | User agent contains `Instagram` | User agent contains `Instagram` and `wv` | Use it for hints and defaults only, never to remove a feature |
| `100vh` | Taller than the visible area; toolbars and the keyboard overlap the bottom | Same with dynamic toolbars | `100dvh` plus a `visualViewport` listener |
| Focus zoom | Zooms when the focused input is under 16 px | Not applicable | 16 px input on touch; keep pinch zoom enabled |
| Leaving the page | Back may reload the page and lose state | Same | A session snapshot restores the terminal on Back |
| Remote inspection | Not possible | Not possible | A `?debug=1` overlay and a `debug report` command |

Sources:

- [What actually escapes Instagram's in-app browser in 2026](https://plugwith.me/blog/what-escapes-instagram-in-app-browser-in-2026/)
- [Escaping Instagram's in-app browser on iOS](https://dev.to/jplogix/escaping-instagrams-in-app-browser-on-ios-and-why-its-so-hard-58om)
- [Instagram in-app browser guide](https://link.boo/guides/instagram-in-app-browser)
- [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/)
- [Open-Meteo terms](https://open-meteo.com/en/terms)
- [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/)
- [Cascadia Code licence](https://github.com/microsoft/cascadia-code/blob/main/LICENSE)
