# In-house weather

**Goal:** replace the wttr.in text scrape with a weather command that vesen owns end to end. It uses structured data, original art, a layout that fits any screen, and place names that keep working, including the Indigenous names the site uses as examples.

**Reference design:** [designs/weather.md](designs/weather.md). The shared decisions in [02-architecture-and-contracts.md](02-architecture-and-contracts.md) override it where they differ. The art and both card layouts already work in [prototypes/weather/art.mts](prototypes/weather/art.mts).

## What is wrong today

- `weather` fetches wttr.in's text output and colours it with a chain of regular expressions (`network.ts:47-98`). The chain never colours temperatures, wraps wind speeds twice and misses most conditions (F026). It also injects the third-party text into the page unescaped (F005).
- On screens up to 768 px wide it keeps only the first seven lines, so phones never see the forecast (F060). On laptops under about 1,250 px the 125-column table scrolls sideways (F016).
- An unknown place produces a red `TypeError: Failed to fetch`, because wttr.in's error reply has no CORS header (F059, refuted as stated but still an unhelpful message).
- There is no timeout, and the location is spliced into the URL unencoded (F047, F054).

## The design in one paragraph

Places are resolved in a fixed order:

1. Coordinates typed as `lat,lon`.
2. A curated table, which needs no network. It holds the 14 existing Palestine mappings with spelling variants, plus Gadigal, Aotearoa, Naarm, Meanjin, Boorloo, Tarntanya, nipaluna, Garramilla, Tāmaki Makaurau, Te Whanganui-a-Tara, Ōtautahi, Ōtepoti and Kirikiriroa.
3. A local cache.
4. Open-Meteo's geocoder.
5. A throttled, credited OpenStreetMap Nominatim fallback, called only on Enter and never while typing.

One Open-Meteo forecast call returns current conditions and seven days in metric, and the browser converts units. The data becomes a typed view model rendered by a `WeatherCard` Svelte component. The card has a compact layout (36 columns or fewer, fits a 320 px phone) and a wide layout (72 columns or fewer), and a container query picks one at display time, so rotating a phone re-lays out cards already on screen.

## What visitors get

```text
Gadigal Country · Sydney, AU
    \ | /     Clear sky
   - .-. -    17°C feels 18°
  -- (   ) -- NW 5 km/h g 13
   - `-' -    Hum 94% · 0.0 mm
    / | \     UV 7.5 · 06:26-19:01
Today  16° ▬▬▬▬▬ 26°  86% Drizzle
Wed    14° ▬▬▬▬▬ 17°  82% Drizzle
Thu    12° ▬▬▬▬▬ 18°  48% Drizzle
[ °F ] [ 7 days ] [ my location ]
Open-Meteo.com · 08:00 GMT+11
```

The `▬` range bars are CSS spans sized in `ch` and shaded between the cold and hot role colours. The status line names each step: "Searching for "Springfield"…", then "Fetching forecast for Gadigal Country…", with elapsed seconds after 3 s and a Stop chip.

The command accepts:

| Usage | Effect |
|---|---|
| `weather PLACE` | A place name, `"City, Country"` or `lat,lon` |
| `-u` / `-m` / `--units uk` | Imperial, metric or UK units |
| `-d N` | Number of forecast days |
| `--here` | Asks for location only when typed |
| `weather -` | The previous place |
| `--forget` | Clears saved places |
| `--oneline`, `--json` | Plain text output, ready for pipes |

Errors say what to do next:

- `weather: no place called "Atlantis". Did you mean: weather Aotearoa?`
- `weather: Open-Meteo didn't answer within 8 s.`, with a [try again] chip.

## External services

| Service | Use | Limits |
|---|---|---|
| Open-Meteo forecast | All weather data | Non-commercial; under 10,000 calls/day; CC BY 4.0 credit on every card |
| Open-Meteo geocoding | Primary place search | Same terms; cache hits for 30 days and misses for 1 hour |
| Nominatim | Fallback search, and reverse lookup for `--here` | At most 1 request/second across the site, the default Referer must be kept, © OpenStreetMap credit, no autocomplete |
| GeoJS, with ipinfo.io as backup | Approximate location for a bare `weather` | Only if the owner approves; coordinates rounded to 0.01° and never saved |
| Browser geolocation | `--here` only | Wrapped in its own timer, because Instagram's Android WebView may never call back |

## Decisions that change the reference design

| Topic | Reference design | This plan |
|---|---|---|
| Rendering | Escaped HTML strings from an `html` tagged template, shown through `{@html}` | A `weather-card` component block with a `WeatherView` prop; `plain` text for pipes |
| Shared helpers | Its own `src/lib/html.ts`, `http.ts` and `storage.ts` | `services/net.ts` and `services/storage.ts` from the contracts |
| Theme colours | A `roles` map and `--wx-*` variables | `--role-sun`, `--role-rain`, `--role-cold`, `--role-hot`, owned by the visual workstream |
| Run state | `commandPhase`, `cancelActive` and `runRequest` stores in `history.ts` | The shell `Session` job store and the trusted action model |
| Help | Edits `helpTexts.ts` | Generated from the spec |
| Tap chips | `data-run` attributes handled by the window click handler | Actions built in command code only, after the safe renderer ships |

## Work sequence

| Step | Phase | Days | Delivers | Resolves |
|---|---|---|---|---|
| Pure core | 1 (parallel) | 1 | `wmo.ts` (28 codes, labels, art), `units.ts`, `places.ts` (curated table), with table-driven tests | |
| Sources and resolution | 1 (parallel) | 0.5 | Open-Meteo forecast and geocoding through `services/net`, a 10-minute cache, stale-on-error for 6 hours | F060, F065 |
| Card component and wiring | 4 | 1.5 | `WeatherCard.svelte` with compact and wide layouts, the spec, deletion of `network.ts:9-110` and the wttr.in dependency | F026, F005, F016, F059, F054 |
| Search quality and Nominatim | 4 | 1 | "Paris France" retry, the "Also:" alternatives, did-you-mean, the throttled fallback with credit | |
| Location, chips and extras | 4 | 1 | Bare `weather` chain, `--here`, recents, `weather -`, chips, `--oneline` and `--json` | |
| Device QA | 4 | 0.25 | The phone checklist, plus `--here` allowed, denied and ignored inside Instagram | |

About 5.25 days. The pure core can start in Phase 1, because no later decision throws it away.

## Acceptance checks

- `weather Gadigal`, `weather Aotearoa`, `weather khan younis` and `weather westbank` resolve with no geocoding request.
- `weather <img src=x onerror=alert(1)>` prints an escaped not-found message.
- No line of the compact card is wider than 36 columns, and none of the wide card is wider than 72. At 320 px the page never scrolls sideways.
- `grep -r wttr.in dist` finds nothing.
- With the network throttled, the command ends within 25 s with a clear message, and Stop works at any point.

## Questions for the owner

- **Bare `weather`:** what should it do? Options are approximate IP location (proposed), the last place looked up, or printing help as today.
- **Names and labels:** how should the Indigenous names be labelled and spelled (for example "Gadigal Country · Sydney"), and which belong in the curated list?
- **Aotearoa:** should it point at Wellington or at the national centroid that wttr.in used?
- **Palestine entries:** where should "West Bank" point, and should every result with country code PS display as "Palestine", as the current mappings intend?
- **IP lookup and Nominatim:** may a bare `weather` send the visitor's IP to GeoJS, and may the Nominatim fallback be on by default? Both would be credited and documented.
- **Units:** should the default follow the browser locale, or always be metric with a one-tap °F chip?
- **Commercial use:** will vesen.app stay non-commercial? Open-Meteo's free tier and Nominatim's policy both assume it will.
