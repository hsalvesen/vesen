# In-house weather: reference design

> **How to read this file.** This is the full design that a three-way design panel produced and a judge synthesised for this workstream. It is the detailed reference: interfaces, file plan, steps and tests. Where it conflicts with the shared decisions in [../02-architecture-and-contracts.md](../02-architecture-and-contracts.md) or with the sequencing in [../05-weather.md](../05-weather.md), **those documents win**. Line numbers refer to `main` at commit 23758b9 (5 October 2026).

**Chosen approach:** In-house Open-Meteo weather in src/commands/weather: curated-first places, original ASCII cards whose layout CSS picks, tappable chips, and shared lib helpers — shipped in 3 PRs

## How it was chosen

- **Drop-in Open-Meteo weather module behind the existing `weather` command (3 small PRs you can deploy one at a time)** scored 8.2. Weights: feasibility 0.3, UX 0.3, maintainability 0.15, effort 0.1, risk 0.15. Sub-scores: feasibility 9, UX 7.5, maintainability 7.5, effort 9, risk 8.5.

Strengths:
- Its current-state claims hold up against the code: unencoded wttr.in fetch with no ok check (network.ts:47-50), substring error detection (:53), unescaped query echoed in HTML (:55, :105), phones cut to 7 lines (:69-79), the 10-regex painter (:85-95), the weather-only abort list (commands.ts:343), and the speedtest-only phase label (Input.svelte:624-627, history.ts:20).
- Its prototype exists at docs/plan/prototypes/weather/art.mts. I re-ran it against live Open-Meteo: wide output is at most 60 columns, compact at most 32, every art row is exactly 13 columns, and the XSS check passes.
- The static-import argument is correct. firebase.json:9-14 rewrites every path to index.html, so a lazily loaded chunk that a deploy removes comes back as HTML and the import fails.
- It ships in three PRs that can each be reverted, has the smallest effort, keeps all 14 Palestine keys, and uses a hand-rolled linked timeout that works on older WKWebView.

Weaknesses:
- Phones get no tap affordances: no chips and no Stop button. Without Ctrl+C, the only escape is the timeouts.
- The layout is picked by a viewport media query, not by the container width.
- It fetches imperial units from the API, so each unit system gets its own cache entry.
- The compact budget says 32 columns, but the place line may be 38.
- Nominatim is on by default with no way to switch it off.
- Colours follow the ANSI slots, and the default swamphen theme defines yellow as #ff4757 and blue as #f69154 (themes.json). The sun would draw red and rain orange.

- **Ports-and-adapters weather feature on a shared, typed TextDoc output model** scored 6.8. Weights: feasibility 0.3, UX 0.3, maintainability 0.15, effort 0.1, risk 0.15. Sub-scores: feasibility 7, UX 8, maintainability 7, effort 4, risk 5.5.

Strengths: best testing and engineering discipline of the three.
- An architecture import-rule test, a strict tsconfig for new folders only (the root is strict:false at tsconfig.json:15), and a script that re-records fixtures.
- Several ideas worth grafting: fetch metric once and convert in the browser, a `uk` unit preset, an `.sr-only` summary with aria-hidden art, detection of insecure contexts (the Docker image is served over http on :3000, docker-compose.yml:7), `reset` clearing saved weather state, silently using the device position when permission is already granted, and flagging that Umami receives typed arguments (Input.svelte:264-266, tracking.ts:9-14).

Weaknesses:
- Too big for a 5100-line app: about 35 files and 9 days.
- It invents shared contracts (TextDoc, CommandSpec, commandStatus, viewport.measureColumns) that belong to the code-arrangement, shell and mobile workstreams, which makes merge collisions likely.
- It lazy-loads the weather chunk, which fails after a deploy under the catch-all rewrite (firebase.json:9-14).
- Its Nominatim `featureType=settlement` filter is wrong. I checked it live: it returns [] for both Aotearoa and Boorloo, while without the filter Aotearoa resolves to New Zealand (-41.50, 172.83).
- Box-drawn day cards depend on glyph widths in a generic `monospace` font. That font is Courier on iOS, and Cascadia is never loaded (tailwind.config.js:7, History.svelte:28).
- `-u` means a units argument here, unlike wttr.in and the other designs.

- **Weather Card: curated-first place resolution, Open-Meteo data, original ASCII art, and one card that reflows by container width** scored 7.4. Weights: feasibility 0.3, UX 0.3, maintainability 0.15, effort 0.1, risk 0.15. Sub-scores: feasibility 7, UX 9, maintainability 7, effort 6, risk 6.

Strengths: the strongest UX for phones and Instagram.
- Tappable chips through `data-run`, a tappable cancel, `weather -` to return to the previous place, temperature range bars, and "Also:" alternatives you can tap.
- Per-theme colour-role overrides, which I confirmed are needed: swamphen's yellow is #ff4757 and its blue is #f69154 in themes.json.
- An auto-escaping html`` template helper in src/lib.
- Bare `weather` follows the `curl wttr.in` convention.
- It correctly flags the global click handler that focuses the input on every tap (Input.svelte:646-651) and the forced pre-wrap on <pre> (app.css:37-43).

Weaknesses:
- Feasibility and risk suffer because it reaches into App.svelte, History.svelte, Input.svelte, themes.json and theme.ts all at once. Those files also belong to the mobile, input and theme workstreams, and theme.ts holds the 2 existing svelte-check errors.
- Its range bars use ─ ━ • glyphs in aligned columns. With the generic monospace font (Courier on iOS) they may fall back to another font and break alignment on exactly the platform that matters.
- color-mix needs iOS 16.2 or later.
- The time-zone-guess fallback and the weighted ranking scorer add code for little gain.


Ideas grafted from the other candidates:

- From design 3: an auto-escaping html`` tagged template plus escapeHtml/raw in src/lib/html.ts. Every interpolation is escaped by default, and stock and curl can reuse it (F005).
- From design 3: shared src/lib/http.ts (fetchJson with a linked timeout and user abort, typed NetError, one retry) and src/lib/storage.ts (localStorage in try/catch with a memory fallback, TtlCache, in-flight de-duplication). These replace the weather-local sources.ts helpers from design 1 so stock can reuse them (F047, F065).
- From design 3: tappable chips (`<button data-run=...>` for °F/°C, 7 days, my location, alternatives, try again), executed through a single delegate in Input.svelte's existing window click handler.
- From design 3: a tappable Stop button on the loading row (App.svelte:87-91), elapsed seconds after 3 s, and Escape as an alias for Ctrl+C (F047).
- From design 3: `weather -` for the previous place, with recents (last 5) also feeding completion and did-you-mean.
- From design 3: temperature range bars, redrawn as CSS inline-block spans sized in ch with a gradient instead of box-drawing glyphs, so alignment does not depend on fonts the app does not load.
- From design 3: weather colour roles (--wx-sun, --wx-rain, ...) that fall back to theme slots, with optional per-theme overrides for swamphen, cassowary and petroica, whose yellow/blue slots are not yellow/blue (F068, partial).
- From design 3: a hidden `weather --legend` that prints every icon offline, for checking all 10 themes and the CRT modes.
- From design 3: the 'last word is a country' retry ('Paris France' becomes name=Paris&countryCode=FR) and the 'Gadigal Country' label wording, both subject to owner review.
- From design 3: bare `weather` means 'my weather', like `curl wttr.in`: device position if permission is already granted, then IP, then the last place, then help. Listed as an owner question.
- From designs 2 and 3: always fetch metric with forecast_days=7 and convert units and slice days in the browser, so one cache entry serves -u/-m/-d and the °F chip is instant.
- From design 2: a `uk` unit preset (°C with mph), locale defaults via Intl.Locale().maximize().region, and three WMO label tiers (long, medium of 16 characters or fewer, short of 8 or fewer).
- From design 2: a .sr-only one-sentence summary with aria-hidden art and layout blocks.
- From design 2: skip device geolocation when the page is not a secure context (the Docker image over http on :3000).
- From design 2: `reset` (commands.ts:116-141) and `weather --forget` clear saved weather state.
- From design 2: a fixture-recording script and an architecture test that keeps the weather core free of svelte, stores and DOM globals.
- From design 2: Nominatim behind a config switch the owner can turn off, called only on Enter.
- From designs 2 and 3: did-you-mean against curated names and recents, local only.
- From designs 2 and 3: --json and --oneline output plus toPlain(), ready for the shell workstream's pipes and redirection.
- From designs 2 and 3: a CSS container query (in ch, so it follows the active font size) that picks the compact or wide block, with an @supports fallback to a media query (F016, for weather output).
- Own correction, verified live today: Nominatim is queried WITHOUT featureType=settlement (which returns [] for Aotearoa and Boorloo) and results are filtered by an addresstype allowlist instead.

## Summary

I'd replace the wttr.in scrape (src/utils/commands/network.ts:9-110) with a self-contained command module in src/commands/weather/, plus three small shared helpers in src/lib/ that stock and curl can reuse.

Finding the place:
- A curated table is checked first, with no network call. It holds all 14 legacy Palestine keys (network.ts:17-32) plus spelling variants, and the Indigenous place names the site uses as examples (Gadigal, Aotearoa, Naarm, Meanjin, Boorloo, Tarntanya, nipaluna, Garramilla, Tāmaki Makaurau, Te Whanganui-a-Tara, Ōtautahi, Ōtepoti, Kirikiriroa).
- Then a cached lookup, then Open-Meteo place search (with a country or region qualifier, and a 'Paris France' retry), then a throttled, credited, cached OpenStreetMap Nominatim fallback.
- `lat,lon`, `--here`, `weather -` (previous place) and bare `weather` (device position if permission is already granted, else IP, else the last place, else help) cover the rest.

Data: one Open-Meteo forecast call, always metric, 7 days, timezone=auto. It is converted in the browser for -u, -m and --units uk, and cached for 10 minutes fresh and 6 hours stale-on-error, with identical in-flight requests sharing one call.

Rendering:
- No third-party text is regex-painted any more. Typed data becomes a view model, then lines of [role, text] segments, then one serializer that escapes everything (html``) and also produces plain text for --oneline, --json and future pipes.
- Each output carries a compact block (36 columns or fewer, fits 320 px) and a wide block (72 or fewer). A CSS container query shows whichever fits, so rotation and Instagram's toolbar changes reflow cards already on screen.
- Art is original, pure ASCII, 13x5. Range bars are CSS spans sized in ch. Colours are role variables that fall back to theme slots, with overrides for themes whose 'yellow' or 'blue' are not.

Phones: tappable chips (°F, 7 days, my location, alternatives, try again), a tappable Stop button and per-step loading labels. Every request has its own timeout and the whole command has an overall budget, so nothing can lock the terminal.

Rollout, each PR deployed through the existing Firebase preview and merge workflows:
- PR1 is the core swap.
- PR2 is smarter search and Nominatim.
- PR3 is location, chips and extras.

## Architecture

CURRENT STATE (verified by reading the files)
- network.ts:9-110 is the weather command.
  - Joins args with '+' (:10) and prints help when there are none (:12-14).
  - Palestine table at :17-32.
  - Fetches `https://wttr.in/${city}?ATm` without URL-encoding and with no response.ok check (:47-50).
  - Detects errors by matching substrings (:53).
  - Puts user input into HTML unescaped (:55, :105).
  - Phones keep only slice(0,7), chosen by isMobileDevice() when the command runs (:69-79, mobile.ts:9-14), so the forecast is dropped and the layout is frozen into history.
  - Ten chained regexes colour already-modified HTML (:85-95; F026).
  - Promise-constructor wrapper (:43-109; F066).
  - The cancelled block at :101 is duplicated at :205, :440, :604 and Input.svelte:124.
- Output is rendered with `{@html applyResponsiveWrapping(output)}` inside a `whitespace-pre` div (History.svelte:19-21). At 768 px or less it is wrapped in a pre-wrap/break-word div (textWrap.ts:29-37, :135-146).
- The font is the generic `monospace` (History.svelte:28; tailwind.config.js:7; Cascadia is never loaded), so iOS uses Courier. At 480 px or less it is 0.7rem (History.svelte:92-98), which leaves about 39 columns at 320 px and about 48 at 375 px.
- app.css:37-43 and :67-69 force pre-wrap and 12px on <pre> at 768 px or less, so the new output must never use <pre>.
- The abortable-command list is hard-coded at commands.ts:343, Input.svelte:207-209 and :295-297, and already contains 'weather'.
- Ctrl+C is the only cancel (Input.svelte:203-215), and the input is disabled while a command runs (:303-306).
- The loading label is phase-aware only for speedtest (Input.svelte:619-628; the store is history.ts:20).
- Every click focuses the input (Input.svelte:646-651).

MODULE LAYOUT (dependencies point downward only)

src/lib/ (shared, no Svelte, unit-tested):
- html.ts: escapeHtml (string-only, escapes & < > " '), the html`` tag returning SafeHtml, and raw() for compile-time constants only.
- http.ts: linkedTimeout (hand-rolled; never AbortSignal.any or AbortSignal.timeout, which older iOS WKWebView lacks), fetchJson (classifies offline, network, timeout, cancelled, http, rate-limited and parse failures; retries once on network errors or 5xx when at least 4 s of budget remain; never retries 4xx or an abort).
- storage.ts: safeStorage (try/catch with a memory fallback), TtlCache (fresh and stale TTLs, entry cap, versioned envelope), dedupe (in-flight promise map).

src/commands/weather/:
- Pure core (no fetch, DOM or Svelte imports; enforced by a test):
  - types.ts
  - args.ts (parseWeatherArgs)
  - wmo.ts (28 codes with 3 label tiers, ART 13x5 per icon with day and night variants, compass16)
  - units.ts (presets, conversions, defaultUnits from the locale, rounding that never shows -0)
  - places.ts (CURATED table, normaliseQuery, countryLabel with PS → 'Palestine', suggestNames)
  - render.ts (buildView, compact and wide line builders, toHtml, toPlain, errors and notes, chips)
- I/O layer: sources.ts
  - Open-Meteo forecast and geocoding.
  - Nominatim search and reverse, with a module-level ≥1100 ms throttle and an addresstype allowlist.
  - ipLocate (GeoJS, then ipinfo.io).
  - deviceLocate (permission probe, isSecureContext, our own wall-clock timer).
  - All through lib/http with injected fetch.
- Orchestration: resolve.ts (target → Place plus notes) and index.ts (runWeather, WEATHER_SPEC, and the legacy `weatherCommand(args, abortController)` adapter).
- Styles: weather.css, imported by index.ts as a side effect so the pure modules stay importable in Node.
- The module is imported statically. A lazy chunk could be deleted by a later deploy, and the catch-all rewrite (firebase.json:9-14) would then serve index.html for it, so the import would fail.

FLOW: `weather Gadigal -u`
1. parse gives {target: query 'Gadigal', units: imperial, days: 3, format: card}.
2. onPhase('Fetching forecast for Gadigal Country…').
3. Curated hit, no network: Place{name 'Gadigal Country', knownAs 'Sydney', region 'New South Wales', countryCode 'AU', lat -33.8698, lon 151.2083, source 'curated'}.
4. forecastCache key '-33.87,151.21'. On a miss, dedupe(fetchJson(Open-Meteo, 8 s timeout)), then parseForecast, then cache.
5. Push to recents.
6. buildView converts to °F/mph/in, slices 3 days, scales the bars across the shown days, and adds notes and chips.
7. renderWeather produces `<div class="wx"><div class="wx-sr">…</div><div class="wx-block wx-compact" aria-hidden="true">…</div><div class="wx-block wx-wide" aria-hidden="true">…</div>[<div class="wx-chips">…</div>]</div>` with no whitespace between tags, because the parent is white-space: pre.
8. onPhase(''), return {html, text, exitCode 0}.
9. The adapter returns html and calls playBeep() on exit 1 or 2 (not 130), as today.

RESOLUTION CHAINS
- query: normalise (NFKD, strip marks, lowercase, delete apostrophes/okina/colons, map + _ - to spaces, collapse whitespace), then:
  - curated[key]
  - geo cache (localStorage)
  - Open-Meteo search (name, count=10, language=en, plus countryCode when the qualifier is ISO2 or a country name known to Intl.DisplayNames; otherwise filter on an admin1/admin2/country prefix)
  - if empty and no comma, retry with the last word as a country
  - if still empty and NOMINATIM_ENABLED, Nominatim (limit=5, addresstype in city|town|village|hamlet|municipality|suburb|county|state|region|province|country|island|archipelago; a country result adds a 'country-level point' note)
  - else WeatherError not-found with suggestNames (Damerau-Levenshtein ≤2 against curated names and recents).
- Alternatives note: up to 2 other results with the same name in a different admin1 or country, only when population(alt) ≥ 10% of population(top).
- coords: /^@?(-?\d{1,2}(\.\d+)?),\s*(-?\d{1,3}(\.\d+)?)$/ with range checks; label '-33.87, 151.21' (PR3: reverse lookup through Nominatim when enabled).
- previous (`weather -`): recents[1], or recents[0] when only one exists; otherwise the no-previous error.
- here (`--here`): if not a secure context or geolocation is missing, fall back to IP with a note. Otherwise getCurrentPosition({enableHighAccuracy:false, maximumAge:600000}) raced against our own timer (8 s if permission is already 'granted', else 15 s) and the user signal. Round to 2 decimals before any network use. Reverse-label it. On denial or timeout, IP plus a note.
- none (bare `weather`, PR3): device only if permissions.query says 'granted' (never prompts), then ipLocate (memory cache 1 h, labelled approximate, never saved to recents), then the last explicit place (note 'last place'), then help (exit 0, same as today's network.ts:12-14) with chips.

CACHING
- forecast: memory TtlCache, fresh 10 min, stale up to 6 h on timeout/offline/5xx, max 20 entries.
- geo: localStorage key 'vesen.weather.v1' holding {v:1, geo:{key:{at, hit|null, src}}, recents:[≤5]}; hits 30 days, misses 1 h, cap 50.
- ip: memory 1 h.
- All storage goes through safeStorage, because Instagram WebViews may block or wipe it.

TIMEOUTS
- geocode 6 s; forecast 8 s plus one conditional retry; Nominatim 6 s; IP 4 s per provider; device 8 or 15 s.
- Hard overall budget of 25 s, linked to the Ctrl+C/Stop signal.
- A timeout is reported differently from a user cancel (timedOut flag).

RENDERING CONTRACT
- Every third-party or user string reaches HTML only through html``.
- Aligned columns use printable ASCII plus '°', which appears the same number of times in every row. Non-ASCII characters ('·', '…', '–', diacritics in names) appear only at line ends.
- Bars: `<span class="wx-bar" style="--a:20;--b:85;--n:46">` with integers only. width 10ch (wide) or 5ch (compact); a linear-gradient track; today's marker is ::after at calc(var(--n)*1%). toPlain draws them as ASCII ('--====----').
- Colours: classes .wx-<role> with color: var(--wx-<role>, var(--theme-<slot>)). Dim text uses foreground at opacity .7, never brightBlack/brightWhite. The theme store sets --wx-* only for themes with a `roles` override.
- CSS: `.wx{container:wx/inline-size}`; `.wx-block{white-space:pre;word-break:normal;overflow-wrap:normal;overflow-x:auto}`; `.wx-wide{display:none}`; `@container wx (min-width:74ch){.wx-wide{display:block}.wx-compact{display:none}}`; `@supports not (container-type:inline-size){@media (min-width:769px){…same…}}`; `.wx-chips{white-space:normal;display:flex;flex-wrap:wrap;gap:.5rem}`; `@media (pointer:coarse){.wx-chip{min-height:44px}}`; `.wx-sr` is visually hidden.

SHELL TOUCHPOINTS (small, kept compatible with the mobile and input workstreams)
- history.ts adds `commandPhase` (an alias of speedtestPhase), `cancelActive: writable<(() => void) | null>` and `runRequest: writable<string | null>`.
- Input.svelte:
  - Ctrl+C logic becomes abortCurrentCommand(); Escape is an alias.
  - The label shows `$commandPhase || 'Processing...'` plus ' · Ns' after 3 s.
  - The finally block resets the phase.
  - The Enter branch is extracted into submit(line).
  - The window click handler (:646-651) runs closest('[data-run]') through submit and does not focus the input.
  - The keydown handler ignores Enter when the target is a [data-run] button.
- App.svelte:87-91 shows a Stop <button> when $cancelActive is set.

## Key interfaces

```ts
// ===== src/lib/html.ts =====
export interface SafeHtml { readonly __html: string }
export type HtmlValue = string | number | SafeHtml | readonly SafeHtml[] | null | undefined | false;
export function escapeHtml(s: string): string;                  // & < > " ' ; no DOM
export function html(strings: TemplateStringsArray, ...values: HtmlValue[]): SafeHtml;
export function raw(trustedConstant: string): SafeHtml;          // literals only, never data
export function renderNotice(level: 'info' | 'warn' | 'error', text: string): SafeHtml;

// ===== src/lib/http.ts =====
export type NetFailure = 'offline' | 'network' | 'timeout' | 'cancelled' | 'http' | 'rate-limited' | 'parse';
export class NetError extends Error {
  constructor(readonly failure: NetFailure, readonly host: string, readonly status?: number, readonly reason?: string) { super(`${host}: ${failure}`); }
}
export function linkedTimeout(parent: AbortSignal | undefined, ms: number): { signal: AbortSignal; timedOut(): boolean; dispose(): void };
export interface FetchJsonOptions { signal?: AbortSignal; timeoutMs: number; retries?: 0 | 1; budgetLeftMs?: () => number;
  fetchImpl?: typeof fetch; isOnline?: () => boolean; }
export function fetchJson<T>(url: string, o: FetchJsonOptions, parse: (raw: unknown) => T): Promise<T>;   // throws NetError

// ===== src/lib/storage.ts =====
export interface KeyValueStore { get(k: string): string | null; set(k: string, v: string): void; remove(k: string): void }
export function safeStorage(kind: 'local' | 'session'): KeyValueStore;
export class TtlCache<T> {
  constructor(o: { ttlMs: number; staleMs?: number; max: number; store?: KeyValueStore; storageKey?: string; now?: () => number });
  get(key: string): { value: T; ageMs: number; stale: boolean } | null;
  set(key: string, value: T): void; clear(): void;
}
export function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T>;

// ===== src/commands/weather/types.ts =====
export type UnitSystem = 'metric' | 'imperial' | 'uk';
export type PlaceSource = 'curated' | 'open-meteo' | 'nominatim' | 'coords' | 'device' | 'ip' | 'recent';
export interface Place {
  id: string;               // 'cur:gadigal' | 'om:2147714' | 'osm:R556706' | 'pt:-33.87,151.21'
  name: string;             // shown first: 'Gadigal Country', 'Gaza', 'Oslo'
  knownAs?: string;         // 'Sydney'
  region?: string;          // admin1 / state / 'Gaza Strip' / 'West Bank'
  countryCode?: string;     // ISO-3166-1 alpha-2, upper-case
  country?: string;         // display, via countryLabel (PS -> 'Palestine')
  lat: number; lon: number;
  kind?: 'city' | 'region' | 'country' | 'point';
  source: PlaceSource;
  approximate?: boolean;    // ip -> '≈ … (approximate, from your network)'
  credit?: 'osm';
}
export interface CuratedPlace { keys: readonly string[]; name: string; knownAs?: string; region?: string;
  countryCode: string; lat: number; lon: number; suggest?: boolean; note?: string }
export type WeatherTarget =
  | { kind: 'none' } | { kind: 'here' } | { kind: 'previous' }
  | { kind: 'coords'; lat: number; lon: number }
  | { kind: 'query'; text: string; qualifier?: string };
export interface WeatherArgs { target: WeatherTarget; units: UnitSystem | null; days: number /*1..7, default 3*/;
  format: 'card' | 'oneline' | 'json' | 'legend'; forget: boolean }
export type ParseResult = { ok: true; args: WeatherArgs } | { ok: false; message: string };

type N = number | null;
export interface Current { time: string /*local YYYY-MM-DDTHH:mm*/; isDay: boolean; code: N; tempC: N; feelsC: N;
  humidity: N; precipMm: N; windKmh: N; gustKmh: N; windDeg: N }
export interface Daily { date: string /*local YYYY-MM-DD*/; code: N; minC: N; maxC: N; precipMm: N; precipProb: N;
  windMaxKmh: N; sunrise: string | null /*HH:mm*/; sunset: string | null; uvMax: N }
export interface Forecast { timezone: string; tzAbbrev: string; current: Current; daily: Daily[] /*7*/; fetchedAt: number }

export type Note =
  | { kind: 'approximate' } | { kind: 'last-place' } | { kind: 'country-point' }
  | { kind: 'stale'; ageMs: number; cause: 'offline' | 'timeout' | 'upstream' }
  | { kind: 'alternatives'; places: Place[] }
  | { kind: 'device-fallback'; reason: 'denied' | 'timeout' | 'unsupported' | 'insecure-context' };
export type WeatherErrorKind = 'usage' | 'not-found' | 'no-previous' | 'offline' | 'timeout' | 'rate-limited'
  | 'upstream' | 'parse' | 'cancelled';
export class WeatherError extends Error {
  constructor(public kind: WeatherErrorKind, message: string,
    public detail: { query?: string; host?: string; status?: number; reason?: string; suggestions?: string[] } = {}) { super(message); }
}
export interface WeatherDeps {          // all optional; defaults are browser globals; tests inject
  fetchImpl?: typeof fetch; storage?: KeyValueStore; geolocation?: Geolocation | null;
  permissions?: Permissions | null; isSecureContext?: boolean; isOnline?: () => boolean;
  now?: () => number; locales?: readonly string[];
  onPhase?: (label: string) => void;    // index.ts wires commandPhase.set
  chips?: boolean;                      // true once the runRequest executor exists (PR3)
}
export interface WeatherOutcome { html: string; text: string; exitCode: 0 | 1 | 2 | 130; status: 'ok' | 'help' | 'error' | 'cancelled' }

// ===== wmo.ts / units.ts =====
export type IconKey = 'clear' | 'partly' | 'cloudy' | 'fog' | 'drizzle' | 'rain' | 'heavyRain' | 'sleet' | 'snow' | 'heavySnow' | 'thunder' | 'unknown';
export interface WmoInfo { label: string; medium: string /*<=16*/; short: string /*<=8*/; icon: IconKey }
export type Role = 'head' | 'place' | 'cond' | 'temp' | 'wind' | 'pct' | 'mm' | 'dim' | 'warn' | 'err'
  | 'sun' | 'moon' | 'cloud' | 'rain' | 'snow' | 'bolt' | 'fog';
export type Seg = readonly [Role | null, string];
export type ArtRow = readonly Seg[];                         // text lengths sum to exactly 13, /^[\x20-\x7E]*$/
export function wmo(code: number | null): WmoInfo;
export function artFor(icon: IconKey, isDay: boolean): readonly ArtRow[];   // 5 rows
export function compass16(deg: number | null): string;
export function defaultUnits(locales: readonly string[]): UnitSystem;
export function convert(f: Forecast, u: UnitSystem): DisplayForecast;          // rounded, never -0

// ===== places.ts =====
export const CURATED: readonly CuratedPlace[];
export function normaliseQuery(q: string): string;     // 'Tāmaki-Makaurau' -> 'tamaki makaurau'; 'khan+younis' -> 'khan younis'
export function lookupCurated(normalised: string): Place | undefined;
export function countryLabel(cc?: string, providerName?: string | null): string | undefined;  // 'PS' -> 'Palestine'
export function countryCodeFor(word: string): string | undefined;                              // 'france'|'fr' -> 'FR'
export function suggestNames(normalised: string, extra: readonly string[], max?: number): string[];

// ===== resolve.ts / sources.ts =====
export interface Ctx { signal: AbortSignal; deps: Required<Pick<WeatherDeps, 'now' | 'onPhase'>> & WeatherDeps; budgetLeftMs(): number }
export function resolveTarget(t: WeatherTarget, ctx: Ctx): Promise<{ place: Place; notes: Note[] }>;   // throws WeatherError
export function getForecast(place: Place, ctx: Ctx): Promise<{ forecast: Forecast; stale?: Extract<Note, { kind: 'stale' }> }>;
export function omSearch(name: string, o: { countryCode?: string }, ctx: Ctx): Promise<Place[]>;
export function nominatimSearch(q: string, ctx: Ctx): Promise<Place[]>;
export function nominatimReverse(lat: number, lon: number, ctx: Ctx): Promise<Partial<Place> | null>;
export function ipLocate(ctx: Ctx): Promise<Place>;
export function deviceLocate(ctx: Ctx): Promise<{ lat: number; lon: number }>;   // own timer: 8 s granted / 15 s prompt

// ===== render.ts =====
export interface BarSeg { bar: { a: number; b: number; now?: number; cols: 5 | 10 } }   // integers 0..100
export type Line = readonly (Seg | BarSeg)[];
export interface Chip { label: string; command: string }   // command chars limited to [\p{L}\p{N} ,.'-] + flags, else coords form
export interface WeatherView { compact: Line[]; wide: Line[]; notes: Line[]; chips: Chip[]; srSummary: string;
  attribution: { osm: boolean } }
export function buildView(place: Place, f: Forecast, units: UnitSystem, days: number, notes: Note[], o: { chips: boolean }): WeatherView;
export function lineWidth(l: Line): number;   // bars count as their cols
export function toHtml(v: WeatherView): string;  // the only HTML serializer; uses html``
export function toPlain(lines: Line[]): string;
export function renderWeatherError(e: WeatherError): string;
export function renderCancelled(): string;      // 'Weather request cancelled' via renderNotice('warn', …)

// ===== index.ts =====
export function parseWeatherArgs(argv: readonly string[]): ParseResult;
export function runWeather(argv: readonly string[], signal?: AbortSignal, deps?: WeatherDeps): Promise<WeatherOutcome>;
export interface FlagSpec { short?: string; long: string; arg?: { name: string; values?: readonly string[] }; summary: string }
export const WEATHER_SPEC: { name: 'weather'; summary: string; synopsis: readonly string[]; flags: readonly FlagSpec[];
  examples: readonly string[]; cancellable: true; completePositional(prefix: string): string[] /* local only */ };
export function weatherCommand(args: string[], abortController?: AbortController): Promise<string>;   // registered in commands.ts
export function clearWeatherState(): void;     // --forget and `reset`

// ===== src/stores/history.ts additions =====
export const commandPhase: Writable<string>;                       // = speedtestPhase
export const cancelActive: Writable<(() => void) | null>;          // PR1, Stop button
export const runRequest: Writable<string | null>;                  // PR3, chips
```

## What the visitor sees

SYNOPSIS
- weather [place | "place, qualifier" | lat,lon] [-u|--imperial] [-m|--metric] [--units metric|imperial|uk] [-d N] [--json|--oneline]
- weather --here | weather - | weather --forget | weather --help
- `-u`/`-m` match wttr.in's u/m. Default units come from the browser locale (US gives °F, mph, in; GB gives °C, mph, mm; everyone else metric).
- Matching ignores case and accents and treats + _ - as spaces, so 'khan+younis', 'Tāmaki Makaurau' and 'tamaki makaurau' all work.

PLACES
- `weather Gadigal` gives 'Gadigal Country · Sydney' from the curated table with no search request.
- `weather Aotearoa` gives 'Aotearoa · Wellington' (point pending owner decision).
- `weather gaza`, `khan younis`, `khan yunis`, `west bank`, `westbank`, `bethlehem` and the rest give fixed points labelled '…, Palestine'. Any other place with country code PS is also labelled 'Palestine'.
- `weather Springfield` shows Missouri plus 'Also: Springfield, Illinois, US · Springfield, Massachusetts, US'.
- `weather Springfield, Illinois`, `weather Perth, AU` and `weather Paris France` all narrow the search.
- `weather -33.87,151.21` uses those coordinates directly.

COMPACT CARD (container under 74ch: phones, Instagram; every line 36 columns or fewer)
```
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
- The ▬ above stands for a CSS range bar 5ch wide, shaded from the cold to the hot role colour, with a tick for the current temperature on Today.
- Chips are 44 px buttons on touch screens (PR3).
- The forecast is now shown on phones; today's code dropped it (network.ts:69-79).

WIDE CARD (74ch or more; every line 72 columns or fewer)
```
Weather for Gadigal Country · Sydney, New South Wales, Australia

    \ | /       Clear sky
   - .-. -      17 °C (feels like 18 °C)
  -- (   ) --   NW 5 km/h, gusts 13 km/h
   - `-' -      Humidity 94% · Precip 0.0 mm
    / | \       UV 7.5 · Sunrise 06:26 · Sunset 19:01

Day        Low  Range       High  Rain        Wind     Conditions
Today      16°  ▬▬▬▬▬▬▬▬▬▬  26°    86% 1.6mm  23 km/h  Dense drizzle
Wed 07     14°  ▬▬▬▬▬▬▬▬▬▬  17°    82% 1.4mm  28 km/h  Light drizzle
Thu 08     12°  ▬▬▬▬▬▬▬▬▬▬  18°    48% 1.7mm  13 km/h  Light drizzle

Updated 08:00 GMT+11 · Weather data by Open-Meteo.com (CC BY 4.0)
```
- The layout switches live on rotation or resize, including for cards already in history.
- Copying picks up only the visible block. Screen readers get one sentence and the art is hidden from them.
- Colours follow the theme. The default swamphen theme gets an orange sun and cyan rain through role overrides, not its red 'yellow' slot.

LOADING AND CANCEL
- The spinner label shows the current step: 'Searching for “Springfield”…', 'Searching OpenStreetMap for …', 'Locating you (approximate)…', 'Waiting for location permission…', 'Fetching forecast for Gadigal Country…'. After 3 s it adds ' · 4s'.
- A Stop button appears beside the spinner (as does Escape on desktop). Ctrl+C, Stop and Escape all print the same 'Weather request cancelled' notice, with no beep.
- Each request times out on its own and the whole command has a 25 s cap.

NO PLACE (PR1: prints help as today. PR3:)
- If location permission was already granted, the device position is used silently.
- Otherwise an approximate IP location: '≈ Sydney, New South Wales, AU (approximate, from your network)' with a [use precise location] chip.
- Otherwise the last place you looked up.
- Otherwise help with [weather Gadigal] [weather Oslo] [weather Aotearoa] chips.
- No permission prompt appears unless you type --here.
- `--here` on denial, unsupported browsers, insecure pages or no answer (8 or 15 s) explains why and uses the approximate location, for example 'Instagram didn't share your location, so this uses an approximate network location. Open vesen.app in Safari or Chrome for a precise fix.'
- `weather -` returns to the previous place. `--forget` and `reset` clear saved places.

NOTES (dim or yellow lines under the card)
- 'Showing the forecast from 14 min ago (Open-Meteo unreachable)'
- 'Place search © OpenStreetMap contributors'
- 'Country-level point. Try a city for local weather.'
- 'Last place you looked up · weather --forget to clear'

ERRORS (beep and exit 1 or 2; all text escaped)
- `weather: no place called "Atlantis".` plus 'Did you mean: weather Aotearoa?' when within edit distance 2, plus 'Try a city, "City, Country" or lat,lon.'
- 'weather: you appear to be offline.'
- 'weather: Open-Meteo didn't answer within 8 s.' with [try again].
- 'weather: rate-limited by Open-Meteo (HTTP 429). Try again in a minute.'
- 'weather: Open-Meteo forecast error (HTTP 503)' plus the escaped reason.
- `weather: unknown option '--foo'. Try 'weather --help'.` (exit 2)
- 'weather: --days must be 1-7'
- 'weather: no previous place yet'
- The old self-XSS input `weather <img src=x onerror=alert(1)>` now prints an escaped not-found message.

EXTRAS (PR3)
- `--oneline`: 'Oslo, NO: clear sky, 12°C (feels 10°C), NW 14 km/h · today 6–14°C, 10% rain'
- `--json`: the normalised {place, forecast} as escaped text.
- `weather --legend` (hidden): every icon in the current theme.
- The suggestion row offers the curated examples, --here, recent places and flags after '-'. All local; there is no network type-ahead.

## Files

| Path | Purpose |
|---|---|
| `src/lib/html.ts` | NEW. escapeHtml (string replace, no DOM), html`` tagged template returning SafeHtml (escapes strings and numbers, flattens arrays, drops null/false/undefined), raw() for trusted constants, renderNotice(level, text) for the shared yellow/red bordered notice (same markup as network.ts:101, so later commands can drop their copies). |
| `src/lib/http.ts` | NEW. linkedTimeout(parent, ms) with a timedOut() flag and dispose(); fetchJson<T>(url, opts, parse) with NetError kinds offline/network/timeout/cancelled/http/rate-limited/parse, plus status, host and the Open-Meteo `reason`; one conditional retry; navigator.onLine pre-check; injected fetchImpl for tests. |
| `src/lib/storage.ts` | NEW. safeStorage('local'\|'session') with try/catch and a memory fallback; TtlCache<T> (fresh/stale TTL, max entries, versioned JSON envelope, injected now()); dedupe(key, fn) in-flight map. |
| `src/commands/weather/types.ts` | NEW. Place, CuratedPlace, WeatherTarget, WeatherArgs, Forecast/Current/Daily, Note, WeatherError, WeatherDeps, WeatherOutcome, Role, Seg, Line, WeatherView, WmoInfo, IconKey, UnitSystem. |
| `src/commands/weather/args.ts` | NEW. parseWeatherArgs: -m/--metric, -u/--imperial/--us, --units=metric\|imperial\|uk (and the space form), -d N/-dN/--days=N (1-7), --here, --forget, --json, --oneline, hidden --legend, '-' for previous, '--' to end options, coordinate tokens such as '-33.87,151.21' (never taken as flags), strips stray quotes (commands.ts:319 splits on whitespace), joins positionals with spaces, splits the qualifier at the first comma, caps at 100 characters and drops control characters. |
| `src/commands/weather/wmo.ts` | NEW. All 28 Open-Meteo WMO codes (0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99), each mapped to {label, medium ≤16, short ≤8, icon}; unknown codes fall back. ART is 12 icons plus clearNight and partlyNight, as [role, text] segments totalling exactly 13 printable-ASCII columns × 5 rows (start from docs/plan/prototypes/weather/art.mts, which was verified). compass16(). |
| `src/commands/weather/units.ts` | NEW. UNIT_PRESETS metric (°C, km/h, mm), imperial (°F, mph, in), uk (°C, mph, mm); conversions; round() that never shows -0; defaultUnits(locales) via Intl.Locale(..).maximize().region: US, LR and MM give imperial, GB gives uk, everything else metric. |
| `src/commands/weather/places.ts` | NEW. CURATED table: the 14 legacy Palestine keys plus variants (khan yunis, qalqilyah, al khalil, gaza city, gaza strip, occupied palestinian territories), all countryCode PS and displayed 'Palestine'; the Indigenous names with exact coordinates (owner review). Also normaliseQuery, countryLabel(cc, providerName) ({PS:'Palestine'} override, then Intl.DisplayNames, then the provider string), countryCodeFor(name), suggestNames(q, extra) and CURATED_SUGGEST for completion and chips. |
| `src/commands/weather/sources.ts` | NEW. omSearch, omForecast (URL builder plus a validating parseForecast), nominatimSearch and nominatimReverse (throttle ≥1100 ms, addresstype allowlist, credit 'osm', NOMINATIM_ENABLED switch), ipLocate (GeoJS, then ipinfo.io), deviceLocate (permissions.query in a try/catch, isSecureContext, our own timer, 2-decimal rounding). Also the config constants: endpoints, timeouts, TTLs. |
| `src/commands/weather/resolve.ts` | NEW. resolveTarget(target, ctx) implementing the query/coords/previous/here/none chains, the qualifier filter, the last-word-as-country retry, the alternatives rule and did-you-mean; recents read/write (IP places are never saved). |
| `src/commands/weather/render.ts` | NEW, pure. buildView (units, day labels from 'YYYY-MM-DD' through Date.UTC, a bar scale shared across shown days, fitted place labels, notes, chips, sr summary); compactLines (≤36 cols) and wideLines (≤72 cols); toHtml(lines) using html``; toPlain(lines); renderWeather, renderOneLine, renderJson, renderLegend, renderWeatherError, renderCancelled (text 'Weather request cancelled', via renderNotice). |
| `src/commands/weather/index.ts` | NEW. runWeather(argv, signal, deps) returning WeatherOutcome {html, text, exitCode, status}; WEATHER_SPEC (summary, synopsis, flags, examples, completePositional(prefix), which is local only and never calls the network); weatherCommand(args, abortController?) legacy adapter (beeps on exit 1/2); clearWeatherState(); `import './weather.css'`. |
| `src/commands/weather/weather.css` | NEW. .wx container query and @supports fallback, .wx-block (white-space:pre, no wrapping, overflow-x:auto), .wx-wide/.wx-compact toggling, .wx-sr, .wx-bar gradient and marker, .wx-chip (44 px on coarse pointers), and role classes .wx-head/place/cond/temp/wind/pct/mm/dim/warn/err/sun/moon/cloud/rain/snow/bolt/fog using var(--wx-<role>, var(--theme-<slot>)). |
| `src/commands/weather/__tests__/*.test.ts and __fixtures__/*.json` | NEW. Vitest suites (args, wmo/art, units, places, resolve, sources, render, runWeather, architecture rule) plus recorded fixtures: forecasts for Sydney, Oslo and Gaza (null country, Asia/Gaza) in 7-day metric; the 400 error body; geocode results for Oslo, Springfield, Khan Yunis (PS, country null), Bethlehem (PS ranked 4th) and an empty response; Nominatim Gadigal (city) and Aotearoa (country); GeoJS; ipinfo. |
| `scripts/record-weather-fixtures.sh` | NEW. Re-records the fixtures with curl (Origin and Referer headers; 1.2 s spacing for Nominatim). |
| `vitest.config.ts + package.json` | CHANGE. devDependency vitest ^2.1 (compatible with vite ^5.4); scripts "test": "vitest run" and "test:tz": "TZ=Pacific/Kiritimati vitest run render". No runtime dependencies added. |
| `.github/workflows/firebase-hosting-pull-request.yml (+ firebase-hosting-merge.yml)` | CHANGE line 16: `npm ci && npm test && npm run build`, so the preview channel used for Instagram testing only deploys when tests pass. |
| `src/utils/commands/network.ts` | CHANGE. Delete the weather entry (lines 9-110) and isMobileDevice from the import at line 6 (only weather used it, at :69). curl, stock and speedtest are untouched. |
| `src/utils/commands.ts` | CHANGE. Register `weather: weatherCommand` in the merged map (lines 458-465). In reset (lines 116-141), call clearWeatherState(). The abort list at :343 already includes weather. |
| `src/stores/history.ts` | CHANGE after line 20: `export const commandPhase = speedtestPhase;`, `export const cancelActive = writable<(() => void) \| null>(null);` (PR1), `export const runRequest = writable<string \| null>(null);` (PR3). |
| `src/components/Input.svelte` | CHANGE. PR1: extract abortCurrentCommand() from :203-215 and use it for Ctrl+C and Escape; set and clear cancelActive around abortable commands (:294-301, finally :338-357); the label at :619-628 shows `$commandPhase \|\| 'Processing...'` for every command plus ' · Ns' after 3 s; reset commandPhase in finally. PR3: extract the Enter branch (:254-357) into submit(line); the window onclick (:646-651) runs closest('[data-run]') through submit and does not focus the input; handleKeyDown ignores Enter on [data-run] targets; runRequest subscription. |
| `src/App.svelte` | CHANGE :87-91. Next to the spinner, a <button type=button class=stop-btn> labelled 'Stop' when $cancelActive is set (44 px tall on coarse pointers), calling the same abort as Ctrl+C. |
| `src/utils/helpTexts.ts` | CHANGE :25-31. New weather help keeping the Usage:/Examples:/Tip: markers that getCommandHelp splits on (commands.ts:378-380). Examples: Gadigal, Oslo, Aotearoa, 'Springfield, Illinois', -u Oslo, and --here in PR3. The tip covers data credits and privacy (IP lookup, 1 km rounding). Line :100 is unchanged. |
| `src/utils/commandSuggestions.ts` | CHANGE in PR3 at :9, :55-57 and :87-96. Use WEATHER_SPEC.examples plus 'weather --here'; after a typed '-', suggest flags; positional matches from CURATED_SUGGEST and recents (local only). |
| `themes.json + src/interfaces/theme.ts + src/stores/theme.ts` | CHANGE in PR2. Optional `roles` map (role to slot-name string) for swamphen {sun:'blue', rain:'cyan'}, cassowary {sun:'purple'} and petroica {rain:'yellow'}, finalised with `weather --legend`. Theme.roles?: Partial<Record<WxRole,string>> (string, not keyof, so the inferred JSON type still assigns). updateCSSVariables (theme.ts:8-29) sets or removes --wx-<role> after checking the slot exists. Must not add svelte-check errors (baseline is exactly 2, at theme.ts:71/:78). |
| `README.md` | CHANGE. Weather section: usage, data credits (Open-Meteo CC BY 4.0; © OpenStreetMap contributors, ODbL), privacy (IP lookup provider, device rounding, local-only recents). |

## External services

- Open-Meteo Forecast (only forecast provider). GET https://api.open-meteo.com/v1/forecast?latitude={lat:.4}&longitude={lon:.4}&current=temperature_2m,apparent_temperature,relative_humidity_2m,is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m,wind_gusts_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset,uv_index_max&timezone=auto&forecast_days=7. Always metric; the browser converts units and slices days. Keyless, CORS * (lead-verified), about 2 KB. Errors are HTTP 400 {error:true, reason}. Daily dates and current.time are local to the location. Terms: non-commercial, under 10,000 calls a day, CC BY 4.0 credit shown in every card. Timeout 8 s, one retry on network errors or 5xx.
- Open-Meteo Geocoding (primary search). GET https://geocoding-api.open-meteo.com/v1/search?name={q}&count=10&language=en&format=json[&countryCode={ISO2}]. CORS * (verified today with an Origin header). Verified quirks: a missing `results` key means no match; PS rows have country null ('Khan Yunis' gives PS/None/None); 'Bethlehem' ranks South Africa first and PS fourth, which is why it is curated; nothing comes back for Gadigal, Aotearoa, 'Khan Younis' or 'West Bank'. Timeout 6 s; results cached in localStorage for 30 days, misses for 1 h.
- Curated in-repo table (no network): the 14 legacy Palestine keys plus variants and the Indigenous names. Answers deterministically and offline for the site's examples.
- Nominatim / OpenStreetMap (fallback search after an Open-Meteo miss; reverse lookup for --here and lat,lon). GET https://nominatim.openstreetmap.org/search?q={q}&format=jsonv2&limit=5&addressdetails=1&accept-language=en and /reverse?lat={2dp}&lon={2dp}&format=jsonv2&zoom=10&accept-language=en. CORS * (verified). Verified today: featureType=settlement returns [] for Aotearoa and Boorloo, so we do NOT pass it. We filter on addresstype instead. Without the filter, Aotearoa resolves to 'New Zealand' (country, -41.500, 172.8344) and Gadigal to Sydney (city). Usage policy: at most 1 request per second (module throttle ≥1100 ms), the browser's default Referer identifies the app (never set no-referrer), results cached (30 days, misses 1 h), '© OpenStreetMap contributors' shown whenever used, never called from typing, Tab, suggestions or completion. NOMINATIM_ENABLED switch. Timeout 6 s.
- GeoJS IP location (bare `weather` and the --here fallback only). GET https://get.geojs.io/v1/ip/geo.json returns latitude and longitude as strings, plus city, region, country_code and timezone. CORS * (verified). Timeout 4 s; memory cache 1 h; rounded to 0.01°.
- ipinfo.io (secondary IP lookup). GET https://ipinfo.io/json returns {city, region, country, loc:'lat,lon'}. CORS * (design 3 verified). Free allowance without a token. Timeout 4 s. ipwho.is (CORS * verified today) is the drop-in alternative. Rejected: ipapi.co (429) and speed.cloudflare.com/meta (403).
- Browser Geolocation (only for --here, or silently when navigator.permissions reports 'granted'). getCurrentPosition({enableHighAccuracy:false, maximumAge:600000}) raced against our own timer, because PositionOptions.timeout ignores time spent on the permission prompt and Instagram's Android WebView may never call back. Requires isSecureContext (true on www.vesen.app; false for the Docker image over http on :3000 except on localhost). Rounded to 2 decimals before any request.
- Browser Intl: DisplayNames('en', {type:'region'}) for country names (with the PS override); Locale(navigator.languages[0]).maximize().region for default units. Both are in TS lib es2020.intl; tsconfig.json:6 is ES2020.

## Steps

1. PR1-1 (0.25 d) Tooling.
- Add vitest ^2.1, vitest.config.ts (node environment) and the scripts `test` and `test:tz`.
- Add `npm test` before `npm run build` in firebase-hosting-pull-request.yml:16 and the merge workflow.
- Record baselines: svelte-check exactly 2 errors (theme.ts:71/:78), vite build 142.85 kB JS / 48.7 kB gzip.
2. PR1-2 (0.5 d) Shared helpers: src/lib/html.ts (escapeHtml, html``, raw, renderNotice), src/lib/http.ts (linkedTimeout, fetchJson, NetError), src/lib/storage.ts (safeStorage, TtlCache, dedupe), with unit tests. Lays the groundwork for F005 (escape by default), F047 (timeouts) and F065 (cache and de-duplication); stock and curl adopt them in their own workstreams.
3. PR1-3 (0.5 d) Pure core.
- types.ts.
- wmo.ts: 28 codes, three label tiers, ART ported from the verified docs/plan/prototypes/weather/art.mts, compass16.
- units.ts: presets, conversions, defaultUnits.
- places.ts: the CURATED table with all 14 legacy Palestine keys plus variants and the Indigenous names; normaliseQuery; countryLabel with PS → 'Palestine'; suggestNames.
- Write the table-driven tests first: art 5×13 printable ASCII, every code mapped, every legacy key from network.ts:17-32 resolves with country 'Palestine'.
4. PR1-4 (0.5 d) sources.ts (Open-Meteo forecast and geocoding only) and resolve.ts.
- Resolution order: coords, then curated, then geo cache, then Open-Meteo (ISO2 qualifier as countryCode, otherwise admin1/country prefix filter), then not-found.
- getForecast: forecast_days=7, metric, memory TtlCache 10 min fresh / 6 h stale, dedupe, 8 s timeout plus a conditional retry.
- Fixture-driven tests. Resolves F060 (core) and F065 (weather part).
5. PR1-5 (0.75 d) render.ts and weather.css.
- buildView, compact (≤36) and wide (≤72) lines, CSS range bars, sr summary, notes, escaped errors, renderCancelled.
- toHtml (html`` only, no whitespace between tags) and toPlain.
- .wx container query with @supports fallback; .wx-block white-space:pre and never a <pre> (avoids app.css:37-43 and :67-69); role classes with var(--wx-role, var(--theme-slot)) fallbacks; dim text as foreground at opacity .7.
- Resolves F026 (the regex painter is deleted), F005 (weather path: every third-party and user string is escaped) and F016 (weather output: layout chosen by CSS at display time, not by isMobileDevice() at run time).
6. PR1-6 (0.25 d) index.ts.
- parseWeatherArgs (place, coords, -m/-u/--units, -d, --help still intercepted at commands.ts:321/336).
- runWeather as plain async (no Promise constructor) with typed WeatherError mapped to exit codes 0/1/2/130.
- weatherCommand adapter (beep on exit 1/2, none on 130).
- A bare `weather` still returns help in PR1, preserving network.ts:12-14.
- Resolves F066 for weather.
7. PR1-7 (0.5 d) Wiring.
- Delete network.ts:9-110 and isMobileDevice from network.ts:6.
- Register `weather: weatherCommand` in commands.ts:458-465.
- Add commandPhase and cancelActive to history.ts.
- Input.svelte:
  - abortCurrentCommand() extracted from :203-215, with Escape as an alias.
  - Set and clear cancelActive around abortable commands (:294-301, :338-357).
  - The label at :619-628 shows `$commandPhase || 'Processing...'` for every command plus elapsed seconds after 3 s.
  - Reset the phase in finally.
- App.svelte:87-91: Stop button.
- helpTexts.ts:25-31: new help keeping the Usage/Examples/Tip markers (commands.ts:378-380).
- Resolves F047 for weather (every request bounded, plus a tappable Stop for all abortable commands).
8. PR1-8 (0.25 d) Verify.
- npm test and test:tz pass; svelte-check still exactly 2 errors; build grows by no more than about 6 kB gzip; `grep -r wttr.in dist` is empty.
- QA on the PR preview channel: desktop Chrome, Firefox and Safari; iPhone at 320/375/414 px portrait and landscape; Android Chrome; Instagram in-app browser on iOS and Android (DM the preview link to yourself).
- Merge to deploy.
9. PR2-9 (0.5 d) Search quality: last-word-as-country retry ('Paris France'), the Also: alternatives note (population ≥10% rule), did-you-mean from curated names and recents, and the geo cache in localStorage 'vesen.weather.v1' (hits 30 days, misses 1 h, cap 50, safeStorage).
10. PR2-10 (0.5 d) Nominatim fallback behind NOMINATIM_ENABLED.
- Called only after an Open-Meteo miss on Enter; ≥1100 ms throttle; no featureType (verified to drop Aotearoa and Boorloo), filtered by an addresstype allowlist; a country result adds the country-point note.
- OSM credit line; cached.
- Tests with fake timers for the throttle.
11. PR2-11 (0.25 d) Theme roles and legend.
- Optional `roles` in themes.json for swamphen {sun:'blue', rain:'cyan'}, cassowary {sun:'purple'} and petroica {rain:'yellow'}.
- Theme.roles?: Partial<Record<WxRole,string>>; updateCSSVariables (theme.ts:8-29) sets or removes --wx-*.
- Hidden `weather --legend` for checking all 10 themes and the CRT modes; tune the overrides, including cockatoo's 1.6:1 sun.
- Keep svelte-check at exactly 2 errors. Resolves F068 for weather (no brightBlack/brightWhite text; roles ready for the theme workstream's semantic tokens).
12. PR3-12 (0.5 d) Location.
- Bare `weather` chain: granted device, then ipLocate (GeoJS, then ipinfo.io), then last place, then help with chips.
- `--here`: secure-context check, permission probe, own 8/15 s timer, 2-decimal rounding, Nominatim reverse label, IP fallback with a reason note.
- Recents (last 5, never IP) and `weather -`.
- `--forget`; clearWeatherState() called from reset (commands.ts:116-141).
13. PR3-13 (0.5 d) Chips.
- runRequest store; Input.svelte Enter branch (:254-357) extracted into submit(line).
- The window onclick (:646-651) runs closest('[data-run]') through submit without focusing the input; handleKeyDown ignores Enter on [data-run] targets.
- Weather passes deps.chips=true and renders [°F/°C], [7 days], [my location], alternatives and [try again]. Chip commands use canonical names restricted to [\p{L}\p{N} ,.'-], otherwise the coordinate form.
- Coordinate with the mobile workstream so the suggestion row reuses the same executor.
14. PR3-14 (0.25 d) WEATHER_SPEC drives commandSuggestions.ts:9, :55-57 and :87-96 (examples, --here, recents, flags after '-'; local only) and is exposed for the completion workstream's Tab engine. Add --oneline and --json (toPlain/JSON, ready for pipes).
15. PR3-15 (0.25 d) Docs and QA.
- README weather section: credits (Open-Meteo CC BY 4.0, © OpenStreetMap contributors ODbL) and privacy (IP provider, rounding, local-only recents).
- Repeat the Instagram iOS and Android matrix: --here allow, deny and ignore; airplane mode; chip taps keep the keyboard down; Stop during a slow request; rotation with cards on screen.

## Testing

UNIT TESTS (Vitest, Node environment, fetch, storage, geolocation and clock injected; no DOM in the core)
- lib/html: escapes & < > " ' in text and attributes; arrays flatten; null and false drop; raw passes through; '<img src=x onerror=alert(1)>' never appears unescaped.
- lib/http:
  - A user abort gives 'cancelled' and a timeout gives 'timeout', even when both fire within 1 ms of each other.
  - Works with AbortSignal.any deleted.
  - 503 retried once when budget remains; 404 and 429 not retried (429 becomes 'rate-limited').
  - An HTML body gives 'parse'.
  - navigator.onLine false gives 'offline'.
- lib/storage: a localStorage that throws on every call falls back to memory; TTL fresh and stale ages; cap eviction; a version mismatch is ignored; dedupe shares one promise.
- args:
  - Flags in any order; -d2, -d 2 and --days=2 all work.
  - -d 0, -d 8 and '-d ten' are usage errors; an unknown flag is a usage error (exit 2).
  - '-33.87,151.21' and '@-33.87,151.21' are coordinates, and '-33.87,' '151.21' joins into coordinates.
  - '-' means previous; '--' ends options.
  - '"Springfield, IL"' gives text Springfield with qualifier IL; a 101-character query is rejected.
- wmo and art: every documented code maps and 42 is 'unknown'; medium labels ≤16 and short ≤8; every icon and night variant is 5 rows with segments summing to 13, matching /^[\x20-\x7E]*$/; compass16 gives 0→N, 11.24→N, 11.26→NNE, 359→N, -10→N.
- units: 0°C is 32°F; -0.4 rounds to 0, never -0; km/h to mph; mm to in; defaultUnits for en-US, en-GB, en-AU, my-MM, plain 'en' (imperial, documented) and garbage input (metric).
- places:
  - Every network.ts:17-32 key (including 'west+bank' and 'khan+younis') resolves with countryCode PS and country 'Palestine'.
  - Curated keys are unique after normalising, and all latitudes and longitudes are in range.
  - normaliseQuery('Tāmaki-Makaurau') is 'tamaki makaurau'.
  - countryLabel('PS', null) is 'Palestine'.
  - suggestNames('aoteroa') returns Aotearoa.
- resolve, with fixtures and a stubbed fetch:
  - Curated hits make 0 requests; Open-Meteo hits make 1, and the second lookup comes from cache.
  - Bethlehem resolves to the curated Palestine point; 'Khan Yunis' with null country is labelled Palestine.
  - 'Paris France' retries with countryCode=FR.
  - Springfield yields alternatives; Oslo does not.
  - An Open-Meteo miss goes to Nominatim only when enabled, sets credit 'osm', and filters out a road result.
  - Two Nominatim calls are at least 1100 ms apart (fake timers).
  - Not-found carries suggestions.
- Location chain:
  - permission 'prompt' never calls getCurrentPosition for bare `weather`.
  - 'granted' uses the device; coordinates are rounded before the first URL is built.
  - --here denial, insecure context, and a callback that never fires (cut off by our timer, fake timers) all fall back to IP with the right note.
  - GeoJS failure falls back to ipinfo; both failing falls back to the last place, then help.
  - IP places are never saved to recents.
- render:
  - For every forecast fixture × {metric, imperial, uk} × days {1, 3, 7} × a 60-character place name, every compact toPlain line is ≤36 and every wide line ≤72.
  - Exactly one current-temperature marker on Today.
  - No '\n' between block tags; the bar style attribute contains only integers.
  - Null fields render '-'; imperial shows 'mph', never 'mp/h'.
  - Day labels come from Date.UTC: `npm run test:tz` under TZ=Pacific/Kiritimati gives the same weekdays.
  - Snapshot tests of compact and wide toPlain for Gadigal, Gaza and Oslo.
- runWeather orchestration:
  - An 8 s stall gives exit 1 with the timeout message.
  - Abort gives exit 130, the cancelled text and no beep.
  - A failed refresh with a 10-minute-old cache entry gives exit 0 with the stale note.
  - onPhase always ends with ''.
  - Bare `weather` gives status 'help' in PR1.
  - The `<img onerror>` query regression is escaped.
- Architecture: files under src/commands/weather except sources.ts and index.ts import nothing matching /svelte|stores|window\.|document\.|navigator\./.

GATES: npm test (CI on the PR workflow), npx svelte-check stays at exactly 2 errors, vite build succeeds with ≤6 kB gzip growth, and `wttr.in` is absent from dist.

MANUAL / DEVICE MATRIX
- Browsers: desktop Chrome, Firefox and Safari at 1280 and 800 px; iOS Safari 16 and 17+ at 320/375/414 px, portrait and landscape (check the ch-based container query on iOS 16); Android Chrome at 360 px.
- Instagram in-app browser on iOS (WKWebView) and Android (WebView), opened from the profile link or a DM of the preview URL. Run weather Gadigal, Aotearoa, gaza, khan younis, 'Springfield, Illinois', -u Oslo, bare weather, and --here (allow, deny, ignore).
- Network conditions: airplane mode; DevTools offline with and without cache; Slow 3G to exercise the Stop button and elapsed seconds; blocking each host to exercise each fallback.
- Appearance: rotation with cards on screen; no horizontal page scroll (scrollWidth ≤ clientWidth); chip taps do not raise the keyboard; `weather --legend` across all 10 themes and the 3 CRT modes; VoiceOver reads the summary sentence, not the art.
- Sanity check: temperatures compared with wttr.in for the same coordinates.

## Risks

- Single forecast provider. If Open-Meteo is down or rate-limits, only the in-session stale cache (≤6 h) helps. Its free tier is non-commercial, under 10,000 calls a day, with CC BY credit. Calls go out from each visitor's browser, so the limits apply per visitor IP. A commercial pivot needs their paid key, which only changes the sources.ts config.
- Nominatim policy. At most 1 request per second, no autocomplete, credit and caching required, and heavy users get blocked. Mitigations: called only on Enter after the curated, cache and Open-Meteo steps miss; a ≥1100 ms per-tab throttle; misses cached 1 h; the credit line; a switch to turn it off. Browsers cannot set a User-Agent, so we rely on the default Referer. Any future `no-referrer` meta or header would break this.
- Privacy. Bare `weather` sends the visitor's IP to GeoJS or ipinfo.io. Typed place names already reach Umami when tracking is on (Input.svelte:264-266, tracking.ts:9-14). Mitigations: IP lookup only for bare `weather` or the --here fallback; labelled approximate; never saved; device coordinates rounded to 2 decimals before any request and never written into the command line. Disclosed in help and the README. Redacting arguments from analytics is an owner decision.
- Instagram in-app browsers. Android WebViews may never deliver the permission callback; iOS may show Instagram's prompt then the site's; storage can be wiped; the language may follow the app, so default units can be wrong. Mitigations: our own wall-clock timers, the IP fallback with an explanation, safeStorage with a memory fallback, a one-tap °F/°C chip, and the Stop button.
- Fonts and alignment. Output uses the generic monospace (Courier on iOS; Cascadia is never loaded per tailwind.config.js:7 and History.svelte:28). Mitigations: aligned columns are ASCII plus '°' only; bars are CSS spans sized in ch, not glyphs; non-ASCII characters appear only at line ends. Loading Cascadia belongs to the UI workstream.
- Container queries in ch need iOS 16 or later or Chromium 105 or later. Older engines take the @supports fallback, a viewport media query at 769 px. If ch-based container conditions misbehave on iOS 16 WebKit in QA, switch the threshold to rem. The default CSS shows the compact block, so the worst case is compact everywhere, never nothing.
- The global mobile wrapper (textWrap.ts:29-37, pre-wrap with break-word) and app.css:37-43 still exist. Weather opts out locally with .wx-block white-space:pre and no <pre>. A later global rule targeting divs could regress this; the width tests plus device QA cover it.
- Cross-workstream overlap. Input.svelte (submit extraction, abort refactor, click delegate), App.svelte (Stop), history.ts stores and theme.ts roles are also touched by the input, mobile, code-arrangement and theme (F068) workstreams. Mitigations: minimal, separately reviewable edits; weather depends only on three small stores and the --wx-* fallbacks, so a different final contract changes one adapter.
- Chips re-run command lines. Once the shell workstream adds `;`, pipes or redirection, an unsanitised place name inside data-run could inject extra commands. Mitigation: chip commands are built only from canonical names matching [\p{L}\p{N} ,.'-] plus known flags, otherwise the coordinate form, and are escaped as attributes.
- Cultural and political labels. 'Gadigal Country', the Aotearoa point, the West Bank point and the 'Palestine' override for every PS result are editorial choices. Coordinates visibly change from wttr.in's for Aotearoa (centroid -41.50, 172.83 to Wellington, if chosen) and West Bank.
- Behaviour change in PR3: bare `weather` stops printing help (network.ts:12-14). It ships separately and can be reverted alone; help is still printed when no location can be found.
- Bundle growth. A static import adds about 5-6 kB gzip to the 48.7 kB main chunk. It is accepted, because a lazy chunk would fail after deploys under the firebase.json:9-14 catch-all rewrite.
- theme.ts already has 2 svelte-check errors (link.sizes). Editing updateCSSVariables must not add any. Typing roles as string, not keyof, avoids a JSON inference error.

## Effort

About 6 engineer-days (range 5-7):
- PR1, the core swap: 3.5 d. Tooling 0.25, lib helpers 0.5, pure core 0.5, sources and resolve 0.5, render and CSS 0.75, index and args 0.25, wiring with Stop and phase 0.5, verification and device QA 0.25.
- PR2, search, Nominatim and theme roles: 1.25 d.
- PR3, location chain, --here, recents, chips executor, spec and suggestions, --json/--oneline, docs and Instagram QA: 1.5 d.
- Add 0.5 d if the input or mobile workstream has not yet extracted Input.svelte's submit path and weather has to do it first.
- No runtime dependencies are added. vitest is dev-only.

## Trade-offs

- **Design 1's small module and phased PRs, not design 2's 35-file ports-and-adapters build.** The pure core is still testable in Node and the I/O sits behind injected deps. Shared pieces stop at three tiny lib files rather than inventing TextDoc or CommandSpec contracts that other workstreams own.
- **Curated table first, then Open-Meteo, then Nominatim.** The showcased Indigenous and Palestine names resolve instantly, offline and the same way every time. The cost is a hand-maintained, culturally sensitive table.
- **Metric fetched once for 7 days and converted in the browser.** One cache entry serves every unit system and day count, and the °F chip is instant. The cost is owning the conversions; rounding may differ by 1 from Open-Meteo's own imperial output.
- **Both layouts rendered, with a CSS container query choosing.** Cards in history reflow on rotation, and there is no run-time width sniffing (F016). The cost is roughly double the markup per output, which is negligible.
- **CSS range bars instead of glyph bars.** They look like iOS Weather and can't misalign under Courier. The cost is that copied text loses the bar (toPlain draws ASCII bars for --oneline and pipes).
- **Chips execute immediately.** Fast on phones, and the echoed command still teaches the syntax. It is slightly less terminal-pure, and it needs the submit extraction in Input.svelte.
- **Bare `weather` means 'my weather', like curl wttr.in**, with a silent device position only when permission was already granted. It never surprises the user with a prompt; the cost is an IP lookup by a third party, which is disclosed.
- **Static import** (about 5-6 kB in the main chunk) instead of lazy loading, because of the Firebase catch-all rewrite.
- **Left out**: the time-zone-guess fallback, design 3's weighted ranking scorer, `-n` pick, `--compact`/`--wide` forcing, a second forecast provider, hourly view and alerts. Fewer moving parts. The `-f` force-layout flag from F060 can be added later if users ask.
- **Duplicated cancelled notices in curl, stock and speedtest, and the hard-coded abort lists** (commands.ts:343, Input.svelte:207, :295) stay for the code-arrangement workstream. renderNotice in src/lib/html.ts is ready for them to adopt.

## Open questions raised by this design

- What should bare `weather` do (from PR3)? The options are: the visitor's approximate location from IP, like `curl wttr.in` (proposed); the last place they looked up; or keep printing help as today.
- How should the Indigenous names be labelled and spelled? For example 'Gadigal Country · Sydney', 'Gadigal (Sydney)' or 'Eora'. Should diacritics show (Tāmaki Makaurau, Ōtautahi)? Which names should be in the curated list, and should contested names (such as the Canberra-area ones) stay out?
- Where should `weather Aotearoa` point? Options are Wellington, the capital (proposed), or the New Zealand centroid at -41.50, 172.83 that wttr.in used, which gives inland mountain weather.
- For the Palestine entries: should 'West Bank' point at Ramallah or a regional centroid? Should Gaza-area places carry a 'Gaza Strip' region label? Should every geocoder result with country code PS display as 'Palestine', which is what the current mappings intend?
- Are you comfortable sending the visitor's IP to GeoJS (and ipinfo.io as backup) for bare `weather`, and enabling the OpenStreetMap Nominatim fallback by default? Both are credited and documented.
- Umami tracking sends every command's arguments, including typed place names and coordinates (Input.svelte:264-266). Should weather arguments be redacted or dropped there?
- Should the default units follow the browser locale (US gets °F; UK gets °C with mph), or always be metric with a one-tap °F chip?
- Should the forecast show 3 rows including today (matching wttr.in, proposed), or today plus the next 3 days?
- Should a tapped chip run its command immediately (proposed), or only fill the input so the visitor presses Enter? The mobile workstream's suggestion row should behave the same way.
- Can themes.json gain an optional `roles` override now (an orange sun and cyan rain on the default swamphen theme, whose 'yellow' slot is #ff4757)? Or should weather wait for the theme workstream's semantic colour tokens?
- Will vesen.app stay non-commercial? Open-Meteo's free API and Nominatim's policy both assume it is.
- Should the module live at src/commands/weather/ (proposed, matching F060), or does the code-arrangement workstream prefer another layout?
