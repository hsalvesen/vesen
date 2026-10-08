# Architecture and shared contracts

Six design panels each solved one workstream well, but they overlapped. Between them they defined five versions of `CommandSpec`, two lexers in the same file, three completion engines, three phone docks, four HTML escapers, four storage wrappers and five owners for "a command is running". This document makes one decision for each of those overlaps. Land it as a types-only pull request plus a one-page architecture decision record before any workstream starts writing code against it.

When a reference design in [designs/](designs/) disagrees with this file, this file wins.

> **Amended during the build.** [ADR 0001](../adr/0001-architecture.md) records every change made to these contracts while they were built; where it and this file disagree, the ADR wins. The two amendments that change a contract below, the command deadline and the lazy catalogue, are folded in here, each marked *Amended*. [STATUS.md](STATUS.md) lists the other deviations from the plan.

## Target module layout

The layout follows the shell design, with two additions: `lib/` for framework-free libraries such as the QR encoder, and `ui/components/` for the rich cards that weather, stock and QR render.

```text
src/
  main.ts                     calls app/bootstrap.ts, then mounts App
  app/bootstrap.ts            composition root: the only place concrete services are built
  shell/                      DOM-free kernel (no window, document, localStorage or svelte imports)
    lexer.ts parser.ts ast.ts expand.ts glob.ts histexpand.ts alias.ts arith.ts
    executor.ts streams.ts flags.ts registry.ts help.ts prompt.ts session.ts types.ts
    complete/                 engine, context, sources, match, tab, ghost, chips
    editor/                   keymap, readline ops, history store, normalise
  output/                     DOM-free: Span and Block model, builders, sgr, markup, plain, escape
  vfs/                        Vfs class, path, seed, special (/proc, /dev, /usr/bin), persist
  services/                   net, storage, storage-keys, sysinfo, appearance, opener, clipboard,
                              bell, analytics, clock, weather/, market/
  platform/                   env (touch, in-app, reduced motion, save-data), viewport, measure, head, perf
  lib/                        framework-free libraries: qr/ (encoder and renderers), colour
  stores/                     screen, term, theme, cathode, prefs (pure state, no DOM side effects)
  ui/                         Terminal, Transcript, Entry, OutputView, SpanView, Prompt, LineEditor,
                              StatusLine, CompletionRow, dock/ (Dock, ChipRow, KeyBar, HistorySheet),
                              components/ (WeatherCard, QuoteCard, QuoteTable, QrCard, LinkCard),
                              apps/ (Pager, Editor, Shutdown, QrPresenter, Matrix)
  commands/<category>/<name>.ts   one CommandSpec per file, auto-registered (the core, loaded with the kernel)
  commands/more/<category>/<name>.ts   the catalogue: specs in one lazy chunk, loaded after the kernel
  content/                    owner documents in {colour} markup (README.vt, history.vt, linux.vt)
  styles/                     tokens.css, terminal.css, crt.css
worker/stock/                 Cloudflare Worker for stock quotes (separate deployable)
e2e/                          Playwright specs
scripts/                      check-boundaries, check-bundle, check-contrast, convert-content, icons, og
```

**Dependency rule.** `ui/` and `stores/` may import anything below them. `commands/` may import `shell/`, `output/` and `vfs/` types and service interfaces only. `shell/`, `output/`, `vfs/`, `lib/` and `commands/` must not reference `window`, `document`, `navigator`, `localStorage` or `svelte`. Only `services/` and `platform/` touch browser APIs. A zero-dependency `scripts/check-boundaries.mjs` enforces this in CI, and these folders compile under a strict `tsconfig.strict.json` from day one.

**No import-time side effects.** The banner, theme application, favicon, storage migration and CRT classes all move into `bootstrap()`. This is what fixes the blank page when storage is blocked (F001) and makes the stores testable.

## 1. One command specification

```ts
// src/shell/types.ts
export type Category = 'portfolio' | 'files' | 'text' | 'shell' | 'system' | 'network' | 'fun' | 'editor';
export type ExitCode = number; // 0 ok, 1 error, 2 usage, 126 denied, 127 not found, 130 ^C, 141 broken pipe

export type ValueSource =
  | { kind: 'path'; accept?: 'any' | 'file' | 'dir' | 'exec'; includeParent?: boolean }
  | { kind: 'command' }                                     // help, man, which
  | { kind: 'commandLine' }                                 // sudo, time: the rest is a nested line
  | { kind: 'enum'; values: () => readonly EnumValue[]; caseInsensitive?: boolean }
  | { kind: 'examples'; caseInsensitive?: boolean; fromHistory?: boolean }
  | { kind: 'var' | 'alias' | 'user' | 'host' | 'url' | 'int' }
  | { kind: 'free'; placeholder: string };                  // shown dim, never accepted
export interface EnumValue { value: string; summary?: string; swatch?: string }

export interface FlagSpec {
  short?: string; long?: string; key?: string;              // ctx.opts key = key ?? long ?? short
  description: string;
  value?: { name: string; source: ValueSource; default?: string; optional?: boolean };
  repeatable?: boolean;
}
export interface ArgSpec { name: string; source: ValueSource; optional?: boolean; variadic?: boolean }
export interface Example { line: string; note?: string; offline?: boolean; starter?: number }

export interface CommandSpec {
  name: string; aliases?: string[]; category: Category;
  summary: string;                                          // 50 characters or fewer
  synopsis?: string[]; description?: string; man?: { heading: string; body: string }[];
  flags?: FlagSpec[]; args?: ArgSpec[]; subcommands?: Record<string, SubcommandSpec>;
  examples?: Example[]; seeAlso?: string[]; featured?: boolean; hidden?: boolean;

  builtin?: boolean;                                        // may change session state (cd, export, alias)
  network?: boolean;                                        // offline fast-fail and the 8 s per-request default
  budgetMs?: number;                                        // whole-command budget; default 15 000
  loadingLabel?: (argv: readonly string[]) => string;       // 'fetching forecast for Oslo'
  dataCost?: { bytes: number; confirmOn: ('cellular' | 'saveData' | 'touch')[] };  // speedtest
  posixArgs?: boolean; numericShortcut?: string; handlesHelp?: boolean;

  opens?(argv: readonly string[]): string | null;           // synchronous preflight URL, run inside the gesture
  next?(r: { status: ExitCode; argv: readonly string[] }): string[];  // follow-up chips
  complete?: Completer;                                     // escape hatch when ValueSource is not enough

  run?: RunFn; load?: () => Promise<{ run: RunFn; doc?: CommandDoc }>;  // exactly one; load() makes a lazy chunk
  legacyHelp?: string;                                      // migration only (deleted in Phase 5.1)
}
```

*Amended (lazy catalogue).* Commands live in two places. The **core**, `src/commands/<category>/<name>.ts`, is registered with the kernel and is for what cannot wait: the portfolio commands and starter chips, the builtins a login uses, `help`, `man` and the other commands that look commands up, and any command with `opens()` (its preflight runs synchronously, before the line starts). Every other command is in the **catalogue**, `src/commands/more/<category>/<name>.ts`: `src/commands/more/catalogue.ts` gathers those specs into one chunk that `src/commands/index.ts` reaches only through `loadCatalogue()`, an `import()`, loaded when the page is idle or when a name the kernel lacks is typed. The `Registry` gains `complete`, `whenComplete()` (loads the catalogue once, never rejects; a failed load leaves `complete` false and the next call tries again), `takeFailure()` and `onChange()`. A name not yet registered waits for the catalogue (bounded by ^C and 8 s) before `$PATH` and `command not found`; `help`, `man`, `whatis`, `apropos`, `which`, `type`, `command -v` and `privacy` wait the same way, and a first Tab on a command name waits up to 300 ms. A lazy body may also carry the long help as `doc: CommandDoc` (`description` and `man`), read through `withDoc(spec)` by `--help`, `help NAME` and `man`; summaries, synopses, flags, examples and see-also stay in the spec. See ADR 0001, "Phase 5.2" and "Long help can live with a lazy body".

This merges the shell design's spec (category, man, `opens`, `next`, `run`/`load`), the input design's `ValueSource`, placeholders and starter ranks, the phone design's loading label and data cost, and the budget field the weather and stock designs both needed. The registry is a `Map`, throws on a duplicate name or alias, and returns `undefined` for inherited keys such as `constructor` (F031, F034). Every command is cancellable, so there is no `interruptible` or `cancellable` flag; the three hard-coded allowlists (F045) disappear.

## 2. One output model

Commands never return HTML strings. They write to `ctx.stdout`:

- **Text with an SGR subset** (bold, dim, the 16 palette colours, OSC 8 links for `http`, `https` and `mailto` only). Through a pipe or into a file the bytes pass unchanged, so `ls | cat` behaves like Linux.
- **Blocks** for layout: `lines`, `grid`, `table`, `art`, `panel`, `chips`, `card` and `columns`, from the shell design. Every block has a `plain()` fallback for pipes.
- **A trusted `component` block**, added by this plan:

```ts
// src/output/model.ts
| { type: 'component';
    name: 'weather-card' | 'quote-card' | 'quote-table' | 'qr-card' | 'link-card';
    props: unknown;          // a typed view model: WeatherView, QuoteEnvelope, QrView, LinkView
    plain: string;           // what a pipe or file receives
    alt: string }            // screen-reader summary
```

`ui/OutputView.svelte` renders blocks with text interpolation only, and renders a component block by looking up a registered Svelte component. Weather, stock and QR therefore build Svelte components against view models they already define, rather than HTML strings that a sanitiser would strip. This resolves the critic's sharpest conflict: the shell design's allowlist would have removed weather's markup, QR's SVG and stock's sparkline.

During migration, legacy commands still return HTML strings. Those render through a temporary `legacyHtml` block that runs DOMPurify with `RETURN_DOM_FRAGMENT` and a tight tag, attribute and CSS allowlist. DOMPurify is removed when the last legacy command is ported. Because the shim ships in Phase 1, the self-XSS paths (F004, F005) close long before the full migration ends.

**Colours are tokens, not hex.** Spans carry palette or role names that render as `var(--theme-*)` or `var(--role-*)`, so old output re-themes with no DOM patching (F009). "Is this the current theme" highlights are `LiveBinding` spans that read the theme store at render time, which deletes the DOM-patching code in `theme.ts:33-55` and `cathode.ts:42-49` (F030).

## 3. One lexer

There is one lexer, at `src/shell/lexer.ts`. It never throws. It returns `{ tokens, complete, openQuote, danglingEscape, commentAt }`, and each token carries its source span, raw text, unquoted value and quote-aware parts. The parser maps `complete: false` to a `> ` continuation prompt. Completion lexes the line up to the cursor with the same function. This takes the input design's tolerant contract and the shell design's richer word parts; the prototype in [prototypes/shell/lexer.ts](prototypes/shell/lexer.ts) throws on incomplete input and needs that change.

## 4. One job and cancel model

The shell `Session` owns a single `job` store: `{ name, label, startedAt } | null`. Every submitted line gets one `AbortController`. Ctrl+C, Escape, the dock's ^C key and the Stop chip all call `job.abort()`. The prompt returns at once with `^C` and status 130, and any late output from that job is dropped.

Budgets:

| Scope | Default | Overrides |
|---|---|---|
| One network request (`services/net`) | 8 s | Geocoding 6 s, IP lookup 4 s |
| Whole command (`spec.budgetMs`) | 15 s | weather 25 s (it may wait on a location prompt), stock 10 s |
| speedtest | Per phase, time-bounded | Asks first when `dataCost` applies |

`AbortSignal.any` and `AbortSignal.timeout` are not used, because Instagram's WKWebView on iOS before 17.4 lacks them. A small manual signal-combining helper replaces them.

*Amended (command deadline).* A command can see when its budget ends: `CommandContext.deadline` is the `clock` time at which the whole-command budget runs out, counted from before the body loads, and is absent for a command without one. A command that makes several requests plans them against it (`stock` keeps 500 ms to draw, so a table's later lookups never run past the budget and the rows in hand are still shown). See ADR 0001, "Phase 4 review fixes".

Until the shell kernel lands in Phase 2, the Phase 0 hotfix adds the same timeouts to the existing fetches and a temporary `stores/job.ts`, which `Session` later absorbs.

## 5. One completion engine, one editor, one dock

**Engine.** The input design's engine is the one built: `complete()`, `accept()`, the Tab state machine, ghost text and chips, all driven by `CommandSpec` and the shared lexer. The shell design's `complete.ts` and the phone design's `legacyCompletion.ts` are not built.

**Tab.**

1. A unique match is accepted, with a trailing space, or `/` for a directory.
2. Otherwise the common prefix is extended.
3. If nothing could extend, the candidate list appears on the first press.
4. The next Tab enters a menu that cycles. Shift+Tab goes back, Esc restores what you typed, and Enter accepts without running.
5. Over 100 candidates, the list first asks `Display all N possibilities? (y or n)`.

**Editor.** The native `<input>` stays the editing surface on every device, so IME, autocorrect and paste keep working.

- **Desktop (fine pointer):** the input is transparent over a mirror that draws a block cursor in `--role-cursor` and grey ghost text.
- **Touch:** the input is visible, really 16 px (so iOS never zooms), and scaled to terminal size by a measured `--input-scale`. A one-variable kill switch falls back to a plain 16 px input. The device probe in Phase 0 confirms this choice before Phase 3.
- **Never disabled.** Keys typed while a command runs are kept as type-ahead.
- **Focus.** Focus is called synchronously inside the user gesture. The keyboard stays open after a command if it was open when the command was submitted.

**Dock.** The phone design's dock is the one built. It has a chip row, a key bar (`tab ↑ ↓ ^C clear ••• ⌄`) and a long-press history sheet, in full, compact and minimal modes. It is a sibling of `<main>`, never inside it, because the vintage CRT mode's `filter` on `<main>` captures `position: fixed` children. The input design's PromptDock and the shell design's AccessoryBar are not built.

## 6. Tap actions come only from trusted code

A chip or a tappable span can run, insert, open, copy or share. Those actions are created only by builder functions in command code (`out.run()`, `out.insert()`, component props). They are never parsed from HTML, SGR, OSC 8 or `data-*` attributes, so text that came from `cat`, `curl` or `echo` can never plant a command a visitor might tap. Arguments placed into chip commands must match a canonical pattern, for example `[\p{L}\p{N} ,.'-]` for place names. No tap-to-run feature ships before the safe renderer (Phase 1.1).

## 7. One platform layer

- `platform/env.ts` detects touch, the in-app browser (`instagram`, `facebook`, `tiktok` or none), reduced motion, Save-Data and online state. Detection changes defaults only and never removes a feature.
- `platform/viewport.ts` is the phone design's pure `computeViewport()`. It writes `--app-h`, `--app-top` and `--kb-h`, positioning with `top` rather than `transform`.
- `services/opener.ts`:
  - On a desktop browser, `spec.opens()` opens the URL synchronously inside the Enter or tap gesture.
  - Every opener also prints a link card with Copy.
  - Inside an in-app browser nothing navigates without a tap. Links open in the same view, and a session snapshot restores the terminal when the visitor comes back.
  - The `instagram://extbrowser/` and Android `intent://` escapes are offered only behind a tap, next to the manual "••• → Open in browser" instruction.

## 8. One storage-key registry

All storage goes through `services/storage.ts`. It wraps every access in try/catch and falls back to memory. Keys follow `vesen:<name>:v<n>` and are listed in one file:

| Key | Holds | Notes |
|---|---|---|
| `vesen:theme:v1` | Theme name only | Migrated once from `colorscheme`, which stored the whole colour object (F002) |
| `vesen:cathode:v1` | CRT mode and quality | Migrated from `cathode` |
| `vesen:prefs:v1` | bell, keys on/off, text size | |
| `vesen:history:v1` | Command history, 500 lines, lines starting with a space skipped | Only if the owner approves persistence |
| `vesen:fs:v1` | Overlay of changes under `~`, with a seed version | Only if the owner approves persistence |
| `vesen:weather:v1` | Geocode cache and recent places | |
| `vesen:stock:v1` | Last good quotes and recent tickers | |
| `vesen:session:v1` (sessionStorage) | Snapshot for Back navigation | 50 entries, 30 minutes |

The old `history` and `commandHistory` keys are removed once. Secret input is never written anywhere (see section 12).

## 9. One copy of each shared helper

| Concern | Lives in | Replaces |
|---|---|---|
| Escaping | `output/escape.ts` (used only by the legacy shim and attribute values) | Copies in `network.ts:127,454`, the grep branch, and the escapers each design proposed |
| HTTP | `services/net.ts`: `text()`, `json()`, timeouts, `NetError` kinds (offline, timeout, cors, http, parse, abort), `memo()` with in-flight de-duplication and a 30 s failure cool-down | Every bare `fetch` (F047, F065) |
| Storage | `services/storage.ts` | Unguarded access in three stores (F001) |
| Bell | `services/bell.ts`: one lazily created `AudioContext`; visual flash on touch | A new context per beep (F058) |
| Notices | The `panel` block | Six copy-pasted cancelled notices (F087) |

## 10. One token namespace

The palette stays as `--theme-*`, unchanged, so the ten themes keep their identity. A second layer, `--role-*`, names what text is for:

`fg`, `fg-strong`, `muted`, `accent`, `ok`, `warn`, `error`, `link`, `chip-bg`, `chip-fg`, `ghost`, `selection`, `cursor`, `prompt-user`, `prompt-host`, `prompt-path`, `sun`, `rain`, `cold`, `hot`, `qr-ink`, `qr-paper`.

Each theme in `themes.json` gains an optional `roles` map. Missing roles are computed from the palette and checked for contrast. One bootstrap subscription applies both layers. The visual workstream owns the values. Weather, stock, QR and the chips use roles and never invent their own variables.

## 11. Help comes only from specs

`help`, `<cmd> --help`, `man`, `whatis`, `apropos`, Tab descriptions and starter chips are all generated from `CommandSpec`. From Phase 0, no workstream edits `src/utils/helpTexts.ts`; it is deleted in Phase 5.

*Amended (lazy catalogue).* The long help of a command whose body loads lazily is the body's `doc`, fetched first by `--help`, `help NAME` and `man`; if the body cannot be loaded, the summary stands in. Commands that list or look up commands by name wait for the catalogue through `allCommands(ctx)` in `src/commands/lib/catalogue.ts`.

## 12. Secret input

The sudo joke asks for a password, so some visitors will type a real one. The rules:

- **Field:** the input stays `type=text`, masked with CSS (`-webkit-text-security: disc`), with `autocomplete=off`, `data-1p-ignore`, `data-lpignore` and `writingsuggestions=false`. The password manager bar never appears.
- **Never stored:** secret input is never written to history, the session snapshot, the kill ring or analytics, and it is cleared on blur and on `pagehide`.
- **Copy:** the prompt keeps sudo's wording, plus a dim line that says it is a joke, so nobody is coaxed into typing a real password.

A unit test and an end-to-end test assert that the secret never reaches storage.

## 13. Security and cache headers

Set once in `firebase.json`, mirrored as a `<meta>` CSP for the Docker image, and shipped as Report-Only for one deploy first.

| Header | Value |
|---|---|
| Content-Security-Policy | `default-src 'self'; script-src 'self' 'sha256-<boot script>'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self'; connect-src 'self' https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'` |
| Permissions-Policy | `geolocation=(self), screen-wake-lock=(self), clipboard-write=(self), camera=(), microphone=(), payment=()` |
| Referrer-Policy | `strict-origin-when-cross-origin` (Nominatim needs the origin to identify the app) |
| X-Content-Type-Options | `nosniff` |
| Cache-Control `/index.html` | `no-cache` |
| Cache-Control `/assets/**` | `public, max-age=31536000, immutable` |

The catch-all rewrite to `index.html` is replaced by a terminal-styled `404.html`. There are no client routes, and the rewrite turns missing chunks into HTML responses. A `vite:preloadError` handler prints "vesen was updated, reloading…" and reloads, restoring the session from the snapshot. That makes lazy chunks safe across deploys.

`connect-src` stays at `https:` because `curl` and `wget` fetch arbitrary URLs. The CSP's job is to stop injected script, not to limit fetches.

## 14. One test stack

- One `vitest` major that matches the upgraded Vite, with the `node` environment for `shell`, `output`, `vfs`, `lib` and `commands`, and `happy-dom` for `ui`.
- Unit tests sit next to their code as `*.test.ts`. End-to-end tests live in `e2e/`, using Playwright with three projects: Desktop Chrome, WebKit iPhone with an Instagram user agent, and a Pixel 7.
- CI gates every pull request and every merge to `main`:
  - `svelte-check` with 0 errors
  - `check:strict` and `check:boundaries`
  - `vitest`
  - `vite build`
  - a bundle budget of 60 kB gzip for the initial chunk
  - the Playwright smoke project
  - the contrast script
- The Docker workflow runs only after these checks pass.

## 15. One identity

The visitor is `guest`, uid 1000, with `HOME=/home/guest`. `/home/user` remains as a symlink so existing examples keep working. The prompt host is the brand, `vesen`, rather than `window.location.hostname`, so it is the same on every domain (pending the owner's decision). `/home/has` holds the owner's read-only portfolio files for `finger has` and exploration. `whoami` prints `guest` in pipes; `linkedin` and `about` are the portfolio entry points.

## Migration rules

- Strangler migration. A legacy adapter wraps all 26 existing commands on the first day of the kernel, so every command gains quotes, pipes, redirection, `$?` and ^C at once. Commands are then ported one pull request at a time.
- Old command names keep working at every step.
- A command's legacy function and its `helpTexts.ts` entry are deleted in the pull request that ports it.
- Golden snapshots of today's output at 40, 80 and 120 columns are recorded in Phase 0, and every port is compared against them.
- **Ordering rule:** never build a renderer, chip executor, status store, viewport tracker or editor before its contract above exists. Those are exactly the pieces the six designs duplicated.
