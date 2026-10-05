# Phone and Instagram experience: reference design

> **How to read this file.** This is the full design that a three-way design panel produced and a judge synthesised for this workstream. It is the detailed reference: interfaces, file plan, steps and tests. Where it conflicts with the shared decisions in [../02-architecture-and-contracts.md](../02-architecture-and-contracts.md) or with the sequencing in [../04-phone-and-instagram.md](../04-phone-and-instagram.md), **those documents win**. Line numbers refer to `main` at commit 23758b9 (5 October 2026).

**Chosen approach:** Thumb-first terminal on a thin platform layer, delivered in deployable slices

## How it was chosen

- **Thin Touch Layer: a visual-viewport app shell plus a TouchDock that drives the existing key handler** scored 7.3. Feasibility 8.5, UX 7, maintainability 5.5, effort 9, risk 8.

Strengths:
- The most incremental plan: about 6 days in 8 deployable PRs.
- Its measurements check out against the code. The 320 px overflow comes from the `max-content 1fr` grid (App.svelte:78). The stale px max-width is baked in at textWrap.ts:29-37. The ICOs are 133,982 bytes each (public/favicons).
- It correctly ships the viewport-meta zoom unlock (index.html:6) in the same PR as the 16px input, so iOS does not zoom on focus.
- Several details are worth keeping: refocus only if the input was focused before submit; a concrete single-layer lite CRT; `?debug=vp`, `?dock=1` and `?fx=` QA switches; the chip trailing-space rule; and labels that show only the token being completed.

Weaknesses:
- The dock sends synthetic KeyboardEvents into the 230-line window keydown ladder (Input.svelte:192-615, Tab at :381), and `!touch` branches spread through Input.svelte. That works against goal 3 (code arrangement) and goal 5 (an autocomplete rewrite would break the seam).
- It keeps `readonly` (Input.svelte:668) and `type=password` (Input.svelte:660). It also keeps the password capture that only reads keydown (Input.svelte:363), which Android IMEs defeat.
- It has no storage guard. theme.ts:86, cathode.ts:56 and history.ts:6-7 can still blank the page in WebViews that block storage (F001).
- It does not fix the hosting setup. The catch-all rewrite (firebase.json:9-14) and the one-hour HTML caching stay as they are.
- Inside the in-app browser, links still use target=_blank, and Back does not restore the session.
- It shows an in-app notice up front, so a visitor's first impression is an apology.

- **Platform Ports + Responsive Touch Shell (clean-architecture mobile/Instagram design)** scored 6.8. Feasibility 7, UX 8, maintainability 9.5, effort 4, risk 5.

Strengths:
- The cleanest architecture of the three. The cores (env, capabilities, viewport, perf, links, keys) are pure, testable functions.
- SafeStorage fixes the boot crash (F001; theme.ts:86, cathode.ts:56, history.ts:6-7).
- A CI check stops new innerWidth or window.open calls from creeping back.
- The DebugOverlay matters, because Instagram's WebViews cannot be inspected.
- `syncHead` fixes both svelte-check errors (theme.ts:71,78).
- It fixes Firebase caching and the catch-all rewrite (firebase.json:9-14).
- Links open in the same view (`_self`) inside in-app browsers, and a session snapshot restores the terminal on Back.
- It detects a hardware keyboard and hides the key bar.
- The perf tier reports a reason, backed by a frame sampler.

Weaknesses:
- About 16 days of work across about 25 new modules.
- The typed OutputBlock union and the lineController step into the weather, qr, stock, shell and autocomplete workstreams. That means many merge conflicts on Input.svelte, commands.ts and network.ts.
- It thinks less about the visitor's experience. There is no form submit for Android IME Enter, no fix for iOS smart punctuation, and no anchoring of long output. The keyboard-closed state is only lightly designed.
- The value comes late: the minimum useful slice is still about 7 days.

- **Thumb-first terminal: a visual-viewport-anchored shell with a tap dock, CSS reflow and contextual in-app fallbacks** scored 8.1. Feasibility 7.5, UX 9.5, maintainability 7.5, effort 6, risk 6.5.

This design starts from what a visitor coming from Instagram actually experiences, and it gets the phone mechanics right:
- `<form>` submit works around Android IMEs, where keydown capture at Input.svelte:363 fails.
- Ctrl+C only interrupts when no text is selected. Today it always calls preventDefault (Input.svelte:194-195), which blocks copying.
- iOS smart punctuation is normalised, so `ls —help` works.
- On touch, long output is anchored at its echo line so it can be read from the top.
- There is a keyboard-closed bar, plus follow-up, did-you-mean and retry chips.
- In-app browser fallbacks appear only when an action needs them.
- A PowerOffScreen replaces the `body.innerHTML` overwrite and `window.close` (fileSystem.ts:530-562).
- A subset of the 648 KB Cascadia TTF, currently referenced nowhere, fixes box-drawing on iOS, where the 17 `font-family: monospace` overrides fall back to Courier.
- Speedtest asks for confirmation on phones, which partly addresses F028.
- It adds a 404 page and cache headers.
- Pulling a TerminalController out of Input.svelte serves goals 3 and 5.

Weaknesses:
- 1.5 days for the controller extraction is optimistic.
- It depends on CommandMeta from the command workstream.
- Auto-running commands from a deep link adds attack surface while `echo` remains unescaped (F004).
- Its storage guard covers only the new settings store.
- The dock (44 + 48 px) is too tall for an iPhone SE with the keyboard and Instagram's top bar.
- There is no debug overlay for the uninspectable WebViews.

It wins because it has the highest UX impact and lines up best with the owner's goals 3, 5 and 6.


Ideas grafted from the other candidates:

- From design 1: ship the zoom unlock (index.html:6) in the same slice as the 16px input, and split delivery into deployable slices with a 3.5-day minimum that fixes the Instagram first impression.
- From design 1: fix the 320 px horizontal overflow with `grid-template-columns: max-content minmax(0,1fr)` and a `min-w-0` wrapper around the input (App.svelte:78).
- From design 1: refocus after a command only if the input was focused at submit, so a run chip does not throw the keyboard over the output.
- From design 1: chip labels show only the token being completed, and the fallback trailing-space rule (`getCommandSuggestions(s+' ')` differs from `s`) applies when there is no CommandMeta.
- From design 1: a concrete lite CRT (one static radial vignette plus a 3 px repeating scanline gradient, no filter, capped text-shadow), with scanlines snapped to whole device pixels at DPR 3.
- From design 1: QA query switches `?dock=1` and `?fx=full|lite`, and a Playwright `page.route` that never resolves, to test ^C.
- From design 1: keep the plain text inside spans so innerText stays unchanged for the future pipes and redirection workstream.
- From design 1: generate PNG icons from the existing 180x180 ICO with `sips`, flattened onto #222235.
- From design 2: SafeStorage plus a `persisted()` store for theme, cathode, settings and history. This resolves F001, the blank page when storage throws inside WebViews.
- From design 2: `syncHead()` moves the DOM side effects out of theme.ts and uses `setAttribute('sizes','any')`, clearing the 2 svelte-check errors (theme.ts:71,78).
- From design 2: a `?debug=1` DebugOverlay showing env, viewport, keyboard state, perf tier and reason, and frame p90, because Instagram's WebViews cannot be remote-inspected.
- From design 2: probe isolation plus `scripts/check-boundaries.sh`, which fails on window.open, window.close, innerWidth, navigator.userAgent, visualViewport and `localStorage.` outside src/platform, with a temporary allow-list for network.ts.
- From design 2: a pure `computeViewport()` with a per-orientation baseline, a zoom freeze, and sequence-based unit tests driven by a fake visualViewport Playwright fixture.
- From design 2: a pure `planOpen()`. In-app browsers get links without target=_blank (`_self`), and a session snapshot restores the terminal on Back.
- From design 2: hide the key bar once a hardware keyboard is detected, plus a `keys on|off|auto` command.
- From design 2: a pre-paint boot script injected by a Vite `transformIndexHtml` plugin from themes.json, so there is a single source of truth and no white flash.
- From design 2: measure `--ch-ratio` after `document.fonts.ready` so ASCII art scaled with cqi fits exactly.
- From design 2: a strict tsconfig for the new folders, and CI running check, boundaries, unit and e2e tests in firebase-hosting-pull-request.yml (today it only runs `npm ci && npm run build`).
- From design 2: `-webkit-text-size-adjust: 100%`, and the CRT overlay made absolute inside the screen so it never covers the dock.
- From findings F047, F067, F079 and F094: a controller-level backstop timeout for cancellable commands; chips as `role=option` buttons in a listbox, with `aria-activedescendant` on the input; CRT animations paused while the page is hidden, a slowed flicker, and the CRT off under forced-colors or more-contrast; and `h.art(text, cols, alt)` with aria-hidden art and screen-reader-only alternative text.
- Judge's own changes: smaller dock heights (40 px chips and 44 px keys; one 44 px row in compact mode); a hide-keyboard key (⌄); Esc moved to the symbols page; the deep-link auto-run (`?run=`) deferred until F004 is fixed, keeping only a prefill-only `?cmd=`.

## Summary

A visitor who taps the vesen.app link on the owner's Instagram profile should see a correctly aligned VESEN banner in the theme colour within about 300 ms, with no white flash, no zoom and no sideways panning. They should be able to explore by tapping alone. When they type, the prompt and a compact dock sit directly above the soft keyboard, and the keyboard stays open between commands. Desktop keeps a classic, keyboard-first terminal.

The design starts from design 3 and adds design 2's platform hygiene and design 1's delivery discipline. It has seven parts.

1. A fixed app shell sized from window.visualViewport, falling back to dvh. It respects safe-area insets, and its scrollback is the only scroller.
2. A real 16px input, visually scaled down to the phone's 13px text size, so focusing it never zooms the page. Pinch-zoom is restored.
3. A TerminalController pulled out of Input.svelte. Keyboard input, dock keys, chips, tappable command links and the history sheet all call the same API. The input is never disabled, and Enter is a form submit, so Android keyboards (IMEs) also work.
4. A touch Dock:
   - a chip row that scrolls sideways and can be tapped to run or to insert;
   - a key bar: tab, ↑, ↓, ^C, clear, a symbols page with esc, and ⌄ to hide the keyboard;
   - a bar for when the keyboard is closed;
   - long-press ↑ opens a history sheet.
5. Output that reflows with CSS (ch grids, container queries, ASCII art scaled with cqi) instead of innerWidth arithmetic when a command runs.
6. An environment layer that detects in-app browsers. Inside one, window.open, mailto, window.close and downloads are replaced by tappable links, copy, share or long-press saves, and an 'open in Safari/Chrome' escape. A Back-navigation session snapshot means a trip out to LinkedIn does not wipe the session.
7. A CRT 'lite' tier chosen automatically on phones and constrained devices. Plus safe storage, correct head metadata, icons, an OG image, a manifest, a self-hosted Cascadia subset font, and Firebase cache and 404 hygiene.

It ships as 10 slices. Slices S1-S3 (about 3.5 days) fix the Instagram first impression on their own: blank-page risk, zoom, keyboard layout, overflow and link preview.

## Architecture

## Verified current state (the problems this resolves)
- **Zoom, sizing and the soft keyboard**
  - index.html:6 locks zoom (`maximum-scale=1.0, user-scalable=no`).
  - index.html:12-13 sizes the page with `min-h-screen` and `h-screen p-4` (100vh). App.svelte:72 makes main `h-full` with a 2px border.
  - App.svelte:78 uses grid `max-content 1fr`; the input's `min-width: auto` overflows at 320 px.
  - Input.svelte:674 sets the input to 12px, which makes iOS zoom on focus once zoom is unlocked.
  - Input.svelte:305 and :667 disable the input during commands. :354-355 re-enable and refocus it after an await, so the iOS keyboard closes after every command.
  - Input.svelte:668 sets `readonly`, and :701 is an invalid `:readonly` rule. :39-48 holds a dead `displayValue`.
  - Input.svelte:142 autofocuses on mount, and :645-651 refocuses on any window click, so every tap opens the keyboard.
  - Input.svelte:160-189 has competing smooth scrolls, including `scrollIntoView` at :170, plus App.svelte:19-56.
- **Keyboard and IME handling**
  - Input.svelte:194-195 calls preventDefault on every Ctrl+C, so copying selected output is impossible.
  - Input.svelte:363 captures the password from keydown `event.key`. Android IMEs send 'Unidentified', so nothing is captured.
  - Input.svelte:660 sets `type=password`, which brings up the iOS Passwords bar.
- **Suggestions and prompt**
  - CommandSuggestionsRow.svelte:55-63 renders suggestions as inert {@html} text.
  - Ps1.svelte:3-4 hard-codes the full hostname and `~`, and :10 and :14 wrap the prompt in `<h1>`.
- **Width fixed when a command runs**
  - commands.ts:26-48 (help), commands.ts:59-66 (history), fileSystem.ts:115 (ls), system.ts:573-574 (fastfetch).
  - network.ts:68-81 truncates weather on phones. network.ts:196-199 (curl) emits `max-width: nonepx` on desktop. Also network.ts:304-305 and network.ts:596.
  - textWrap.ts:29-37 and :135-146, applied at History.svelte:20.
  - app.css:25-78 forces `pre` to pre-wrap with !important, which breaks ASCII art.
- **CRT effect**
  - app.css:136-143 is a fixed overlay at z-index 9999.
  - app.css:117-132 adds text-shadow and filter on the scrolling main.
  - app.css:183-195 and :243-248 run a sweep animation in vh units.
  - cathode.ts:53 turns scanlines on by default.
- **Leaving the page**: system.ts:10, commands.ts:112, :274 and :293, Input.svelte:248, and fileSystem.ts:515-562 (a stale selector, a body.innerHTML takeover, then window.close).
- **Storage**: module-scope localStorage access at theme.ts:86, cathode.ts:56 and history.ts:6-7,22-28 (F001).
- **Hosting and assets**
  - firebase.json:9-14 is a catch-all rewrite, so /og.png and /apple-touch-icon.png return HTML with status 200.
  - httpd.conf:1 is `E404:index.html`.
  - public/fonts/CascadiaCode.ttf (648,736 B) is referenced nowhere. The ten favicon ICOs are 133,982 B each.
  - beep.js:4 creates a new AudioContext on every beep.

## Layers
1. **Document and hosting** (index.html, public/, firebase.json, httpd.conf, vite.config.ts plugin)
   - Head metadata.
   - A pre-paint boot script, generated from themes.json, that sets the html background, theme-color and the `touch` class inside try/catch.
   - Icons, manifest, og.png, 404.html.
   - Cache headers: index.html no-cache; /assets/** and /fonts/** immutable. The catch-all rewrite is removed.
2. **Platform** (src/platform/*): pure TypeScript, no Svelte components.
   - probe.ts is the only module that reads navigator, matchMedia, location and CSS.supports.
   - Pure cores in env.ts, viewport.ts (computeViewport), perf.ts (decideCrtQuality) and links.ts (planOpen).
   - Thin adapters: storage.ts, head.ts, clipboard.ts, bell.ts, session.ts, debug.ts.
   - scripts/check-boundaries.sh enforces this boundary.
3. **Terminal** (src/terminal/*)
   - contracts.ts: CompletionProvider, Candidate, CommandMeta, TerminalEffect. These are shared with the autocomplete, shell and network workstreams.
   - controller.svelte.ts: the single owner of the run lifecycle (idle, running, prompt, off), the line buffer and caret, history cursor, abort, backstop timeout, clear screen, completion application and composition guard.
   - suggestions.ts builds the Chip[].
   - normalise.ts undoes iOS smart punctuation.
   - legacyCompletion.ts holds the existing Tab ladder from Input.svelte:381-613, moved verbatim behind CompletionProvider until the autocomplete engine lands.
4. **Render helpers** (src/render/html.ts): `h.esc` (mandatory for any user-provided text), `h.cmd`, `h.ext`, `h.copy`, `h.art`, `h.cols`, `h.notice`. Commands still return HTML strings, so the change is compatible with the other workstreams.
5. **Presentation** (src/components/*)
   - App.svelte becomes a grid shell holding Screen and Dock.
   - Screen.svelte holds Scrollback, the sticky PromptLine, StatusLine, NewOutputPill, the CRT overlay (absolute) and a delegated click handler.
   - Dock.svelte holds ChipRow and KeyBar. Also HistorySheet, PowerOffScreen and DebugOverlay.
   - Ps1.svelte uses a `<span>`.
6. **Styles**: src/styles/{tokens,shell,terminal,dock,crt}.css, imported from app.css. The app.css:25-78 mobile block is deleted.

## Shell layout on touch (html.touch)
```
.shell  position:fixed; left:0; right:0; top:var(--app-top,0px); height:var(--app-h,100dvh) [fallback 100vh];
        display:grid; grid-template-rows:minmax(0,1fr) auto; touch-action:manipulation;
        padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left)
 .screen-frame position:relative (CRT overlay is absolute here, never over the dock)
  .screen  overflow-y:auto; overscroll-behavior:contain; container: term / inline-size; padding:8px 12px; role=log
    entries… (all but the last 20 get content-visibility:auto; contain-intrinsic-size:auto 4lh)
    PromptLine  position:sticky; bottom:0; background:var(--theme-background)
    StatusLine (while running)
    tap-to-type filler (min-height 30% of the screen, only below the prompt)
 .dock  border-top 1px; padding-bottom:max(8px, env(safe-area-inset-bottom)); html.kb-open → 4px
   ChipRow 40px (listbox, horizontal scroll, scroll-snap x proximity, edge fade mask, padding-inline 12px)
   KeyBar 44px (toolbar)
```
- **html and body**: `height:100%; overflow:hidden; overscroll-behavior:none; -webkit-text-size-adjust:100%; background:var(--theme-background)`.
- **Phones** are edge to edge (no 16px margin or 2px border). Desktop (`(pointer:fine)` and min-width 768px) keeps the framed monitor look from App.svelte:72, an inline (not sticky) prompt and no dock.

## Viewport controller (src/platform/viewport.ts)
- **Listeners**:
  - visualViewport `resize` and `scroll`, window `resize`, orientationchange, and focusin/focusout on the command input;
  - updates are throttled with rAF;
  - it re-measures 50, 300 and 600 ms after a focus change.
- **Writes**:
  - `--app-h = vv.height` and `--app-top = vv.offsetTop`;
  - `--kb-h`;
  - classes `kb-open`, `dock-compact` (visible height 300-459) and `dock-minimal` (under 300).
- **Keyboard detection**: keyboardOpen is true when the input is focused and `baseline[orientation] - vv.height > 150`. The baseline is the largest unfocused innerHeight seen in that orientation. This covers both models:
  - iOS and WKWebView shrink only the visual viewport;
  - Android Chrome with `interactive-widget=resizes-content`, and WebView with adjustResize, shrink the layout viewport.
- **Pinch-zoom**: when `|vv.scale - 1| > 0.01` the variables are removed (CSS falls back to dvh) and tracking stops, so zoom behaves natively.
- **On focusout**: `window.scrollTo(0,0)` on the next frame, to clear a stale iOS offsetTop.
- The shell is positioned with `top`, not `transform`, and its height is never CSS-transitioned.

## Input (PromptLine.svelte)
- **Markup**: `<form onsubmit>` wraps `<input type=text name=vesen-command enterkeyhint=go autocapitalize=none autocorrect=off autocomplete=off spellcheck=false aria-label="Terminal command" aria-describedby=status-line aria-controls=chip-listbox data-1p-ignore data-lpignore=true>`.
- **Event routing**:
  - Enter goes through form submit, which works even when the IME sends keyCode 229.
  - keydown handles only non-character keys: Tab, Shift+Tab, arrows, Escape, Ctrl+C/L/U/W/A/E/R.
  - Characters arrive through `input` events.
  - compositionstart and compositionend set `composing`. Programmatic line changes wait for compositionend.
- **Ctrl+C** interrupts only when `getSelection().isCollapsed`; otherwise the browser copies as normal.
- **16px on touch**:
  - The wrapper is `position:relative; overflow:hidden; height:1lh; min-width:0`.
  - The input is `font-size:16px; width:calc(100% * 16 / var(--term-font-num)); transform:scale(calc(var(--term-font-num) / 16)); transform-origin:0 50%`.
  - Kill switch: `--input-scale-off` renders the line at a plain 16px.
- **Never disabled.**
  - Slice S2 keeps `readonly` and aria-busy while running, as in F012.
  - Slice S4 switches to type-ahead: no readonly; Enter is ignored and rings the bell while running; typed text is kept for the next prompt. A QA gate checks that the iOS keyboard stays open.
- **Secret prompts** use `type=text` with `color:transparent; caret-color:var(--theme-cursor)` and the visible hint '(input hidden)'. Nothing is echoed, as in real sudo, and no password-manager bar appears.

## Focus policy
- **Fine pointer**: a click on blank screen calls `focus({preventScroll:true})`, unless there is a selection or the target is inside `a, button, [data-cmd], .copy-btn`.
- **Touch**: focus happens only from:
  - the prompt row;
  - the filler below it;
  - the ⌨ key;
  - an insert chip (focused synchronously inside the tap handler, so iOS opens the keyboard);
  - a tapped past-command echo, which inserts it.
  A tap that moved more than 10 px is a scroll. There is no autofocus on load.
- **Dock buttons** call preventDefault on pointerdown and mousedown, so the input keeps focus, and they act on click.
- **After a command**, focus is restored only if the input had focus at submit.

## Scroll policy (stickToBottom action on .screen)
- `pinned` means within 48 px of the bottom, updated from passive scroll events.
- A ResizeObserver on the content and the container re-pins instantly when pinned. That covers the keyboard opening, rotation and the dock changing height.
- Submit forces a pin.
- On touch, when an output is taller than 75% of the screen, the echo line is scrolled to 8 px from the top so it can be read from the start.
- When output arrives while the visitor is unpinned, a '↓ New output' pill appears.
- Smooth scrolling only under `prefers-reduced-motion: no-preference`.
- This replaces Input.svelte:160-189 and App.svelte:17-56.

## CRT tiers (src/platform/perf.ts plus crt.css)
- An override wins: `cathode quality auto|full|lite|off`, persisted.
- **off** when reduced-transparency, more contrast or forced-colors is set.
- **lite** when any of: a phone (coarse pointer and shorter screen side under 600), an in-app browser, Save-Data, reduced motion, deviceMemory ≤ 4, or a 90-frame rAF probe taken 1.5 s after mount with p90 over 25 ms.
- **full** otherwise.
- What lite does:
  - hides `.crt-layer`;
  - gives `.crt-overlay` one static background: `radial-gradient(ellipse at center, transparent 58%, rgba(0,0,0,.45))` plus `repeating-linear-gradient(to bottom, transparent 0 2px, rgba(0,0,0,.22) 2px 3px)`;
  - removes the filter on the screen;
  - phosphor keeps `0 0 3px currentColor` on the prompt line only.
- **All tiers**:
  - animations pause under `html.page-hidden` (visibilitychange);
  - the sweep moves in % units;
  - the flicker is slowed to at most 3 Hz (F079);
  - reduced motion disables the sweep, flicker, smooth scroll, spinner, bell flash and poweroff fade.

## Typography tokens
- `--term-font-num`: 13 below 481 px, 14 from 481 to 767, 15 from 768, 16 from 1280.
- `--font-mono`: 'Vesen Mono', ui-monospace, 'SF Mono', Menlo, Consolas, 'Roboto Mono', 'Droid Sans Mono', monospace. Vesen Mono is a WOFF2 subset of Cascadia Code (font-display: swap, preloaded).
- `--ch-ratio` defaults to 0.6 and is measured after `document.fonts.ready`.
- The 17 `font-family: monospace` overrides become `var(--font-mono)`.

## Output conventions
- `.out`: `white-space:pre-wrap; overflow-wrap:anywhere`.
- `.out-cols`: a grid with `repeat(auto-fill, minmax(calc(var(--col-ch)*1ch), 1fr))` and a 2ch gap.
- `.out-art`: `white-space:pre; line-height:1.2; font-size:min(1em, calc(100cqi / (var(--art-cols) * var(--ch-ratio))))`, with an overflow-x:auto fallback, `aria-hidden` and a screen-reader-only alternative text.
- `@container term (max-width:60ch)` switches fastfetch, weather and stock between side-by-side and stacked.
- Commands must never read innerWidth. check-boundaries.sh enforces this; network.ts is allow-listed until the weather and stock rewrites land.

## Data flow
1. main.ts: `readProbe(window)`, then `detectEnvironment`, then `applyDocumentClasses` (touch, in-app, in-app-<name>, standalone, crt-*), then `startViewportController`, then `restoreSnapshot`, then `mount(App, {context})`.
2. The keyboard, KeyBar, ChipRow, `[data-cmd]` links and HistorySheet call TerminalController methods.
3. The controller calls processCommand. Commands return `string` or `{output, effects}`. Effects such as poweroff or clearScreen are applied by the controller.
4. Opening links calls `openExternal()` synchronously inside the submit or click task, and always returns a printed fallback link.
5. The theme store feeds `syncHead()`, which sets theme-color, color-scheme, the favicon and `--theme-cursor`.

## Key interfaces

```ts
// ───────── src/platform/env.ts (pure) ─────────
export type OS = 'ios' | 'ipados' | 'android' | 'macos' | 'windows' | 'linux' | 'other';
export type InAppApp = 'instagram' | 'facebook' | 'messenger' | 'threads' | 'tiktok' | 'linkedin'
  | 'snapchat' | 'twitter' | 'line' | 'wechat' | 'generic-webview';
export interface EnvProbe {
  userAgent: string; platform: string; maxTouchPoints: number;
  coarsePointer: boolean; anyFinePointer: boolean; standalone: boolean;
  reducedMotion: boolean; reducedTransparency: boolean; moreContrast: boolean; forcedColors: boolean;
  saveData: boolean; connectionType?: string; deviceMemoryGB?: number;
  screenShortSide: number; query: URLSearchParams;
}
export interface InAppInfo {
  app: InAppApp; label: string;            // 'Instagram'
  menuHint: string;                        // 'Tap ⋯ (top right) → Open in external browser'
  escapeHref: string | null;               // x-safari-https (iOS ≥ 17) | intent:// (Android) | null
}
export interface EnvInfo {
  os: OS; osMajor: number | null;
  touch: boolean; phone: boolean;          // phone = touch && screenShortSide < 600
  inApp: InAppInfo | null; isWebView: boolean; standalone: boolean;
  saveData: boolean; connectionType?: string; deviceMemoryGB?: number;
  reducedMotion: boolean; reducedTransparency: boolean; moreContrast: boolean; forcedColors: boolean;
  debug: boolean; override: string | null; // ?env=ig-ios|ig-android|safari|chrome, ?dock=1
}
export const IN_APP_RULES: ReadonlyArray<readonly [InAppApp, RegExp]>;
export function detectEnvironment(p: EnvProbe): EnvInfo;
export function applyDocumentClasses(env: EnvInfo, root?: HTMLElement): void; // touch | in-app | in-app-<app> | standalone

// ───────── src/platform/storage.ts ─────────
export interface SafeStorage {
  readonly persistent: boolean;            // false → in-memory fallback active
  get(key: string): string | null;
  set(key: string, value: string): boolean;
  remove(key: string): void;
}
export const local: SafeStorage;
export const session: SafeStorage;
export interface Codec<T> { parse(raw: string): T | undefined; serialize(v: T): string; }
export function persisted<T>(key: string, codec: Codec<T>, fallback: T, store?: SafeStorage): import('svelte/store').Writable<T>;

// ───────── src/platform/viewport.ts ─────────
export type DockMode = 'full' | 'compact' | 'minimal';
export interface ViewportSample {
  innerWidth: number; innerHeight: number;
  vvHeight: number; vvOffsetTop: number; vvScale: number; editing: boolean;
}
export interface Baseline { portrait: number; landscape: number; }
export interface ViewportState {
  visualHeight: number; offsetTop: number; scale: number; zoomed: boolean;
  keyboardOpen: boolean; keyboardHeight: number;
  orientation: 'portrait' | 'landscape'; dockMode: DockMode;   // full ≥ 460, compact 300–459, minimal < 300
}
export const KEYBOARD_THRESHOLD_PX = 150;
export function computeViewport(s: ViewportSample, b: Baseline): { state: ViewportState; baseline: Baseline };
export function startViewportController(o: { root?: HTMLElement; isEditing: () => boolean }): () => void;
export const viewport: import('svelte/store').Readable<ViewportState>;

// ───────── src/platform/perf.ts ─────────
export type CrtQuality = 'full' | 'lite' | 'off';
export type PerfReason = 'override' | 'reduced-transparency' | 'more-contrast' | 'forced-colors' | 'reduced-motion'
  | 'save-data' | 'in-app' | 'phone' | 'low-memory' | 'slow-frames' | 'default';
export function decideCrtQuality(env: EnvInfo, override: 'auto' | CrtQuality, frameP90?: number): { tier: CrtQuality; reason: PerfReason };
export function probeFrames(raf?: typeof requestAnimationFrame, frames?: number): Promise<{ p90: number }>;

// ───────── src/platform/links.ts ─────────
export type LinkTarget = { kind: 'web'; url: string; label?: string } | { kind: 'mail'; to: string; subject?: string };
export interface OpenPlan {
  autoOpen: boolean;                       // fine pointer && !inApp
  target: '_blank' | '_self';              // '_self' inside in-app browsers (session snapshot restores on Back)
  actions: Array<'copy' | 'escape'>;
  hint?: string;                           // in-app mail hint etc.
}
export function planOpen(t: LinkTarget, env: EnvInfo): OpenPlan;                   // pure
export function openExternal(t: LinkTarget): { html: string; opened: boolean };   // MUST run synchronously in the gesture task
export function tryEscape(info: InAppInfo): Promise<'left' | 'stayed'>;           // 'stayed' if still visible after 1200 ms
export function shareOrSave(file: File): Promise<'shared' | 'downloaded' | 'shown-for-long-press'>;
// clipboard.ts
export function copyText(text: string): Promise<boolean>;

// ───────── src/platform/session.ts ─────────
export interface SessionSnapshotV1 {
  v: 1; savedAt: number;
  history: Command[];                      // last 50 entries
  commandHistory: string[];
  cwd: string[]; vfs?: unknown;            // vfs only if the shell workstream exposes serialize()
  scrollTop: number; line: string;
}
export function saveSnapshot(): void;                         // pagehide / visibilitychange→hidden
export function restoreSnapshot(): SessionSnapshotV1 | null;  // back_forward && < 30 min && ≤ 1 MB

// ───────── src/terminal/contracts.ts (shared) ─────────
export interface Candidate {
  value: string;                           // replaces [start,end)
  display?: string;                        // chip label = token only
  kind: 'command' | 'subcommand' | 'flag' | 'dir' | 'file' | 'value' | 'example' | 'history';
  description?: string;
  terminal: boolean;                       // choosing it yields a runnable line → run chip
  suffix?: ' ' | '/' | '';
}
export interface CompletionResult { start: number; end: number; candidates: Candidate[]; commonPrefix: string; }
export interface CompletionProvider { complete(line: string, cursor: number): CompletionResult; }
export interface CommandMeta {
  name: string; summary: string;
  args: 'none' | 'optional' | 'required'; // run vs insert chip
  cancellable?: boolean;
  timeoutMs?: number;                      // backstop; default 20000 when cancellable
  loadingLabel?: (args: string[]) => string;
  followUps?: (args: string[], ok: boolean) => string[];
  dataCost?: { bytes: number; confirmOnTouch: boolean };
}
export type TerminalEffect = { type: 'poweroff' } | { type: 'clearScreen' } | { type: 'resetSession' };
export type CommandResult = string | { output: string; effects?: TerminalEffect[]; status?: 'ok' | 'error' };

// ───────── src/terminal/controller.svelte.ts ─────────
export type InputSource = 'keyboard' | 'chip' | 'cmd-link' | 'key-bar' | 'history-sheet';
export type TerminalState =
  | { kind: 'idle' }
  | { kind: 'running'; entryId: string; command: string; label: string; startedAt: number; cancellable: boolean }
  | { kind: 'prompt'; request: PromptRequest }
  | { kind: 'off' };
export interface PromptRequest {
  kind: 'secret' | 'confirm' | 'text'; message: string; defaultValue?: 'y' | 'n';
  resolve(value: string | null): void;     // null = ^C
}
export interface CompletionOutcome { applied: boolean; candidates: Candidate[]; presses: number; selected: number | null; }
export interface TerminalController {
  readonly state: TerminalState;           // $state-backed getters
  readonly line: string; readonly cursor: number; readonly composing: boolean;
  readonly completion: CompletionOutcome | null;
  submit(source: InputSource, text?: string): Promise<void>; // normalise(); ignored (bell) while running
  interrupt(): void;                       // abort run | cancel prompt | echo 'line^C' + new prompt
  clearScreen(): void;                     // keeps line + history
  historyPrev(): void; historyNext(): void;
  complete(dir?: 1 | -1): CompletionOutcome; // 1: common prefix, 2: list, ≥3: cycle (Shift+Tab = -1)
  applyCandidate(c: Candidate, opts?: { run?: boolean }): void;
  insertAtCursor(text: string): void;      // setRangeText + 'input' event; deferred until compositionend
  moveCursor(delta: -1 | 1): void;
  setLine(text: string): void;
  escape(): void;                          // close sheet/menu; else blur (hide keyboard)
  focus(o: { openKeyboard: boolean }): void; // openKeyboard only inside a user gesture
  blur(): void;
  powerOn(): void;
}
export function createTerminalController(deps: {
  provider: CompletionProvider; meta: Record<string, CommandMeta>;
  run: (line: string, signal: AbortSignal) => Promise<CommandResult>;
  bell: () => void; input: () => HTMLInputElement | null;
}): TerminalController;

// ───────── src/terminal/suggestions.ts (pure) ─────────
export type ChipAction = 'run' | 'insert' | 'replace-token' | 'confirm' | 'interrupt' | 'more';
export type ChipKind = 'starter' | 'recent' | 'run-current' | 'completion' | 'followup' | 'didyoumean'
  | 'confirm' | 'cancel' | 'retry' | 'more';
export interface Chip {
  id: string; label: string; text: string; action: ChipAction; kind: ChipKind;
  glyph?: '⏎' | '/' | '→' | '↺' | '↻' | '✕'; ariaLabel: string; emphasis?: boolean;
}
export interface ChipContext {
  line: string; cursor: number; state: TerminalState;
  last?: { command: string; ok: boolean }; recent: readonly string[]; env: EnvInfo;
}
export const STARTER_CHIPS: readonly string[]; // ['help','cat README.md','fastfetch','ls','theme ls','cathode ls','weather Gadigal','whoami','qr vesen.app','email']
export function buildChips(ctx: ChipContext, provider: CompletionProvider, meta: Record<string, CommandMeta>): Chip[]; // ≤ 12 + 'more…'
export function normaliseCommandLine(raw: string): string; // normalise.ts

// ───────── src/ui/keys.ts (pure) ─────────
export type KeyAction =
  | { type: 'complete' } | { type: 'historyPrev' } | { type: 'historyNext' } | { type: 'interrupt' }
  | { type: 'clearScreen' } | { type: 'escape' } | { type: 'blur' } | { type: 'focus' }
  | { type: 'symbols' } | { type: 'cursor'; delta: -1 | 1 } | { type: 'insert'; text: string }
  | { type: 'historySheet' };
export interface KeyDef {
  id: string; label: string; ariaLabel: string; action: KeyAction;
  longPress?: KeyAction; repeat?: boolean;
  enabled?: (s: TerminalState) => boolean; emphasis?: (s: TerminalState) => boolean;
}
export const DEFAULT_KEYS: readonly KeyDef[]; // tab ↑ ↓ ^C clear ••• ⌄
export const SYMBOL_KEYS: readonly KeyDef[];  // esc | > / - ~ * " $ ← → •••
export const CLOSED_KEYS: readonly KeyDef[];  // '⌨ Type a command…'  ↑  clear
export function runKey(a: KeyAction, c: TerminalController): void;

// ───────── src/render/html.ts ─────────
export const h: {
  esc(s: string): string;
  cmd(command: string, label?: string, mode?: 'run' | 'insert'): string; // <button type=button class=cmd-link data-cmd data-mode>
  ext(t: LinkTarget, plan?: OpenPlan): string;                             // <a class=ext-link …>label ↗</a> [+ copy/escape]
  copy(text: string, label?: string): string;                              // <button class=copy-btn data-copy>
  art(text: string, cols: number, alt: string): string;                    // <pre class=out-art aria-hidden style=--art-cols:N> + sr-only alt
  cols(items: string[], minCh: number): string;                            // <div class=out-cols style=--col-ch:N>
  notice(tone: 'info' | 'ok' | 'warn' | 'error', html: string): string;
};
```

## What the visitor sees

## A. First visit from the Instagram profile link (iOS WKWebView or Android WebView, portrait)
- **No white flash.** The theme background and theme-color are painted by the pre-paint boot script.
- **The banner** is drawn in Vesen Mono, scaled with cqi to the width. It has no wrapping, no row gaps and no sideways panning at 320-430 px. Below it come:
  - 'v1.2.0 · a terminal by Has Salvesen'
  - 'Tap help to see all commands, or cat README.md to learn more.' Here `help` and `cat README.md` are dotted cyan command links that run when tapped.
- **The prompt** reads `guest@vesen:~$` with a dim block caret. The keyboard is NOT open.
- **The dock** shows two rows with the keyboard closed:
  - starter chips that scroll sideways: [help ⏎] [cat README.md ⏎] [fastfetch ⏎] [ls ⏎] [theme ls ⏎] [cathode ls ⏎] [weather Gadigal ⏎] [whoami ⏎] [qr vesen.app ⏎] [email ⏎];
  - a bar: [⌨ Type a command…] [↑] [clear].
- **The CRT runs in lite mode**: static scanlines and vignette over the screen only, never over the dock.
- **Pinch-zoom works.** Double-tapping dock keys does not zoom.
- **No up-front 'open in Safari' banner.** In-app limits are explained only when an action needs them.

## B. Exploring by tapping
- **⏎ chips run immediately**; the keyboard stays closed. Long-pressing a chip inserts its text instead, for editing.
- **After a run, chips become follow-ups**, for example:
  - after `theme ls`: [theme set wombat ⏎] …
  - after `ls`: [cd documents/ /] [cat README.md ⏎]
  - after `help`: [man ls ⏎]* [fastfetch ⏎] (*only once the shell workstream ships man)
- **Commands can be built from chips.** Tap `theme` to get 'theme ', and chips [ls ⏎] [set →] appear. Tap `set` to list the theme names, each one a run chip.
- **Chip labels show only the token being completed**; the aria-label says the full action, for example 'Run: theme set wombat'.
- **When the line is a complete, valid command**, the first chip is [⏎ <line>].
- **Tapping an earlier command's echo** puts that command in the prompt.
- **↑ with the keyboard closed** fills in the previous command without opening the keyboard, and [⏎ <line>] runs it.

## C. Typing (keyboard open)
- **Layout.** The shell shrinks to the visible area. From the bottom up: keyboard (plus the iOS accessory bar), key bar, chip row, then the sticky prompt.
- **No focus zoom.** The input is a real 16px, drawn at 13px.
- **Keyboard behaviour.** The return key reads 'go'. Smart dashes and quotes are undone, so `ls —help` runs as `ls --help`.
- **Key bar (full mode):** [tab] [↑] [↓] [^C] [clear] [•••] [⌄].
  - ••• opens the symbols page: [esc] [|] [>] [/] [-] [~] [*] ["] [$] [←] [→].
  - ← and → repeat while held.
  - ⌄ hides the keyboard.
  - Each key is at least 44x44 px. Pressing a key never takes focus from the input.
- **Compact mode** (visible height 300-459 px, e.g. iPhone SE with the keyboard open inside Instagram): one 44 px row with [tab] [↑] [^C] on the left and chips scrolling to their right. **Minimal mode** (under 300 px, landscape): keys only.
- **Tab:**
  - first press: completes a unique match or extends to the common prefix, and shows the candidates as chips;
  - second press: the chip row pulses and scrolls to its start (desktop lists the candidates in the scrollback, like bash);
  - third and later presses: cycle, with the selected chip highlighted;
  - no match: a visual bell (the prompt row flashes 120 ms; under reduced motion it shows a static underline instead).
- **History.** ↑ and ↓ walk history. Long-pressing ↑ opens the History sheet.
- **clear** clears the screen but keeps the current line.
- **^C** with an idle line echoes 'line^C' and shows a new prompt.
- **Hardware keyboard** (iPad or a keyboard case): the key bar hides after the first physical keystroke, chips stay, and `keys on` brings the bar back.

## D. Running
- The echo line appears at once. Below it the StatusLine shows '⠋ fetching forecast for Gadigal…'. After 6 s it adds ' — still working (tap ^C to cancel)'.
- The chips collapse to one emphasised 44 px [✕ cancel ^C], and the ^C key gets an accent border.
- The keyboard stays open and the input stays editable (type-ahead). Enter is ignored and rings the bell until the run finishes.
- If a cancellable command exceeds its backstop budget (20 s by default), it ends with 'weather: no response after 20 s.' and a [↻ retry] chip.
- Focus comes back to the prompt only if it was there at submit.

## E. Success and scrolling
- **Long output.** On touch, output taller than 75% of the screen (help, fastfetch, cat README.md) is scrolled so its echo line is at the top, with the sticky prompt still visible.
- **Short output** keeps the view at the bottom.
- **While scrolled up**, new output shows a '↓ New output' pill.
- **No page rubber-banding, no pull-to-refresh.** The scrollback is the only scroller.

## F. Errors
Errors have a red left border and say what to do next:
- 'hlep: command not found. Did you mean help?' with [help ⏎]. The bell is visual on touch and audible on desktop.
- When offline: 'you're offline. Reconnect, then tap ↻ retry.'
- Cancelled: a yellow notice and '^C' on the input line.
- If storage is blocked: the app still boots, and one line 'settings won't be saved in this browser' appears the first time the visitor changes theme or cathode.

## G. Links, email and in-app fallbacks
- **whoami** prints:
  - 'Has Salvesen'
  - '↗ linkedin.com/in/harrysalvesen'
  - '↗ github.com/hsalvesen'
  - '✉ has@salvesen.app [⧉ copy]'
  It auto-opens LinkedIn only on a desktop browser outside in-app browsers, and then prints '(opened in a new tab)'.
- **repo** works the same way.
- **Inside Instagram nothing navigates on its own.** Tapping a link opens it in the same view, and Back restores the terminal: scrollback, line and cwd come back from the session snapshot.
- **email** prints [✉ Open mail app] (a mailto anchor) and [⧉ Copy address].
  - After copying, the button shows '✓ Copied' for 2 s and announces it politely.
  - If copying fails, the address is selected and the hint reads 'Press and hold to copy'.
  - In an in-app browser it adds 'If Mail doesn't open, use Copy or open vesen.app in Safari: Tap ⋯ → Open in external browser' and an [Open in Safari ↗] chip. Android says Chrome and ⋮.
- **open --external** tries the escape URL. If the page is still visible after 1.2 s it prints the manual instruction.
- **qr on a phone** shows the code scaled to fit, the caption 'Show this to another phone's camera', and [⧉ Copy link] [Share…]. In-app, where sharing is unavailable, it shows a long-press save image.
- **sudo** shows '[sudo] password for guest:' and '(input hidden)'. Nothing is echoed, and there is no Passwords bar. After Enter: 'guest is not in the sudoers file. This incident will be reported.'
  - Desktop opens the joke link in a new tab.
  - Phones and in-app browsers print '▶ View incident report ↗', which opens only when tapped.
- **poweroff** prints systemd-style lines, fades (instantly under reduced motion), then shows '● vesen is off' and [⏻ Power on]. In-app it adds the hint 'Close this page with ✕'. The visitor is never left on a dead page.
- **speedtest** on touch, Save-Data or cellular asks 'speedtest downloads about 40 MB. Continue? [y/N]' with [y — run it] [N — cancel].

## H. Rotation and resize
- Nothing re-runs.
- help, ls and history columns reflow through the CSS grid.
- The banner and QR codes rescale.
- fastfetch, weather and stock switch between side-by-side and stacked layouts through container queries.
- No output ever causes page-level horizontal scroll. Very wide art scrolls inside its own block.
- Safe areas pad the notch side in landscape.

## I. Desktop
- The classic framed terminal: inline prompt, autofocus, and clicking blank space refocuses.
- No dock and no starter chips.
- Completion candidates appear as clickable chips under the prompt, replacing the plain 'Suggestions:' text.
- Keys: Tab completes, lists and cycles; Shift+Tab cycles backwards; ↑/↓ walk history; Ctrl+C copies when text is selected and interrupts otherwise; Ctrl+L clears; Esc dismisses completion.
- The CRT is in full mode unless the device is constrained.
- `?dock=1` shows the dock for development, and `?fx=lite` previews the phone tier.

## J. Accessibility
- Pinch-zoom is restored everywhere.
- The input is labelled 'Terminal command'. The scrollback is role=log with aria-live=polite, and aria-busy while a command runs.
- The prompt is a span; the page has one visually hidden h1.
- ASCII art and QR codes are aria-hidden and have screen-reader alternative text.
- Chips use listbox and option roles, and the input's aria-activedescendant follows Tab cycling. Keys are a labelled toolbar.
- Chips, keys and text reach 4.5:1 contrast in all 10 themes. Cockatoo switches color-scheme to light.
- Reduced motion, reduced transparency, more contrast and forced colours are all honoured.

## K. Link preview and Add to Home Screen
- Shared in Instagram DMs, iMessage, WhatsApp, LinkedIn or Slack, the link shows og.png, the title 'Vesen — a terminal in your browser' and a short description.
- Add to Home Screen gives the 'Vesen' icon and a standalone launch with safe-area padding.
- The browser chrome takes the theme colour where theme-color is honoured, and follows `theme set`.

## Files

| Path | Purpose |
|---|---|
| `index.html` | Head changes: - viewport `width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content` (drop maximum-scale and user-scalable, line 6; ships in slice S2) - theme-color #222235; color-scheme 'dark light' - format-detection 'telephone=no, email=no, address=no' - description and canonical https://www.vesen.app/ - og:type, site_name, title, description, url, image (absolute, 1200x630) and image:alt - twitter:card summary_large_image - PNG and SVG icon links, apple-touch-icon, manifest - apple-mobile-web-app-title Vesen; status-bar-style black-translucent; mobile-web-app-capable - font preload - `<!--boot-->` placeholder for the Vite-injected pre-paint script - a visually hidden `<h1>Vesen terminal</h1>` - a noscript fallback  Body: remove `min-h-screen` (line 12), `h-screen p-4` (line 13) and the hard-coded `class=dark`. |
| `vite.config.ts` | About 25 lines for a transformIndexHtml plugin. It injects an inline try/catch boot script whose theme-to-background map is generated from themes.json. The script reads the 'vesen.theme.v1' key (falling back to legacy 'colorscheme'), sets the html background and meta theme-color, and adds `touch` when `(pointer:coarse)`. |
| `public/manifest.webmanifest` | name 'Vesen Terminal', short_name 'Vesen', id '/', start_url '/', scope '/', display standalone, background_color and theme_color #222235, icons 192, 512 and maskable 512. |
| `public/icons/{icon.svg,icon-192.png,icon-512.png,icon-maskable-512.png,apple-touch-icon.png}, public/favicons/<theme>.{svg,png}` | Icon set generated from one SVG: a 152x152 rx4 square on a 180 viewBox plus the white cursor bar, measured from the existing ICOs. - apple-touch-icon is 180 px, flattened onto #222235. - Per-theme favicons are an SVG (about 200 B) plus a 32 px PNG. - Delete the ten 133,982 B ICOs in the same PR; only theme.ts:63 references them. |
| `public/og.png` | 1200x630 Swamphen card: the banner plus 'guest@vesen:~$ fastfetch▌'. Key content stays inside the central 630x630 square because some platforms crop square. Rendered by scripts/og/render.mjs. |
| `public/404.html` | Standalone terminal-styled 404 ('bash: cd: /missing: No such file or directory', with a link to '/'). Used by Firebase once the catch-all is removed, and by busybox through httpd.conf. |
| `public/fonts/vesen-mono.woff2` | Subset of the bundled Cascadia Code: Basic Latin, Latin-1, General Punctuation, arrows, box drawing U+2500-257F, blocks U+2580-259F, geometric shapes, braille U+2800-28FF and ⏎. About 40 KB. Remove the unreferenced public/fonts/CascadiaCode.ttf (648,736 B) from public; it moves to scripts/fonts/src/. |
| `public/README.md` | Remove the hard wraps at about 80 columns so paragraphs reflow on 43-column phones. Use 'Tap or type help' copy. |
| `firebase.json` | - Remove the '**' to /index.html rewrite (lines 9-14). - headers:   - '/' and '/index.html': `Cache-Control: no-cache`   - '/assets/**' and '/fonts/**': `public, max-age=31536000, immutable`   - '**/*.@(png\|svg\|webmanifest)': `max-age=604800`   - '/manifest.webmanifest': `Content-Type: application/manifest+json` |
| `httpd.conf` | Change `E404:index.html` (line 1) to `E404:404.html`. Add `.webmanifest:application/manifest+json` and `.woff2:font/woff2` for the Docker image. |
| `src/main.ts` | Composition root: readProbe, detectEnvironment, applyDocumentClasses, startViewportController, restoreSnapshot, then mount(App, {target, context: new Map([[PLATFORM_KEY, platform]])}). It is wrapped in try/catch and renders a plain boot-error message if mount throws. |
| `src/platform/probe.ts` | The only reader of navigator, matchMedia, location and CSS.supports. Builds EnvProbe. |
| `src/platform/env.ts` | Pure `detectEnvironment(probe)`. - Holds the ordered IN_APP_RULES user-agent table. - Detects iPadOS that reports MacIntel with maxTouchPoints above 1. - Uses utm_source=ig as a secondary Instagram hint. - Supports the ?env=ig-ios\|ig-android\|safari\|chrome and ?debug=1 overrides. - Provides menuHint copy and the escape-href builder. |
| `src/platform/storage.ts` | SafeStorage, which wraps local and session storage in try/catch with an in-memory fallback, plus `persisted<T>(key, codec, fallback)`. Fixes F001. |
| `src/platform/viewport.ts` | Pure `computeViewport(sample, baseline)` and `startViewportController(opts)`. Writes CSS variables and classes; exposes the Readable `viewport` store. |
| `src/platform/perf.ts` | Pure `decideCrtQuality(env, override, frameP90?)`, `probeFrames()` and the visibilitychange pause class. |
| `src/platform/links.ts` | - Pure `planOpen(target, env)`. - `openExternal(target)` returns `{html, opened}`. It only auto-opens on a fine pointer outside in-app browsers, through an anchor click, and must be called synchronously inside the user-gesture task. - `tryEscape(info)`. - `shareOrSave(file)`. |
| `src/platform/clipboard.ts` | `copyText()`: navigator.clipboard, then a hidden textarea with execCommand('copy'), then false (the UI then selects the text and shows 'Press and hold to copy'). |
| `src/platform/head.ts` | `syncHead(theme)`: - sets meta theme-color; - sets color-scheme (light when the background's relative luminance is above 0.5, e.g. cockatoo #e8ddd0); - toggles html.dark; - sets --theme-cursor; - swaps the SVG and PNG favicons with `setAttribute`, which fixes theme.ts:71,78. |
| `src/platform/bell.ts` | `ring()`. The setting is auto, audible, visual or off; auto means visual on touch and audible on desktop. Uses one lazily created AudioContext resumed on the first gesture, and `navigator.audioSession.type='ambient'` where supported. Re-exported as `playBeep` so the call sites at commands.ts:332,353,359 and network.ts:54,104,215 keep working. beep.js is deleted. |
| `src/platform/session.ts` | SessionSnapshotV1 saved on pagehide and when the page becomes hidden. Restored only when the navigation type is back_forward, the snapshot is under 30 minutes old and under 1 MB. A normal reload still starts fresh (history.ts:5-7). |
| `src/platform/debug.ts + src/components/DebugOverlay.svelte` | ?debug=1 fixed readout: env, inApp, innerHeight, vv height, offsetTop and scale, kb-open, dockMode, crt tier and reason, frame p90. |
| `src/terminal/contracts.ts` | Candidate, CompletionResult, CompletionProvider, CommandMeta, TerminalEffect, CommandResult. Shared with the autocomplete, shell and network workstreams. |
| `src/terminal/controller.svelte.ts` | TerminalController (runes class). Takes over the run lifecycle and state from Input.svelte:22-642: - history cursor, abort, backstop timeout, sudo and secret PromptRequest, Ctrl+L, Tab press counting; - insertAtCursor through setRangeText; - composition guard; - effects application; - focus policy helpers. |
| `src/terminal/legacyCompletion.ts` | The existing Tab ladder from Input.svelte:381-613 and getCommandSuggestions (commandSuggestions.ts:38), wrapped as a CompletionProvider until the autocomplete engine (F022) replaces it. |
| `src/terminal/suggestions.ts` | Pure `buildChips(ctx, provider, meta)`: - starters, recents, run-current, completion candidates (run or insert), follow-ups, did-you-mean, confirm, cancel and retry; - at most 12 chips plus 'more…'; - command lookups use Object.hasOwn, so 'constructor' is never offered (F031). |
| `src/terminal/normalise.ts` | `normaliseCommandLine()`: — or – at the start of a token become --; curly quotes become straight; … becomes ...; NBSP becomes a space. |
| `src/render/html.ts` | `h.esc`, `h.cmd(command, label?, mode)`, `h.ext(target)`, `h.copy(text, label)`, `h.art(text, cols, alt)`, `h.cols(items, minCh)`, `h.notice(tone, html)`. Every helper escapes its text and attribute inputs. |
| `src/ui/keys.ts` | Pure DEFAULT_KEYS, SYMBOL_KEYS, CLOSED_KEYS and `runKey(action, controller)`. |
| `src/ui/longPress.ts` | Svelte action: long-press after 450 ms; hold-to-repeat after a 400 ms delay, then every 80 ms; cancelled by pointermove over 10 px so chip scrolling still works. |
| `src/App.svelte` | A thin grid shell: Screen and Dock (touch, unless 'keys off' or a hardware keyboard is detected), plus DebugOverlay. Deletes App.svelte:12-56 and the on:show, on:hide and on:update wiring (:85). |
| `src/components/Screen.svelte` | The scroller (role=log, aria-live=polite, aria-relevant=additions, aria-busy while running, container term). Holds Scrollback, the sticky PromptLine, StatusLine, filler, NewOutputPill and the absolute Cathode overlay. Applies the stickToBottom action and the focus policy. One delegated click handler for [data-cmd], .ext-link, .copy-btn and past-command echoes. |
| `src/components/PromptLine.svelte (replaces Input.svelte)` | Ps1 plus a `<form>` around the 16px scaled input. It holds no business logic: keydown for non-character keys and submit both call the controller. Shows the '(input hidden)' hint for secret prompts. |
| `src/components/Ps1.svelte` | Uses `<span>` instead of `<h1>` (F094). Prompt is guest@<short host>:<cwd>$, where the host is 'vesen' or 'localhost' ('www.vesen.app' only when the container is at least 60ch and the owner wants it). The cwd comes from the shell workstream's cwd store, or from a cwd prop for each history entry (F023). The path is trimmed to '…/a/b' under 40ch. |
| `src/components/Scrollback.svelte (was History.svelte)` | Keyed entries with their recorded cwd. Echoed commands are `<button data-cmd data-mode=insert>` on touch, and remain text interpolation, so they stay escaped. Removes applyResponsiveWrapping (:20) and the vw rules (:75-108). |
| `src/components/StatusLine.svelte` | `⠋ <loadingLabel>… 3s`. After 6 s it appends ' — still working (tap ^C to cancel)' (desktop: 'Ctrl+C'). Under reduced motion it shows a static '…' and the elapsed seconds. |
| `src/components/NewOutputPill.svelte` | '↓ New output' button above the dock when output arrives while the visitor is scrolled up. |
| `src/components/Dock.svelte, ChipRow.svelte, KeyBar.svelte` | - Modes: full (chips 40 px plus keys 44 px), compact (one 44 px row: tab, ↑, ^C, then chips) and minimal (keys only). - A keyboard-closed bar and a symbols page. - Every root calls preventDefault on pointerdown and mousedown. - ChipRow is `role=listbox id=chip-listbox` with `<button type=button role=option aria-selected>` chips. - KeyBar is `role=toolbar` with aria-labels; buttons have tabindex=-1, user-select:none, -webkit-touch-callout:none and a transparent tap highlight. - On desktop, ChipRow also renders inline under the prompt while completing (placement='inline'). |
| `src/components/HistorySheet.svelte` | Opened by long-pressing ↑. A bottom sheet up to 60% of --app-h, newest first. Tapping a row inserts it and its ⏎ runs it. ✕, an outside tap or Esc closes it. Empty state: 'No commands yet. Try help.' |
| `src/components/PowerOffScreen.svelte` | Controller state 'off': systemd-style lines, a fade (skipped under reduced motion), '● vesen is off' and [⏻ Power on] (desktop: 'press any key'). In-app it adds a close hint. Replaces fileSystem.ts:503-578. window.close is never called. |
| `src/components/Cathode.svelte` | Unchanged markup. It now lives inside .screen-frame with position:absolute. |
| `src/components/CommandSuggestionsRow.svelte` | Deleted; replaced by ChipRow (inline placement on desktop). Resolves F067. |
| `src/styles/tokens.css, shell.css, terminal.css, dock.css, crt.css` | Split from app.css, which becomes the import hub. - crt.css takes app.css:100-277 with % units, the lite and off tiers, the page-hidden pause, the slowed flicker and the contrast and forced-colors rules. - Deletes the app.css:25-78 mobile block. |
| `src/stores/theme.ts, cathode.ts, history.ts, settings.ts (new)` | - theme.ts uses persisted('vesen.theme.v1'), with a one-time migration from 'colorscheme'. - cathode.ts uses persisted('vesen.cathode.v1'), plus quality. - history.ts drops the per-change writes at :22-28 and the throwing removeItem at :6-7, replacing them with a SafeStorage cleanup. - settings.ts holds {bell, crtQuality, keys}. - DOM side effects move to head.ts (F030 partial). |
| `src/interfaces/command.ts` | Command gains `id`, `cwd`, `source?` and `status?` ('ok', 'error', 'cancelled' or 'timeout'). |
| `src/utils/commands.ts` | - help becomes h.cols of h.cmd links (:26-48). - history becomes a hanging-indent grid of insert links (:59-102). - repo, email and sudo go through openExternal (:112, :274, :293). - New commands: 'open'/'xdg-open <url> [--external]', 'keys on\|off\|auto', 'bell', and 'cathode quality'. - One ABORTABLE set, from CommandMeta.cancellable, replaces commands.ts:343 and Input.svelte:296-299. |
| `src/utils/commands/system.ts` | - whoami prints LinkedIn, GitHub and email (with copy) and auto-opens LinkedIn only on desktop (:10). - banner becomes h.art (44 cols) plus a 'v1.2.0 · a terminal by Has Salvesen' line, with Tap or Type copy depending on pointer (:589-597). - fastfetch uses the container query instead of isMobileDevice (:573-574), and its Terminal field reports the in-app browser. |
| `src/utils/commands/fileSystem.ts` | - ls becomes h.cols, with directories as insert links (:112-147). - poweroff returns the effect `{type:'poweroff'}` (:503-578). |
| `src/utils/commands/network.ts, qr.ts` | Interim changes in this workstream: - curl: `max-width:100%` instead of px or 'nonepx' (:196-199). - speedtest: a confirm PromptRequest via CommandMeta.dataCost. - qr: h.art(fit scale, line-height 1, min 4 px) plus [Copy link] and [Share…]/[Save image] on phones.  The weather and stock bodies belong to their own workstreams and must follow the width-agnostic contract. |
| `src/utils/textWrap.ts, src/utils/mobile.ts` | textWrap.ts is deleted in S7. mobile.ts is deleted when the weather and stock rewrites land; until then network.ts is allow-listed in check-boundaries.sh. |
| `scripts/check-boundaries.sh, scripts/fonts/subset.py, scripts/icons/make-icons.sh, scripts/og/{og.html,render.mjs}` | - check-boundaries.sh: rg guard; report-only until S7, failing afterwards. - subset.py: fontTools and brotli subset. - make-icons.sh: sips or rsvg-convert icon renders. - render.mjs: Playwright OG screenshot. |
| `package.json, tsconfig.strict.json, vitest.config.ts, playwright.config.ts, lighthouserc.json, tests/unit/*, tests/e2e/*, tests/e2e/fixtures/fakeVisualViewport.ts` | devDependencies: vitest, happy-dom, @playwright/test and optionally @lhci/cli. Scripts: test, test:e2e, check:boundaries, assets:icons, assets:og, assets:font. strict:true for src/platform, src/terminal, src/render and src/ui. |
| `.github/workflows/firebase-hosting-pull-request.yml` | Today it only runs `npm ci && npm run build`. Add npm run check (expect 0 errors), check:boundaries, test and test:e2e (Chromium and WebKit) before the preview deploy that device QA uses. |

## External services

- No new third-party runtime APIs. This workstream is client-platform work; the weather, stock and qr data sources belong to their own workstreams.
- window.visualViewport (height, offsetTop, scale; resize and scroll events). Supported on iOS 13+, Chrome 61+ and Android WebView 61+. Events fire during the iOS keyboard animation, so updates are rAF-throttled and re-measured at 50, 300 and 600 ms.
- Viewport meta keys:
- `interactive-widget=resizes-content`: Chrome and Firefox for Android; ignored by iOS.
- `viewport-fit=cover`: required for `env(safe-area-inset-*)`.
- CSS features and support:
- dvh: iOS 15.4+, Chrome 108+.
- Container queries and cqi: iOS 16+, Chrome 105+. Fallback: overflow-x:auto art and stacked layouts.
- lh: iOS 16.4+. Fallback: calc(var(--term-font) * 1.35).
- color-mix: iOS 16.2+. Needs an rgba fallback.
- overscroll-behavior: iOS 16+.
- content-visibility: Chrome 85+, Safari 18+.
- matchMedia queries: (pointer: coarse), (any-pointer: fine), (hover: none), (prefers-reduced-motion), (prefers-reduced-transparency) (Chromium only), (prefers-contrast: more), (forced-colors: active), (display-mode: standalone). Also navigator.standalone on iOS.
- Chromium-only hints, never requirements: navigator.connection.saveData and .type, navigator.deviceMemory.
- Clipboard: navigator.clipboard.writeText (secure context plus user gesture), falling back to document.execCommand('copy'). Web Share: navigator.share and canShare({files}), feature-detected because they are often missing in WebViews. Audio Session: navigator.audioSession (Safari 16.4+).
- Escape-to-browser URLs. Both are best-effort, offered only on a tap, and always shown next to the manual menu instruction.
- iOS 17+: `x-safari-https://www.vesen.app/` (undocumented).
- Android: `intent://www.vesen.app/#Intent;scheme=https;action=android.intent.action.VIEW;S.browser_fallback_url=https%3A%2F%2Fwww.vesen.app%2F;end` (no package, so the default browser opens).
- In-app browser user-agent rules, in order:
- Messenger: FBAN/Messenger | Orca-Android
- Facebook: FBAN | FBAV | FB_IAB | FBIOS
- Instagram: \bInstagram\b
- Threads: Barcelona (to verify)
- TikTok: musical_ly | BytedanceWebview | TikTok
- LinkedIn: LinkedInApp
- Snapchat: Snapchat
- Twitter: Twitter
- LINE: \bLine\/
- WeChat: MicroMessenger
- Generic WebView: Android '; wv)', or iOS AppleWebKit without 'Safari/' and not CriOS, FxiOS or EdgiOS.
Chrome Custom Tabs carry Chrome's UA and are correctly treated as Chrome.
- mailto:has@salvesen.app?subject=<encoded>. The address is already public in package.json author.email. It is rendered as a user-tapped anchor.
- Open Graph and Twitter Card scrapers. og:image must be an absolute https URL. Re-scrape after deploy with the Meta Sharing Debugger (https://developers.facebook.com/tools/debug/), and check LinkedIn Post Inspector, iMessage and WhatsApp.
- Firebase Hosting config: headers, rewrites and 404.html. The apex-to-www redirect is configured in the Firebase console; today both apex and www serve 200.
- Firebase PR preview channels (existing workflow), used to put builds on real phones and inside Instagram by sending the preview URL to yourself in an Instagram DM.
- Dev-only tools: fontTools with brotli, sips or rsvg-convert, Playwright, vitest with happy-dom, @lhci/cli.
- Cross-workstream dependency: the starter chip 'weather Gadigal' needs the weather workstream's alias table (F060: Gadigal is Sydney -33.87,151.21; Aotearoa is Wellington). Today wttr.in resolves both, but Open-Meteo geocoding does not.

## Steps

1. S0 — Harness and QA tools (0.5 d).
- Add vitest + happy-dom, @playwright/test, tsconfig.strict.json, and the scripts test, test:e2e and check:boundaries (report-only for now).
- Add src/platform/probe.ts and env.ts with the user-agent fixture table and unit tests.
- Add the DebugOverlay behind ?debug=1, and the ?env=, ?dock=1 and ?fx= overrides.
- Wire check, test and check:boundaries into .github/workflows/firebase-hosting-pull-request.yml, which today only runs `npm ci && npm run build`.
2. S1 — Boot safety, head and hosting (1 d). Do NOT touch the viewport meta yet.
- Storage: src/platform/storage.ts, then migrate theme.ts:86, cathode.ts:56 and history.ts:6-7,22-28 to SafeStorage and persisted(), with a one-time import of the legacy 'colorscheme' key. Wrap mount() in main.ts with a boot-error fallback.
- Head: src/platform/head.ts (theme-color, color-scheme, --theme-cursor, favicon via setAttribute). npx svelte-check goes from 2 errors to 0.
- index.html: OG, Twitter, canonical, format-detection, manifest, apple-touch-icon and icon tags.
- Pre-paint: the Vite boot-script plugin.
- Assets: the icon set via scripts/icons, og.png via scripts/og, manifest.webmanifest, 404.html. Delete the ten ICOs.
- Hosting: firebase.json headers and removal of the catch-all rewrite; httpd.conf changes `E404:index.html` to `E404:404.html` and adds the MIME lines. Configure the apex-to-www redirect in the console.
- Acceptance: curl -I shows image/png for /og.png and /apple-touch-icon.png, 404 for /assets/missing.js, and no-cache for /. The Meta Sharing Debugger shows the card.
- Resolves: F001; F030 (partial, theme DOM effects).
3. S2 — Zoom, input and typography (1 d). Ship as ONE PR.
- Zoom: the viewport meta drops maximum-scale and user-scalable and adds viewport-fit=cover and interactive-widget.
- Input: the 16px scaled input on `(pointer:coarse)`. enterkeyhint=go, aria-label 'Terminal command', autocapitalize=none.
- Disabled state: remove `disabled` (Input.svelte:305, :354, :667); keep readonly and aria-busy for now. Delete the dead displayValue (:39-48) and the invalid `:readonly` rule (:701).
- Overflow: grid `max-content minmax(0,1fr)` plus a min-w-0 wrapper (App.svelte:78) fixes the 320 px overflow.
- Prompt: Ps1 uses <span> and the short host 'vesen'.
- Font: scripts/fonts/subset.py produces vesen-mono.woff2. Add @font-face, a preload and tokens.css. Replace the 17 `font-family: monospace` overrides. Move CascadiaCode.ttf out of public/.
- QA gate: tapping the prompt in iOS Safari and iOS Instagram does not zoom, pinch works, and the caret and selection handles sit right. Otherwise flip the --input-scale-off kill switch.
- Resolves: F077; F012 (partial); F094 (partial: input label, Ps1 not h1).
4. S3 — Shell, viewport controller, focus and scroll (1.5 d).
- Shell: the App.svelte grid with Screen and Dock placeholder, styles split into src/styles/*, html/body lockdown, safe areas and overscroll containment. Phones edge to edge; desktop framed.
- Viewport: src/platform/viewport.ts with computeViewport sequence tests.
- CRT overlay: move Cathode inside .screen-frame (absolute) and convert vh to %.
- Scrolling: the stickToBottom action, NewOutputPill and long-output anchoring on touch. Delete App.svelte:17-56, Input.svelte:160-189 and the app.css:25-78 mobile block.
- Focus: the pointer-aware focus policy replaces Input.svelte:645-651. No autofocus on touch (Input.svelte:142). Refocus only if focused at submit.
- Scrollback: role=log, aria-live and aria-busy.
- Resolves: F076, F011; F094 (live region).
5. S4 — TerminalController extraction (1.5-2 d). Agree contracts.ts with the autocomplete and shell workstreams first.
- Move the run lifecycle, history cursor, sudo, abort and Ctrl+L from Input.svelte:22-642 into controller.svelte.ts.
- Move the Tab ladder (:381-613) verbatim into legacyCompletion.ts behind CompletionProvider.
- PromptLine.svelte uses <form> submit. keydown handles only non-character keys. Ctrl+C interrupts only when nothing is selected. Add the composition guard and normaliseCommandLine on submit.
- Type-ahead: drop readonly; Enter is ignored and rings the bell while running. QA gate: the iOS keyboard stays open across ls, help and weather.
- Secret prompt: type=text with transparent text.
- One ABORTABLE set from CommandMeta.cancellable, replacing commands.ts:343 and Input.svelte:296-299, plus the backstop timeout (default 20 s) through a combined AbortController.
- StatusLine with the label, elapsed time and the 6 s cancel hint.
- Resolves: F012 (fully); F047 (partial: tappable cancel, elapsed time and a backstop timeout; per-request fetchWithTimeout stays with the network workstream); F022 (UI seam only).
6. S5 — Dock and chips (2 d).
- suggestions.ts with unit tests: starters, recents, run-current, completion run or insert by CommandMeta.args with the trailing-space fallback, follow-ups, did-you-mean, confirm, cancel, retry, more…, and Object.hasOwn lookups.
- Dock, ChipRow (listbox/option, preventDefault on pointerdown and mousedown, edge fade, scrollLeft reset on change) and KeyBar (DEFAULT, SYMBOL and CLOSED keys; ⌄; longPress.ts; hold-to-repeat).
- HistorySheet; full, compact and minimal modes driven by the viewport store; hardware-keyboard detection plus `keys on|off|auto`.
- Echoed commands become insert buttons on touch.
- Delete CommandSuggestionsRow.svelte; desktop renders ChipRow inline while completing, with aria-activedescendant.
- Resolves: F067; F031 (chip lookups).
7. S6 — Links, in-app policy, poweroff and session (1 d).
- Add links.ts (planOpen and openExternal), clipboard.ts and session.ts.
- Migrate whoami (system.ts:10), repo (commands.ts:274), email (:293) and sudo (commands.ts:112, Input.svelte:248) to openExternal.
- Add the `open`/`xdg-open [--external]` command.
- Add PowerOffScreen and the poweroff effect, replacing fileSystem.ts:503-578 (stale selector, body.innerHTML takeover, window.close).
- Wire session snapshot save and restore into history.ts. Add the in-app contextual hints and the escape chip.
- e2e spies assert that window.open and window.close are never called under in-app user agents.
- Resolves: F030 (partial: poweroff and openUrl become effects or helpers, not DOM reach-ins).
8. S7 — Output reflow and accessibility of art (1 d).
- Add render/html.ts.
- help (commands.ts:26-48) becomes h.cols of h.cmd links, so names are tappable (F042 partial; descriptions and man stay with the shell workstream).
- ls (fileSystem.ts:112-147) becomes h.cols with directory insert links.
- history (commands.ts:59-102) becomes a hanging-indent grid.
- banner becomes h.art (44 cols, alt 'VESEN') plus the version line.
- fastfetch (system.ts:573-574) uses the container query.
- curl (network.ts:196-199) gets max-width:100%.
- qr becomes h.art scale (coordinate with the qr workstream).
- Remove applyResponsiveWrapping (History.svelte:20) and delete textWrap.ts.
- Switch check-boundaries.sh to failing mode, allow-listing only network.ts and mobile.ts until the weather and stock rewrites land.
- Unwrap the hard line breaks in public/README.md.
- Keep plain text inside spans so innerText stays pipe-friendly.
- Resolves: F016 (all paths except weather and stock, which get the written contract); F094 (art alternative text); F004 (partial: every new helper escapes, echoes stay as text interpolation, and the deep-link auto-run is not built).
9. S8 — CRT tiers, bell, theme polish and data-cost prompts (0.75 d).
- perf.ts decide and probe, html.crt-lite and crt-off, the page-hidden pause, the flicker slowed to ≤3 Hz, forced-colors and contrast rules, and `cathode quality auto|full|lite|off` with the reason shown in `cathode ls`.
- bell.ts replaces beep.js:4, visual by default on touch, plus the `bell` command.
- speedtest confirm PromptRequest through CommandMeta.dataCost on touch, Save-Data or cellular.
- Add content-visibility on old entries.
- Resolves: F079; F028 (partial: the confirmation; the light profile and progressive sizes stay with the network workstream).
10. S9 — Verification and device QA (1.5 d). Write the Playwright suites and the Lighthouse CI budgets. Deploy a preview channel, DM it to yourself on Instagram on both phones, run the 4-target checklist with ?debug=1, and fix what turns up. After the production deploy, re-scrape the OG card. File follow-ups for the weather, stock and qr workstreams covering the width-agnostic contract and the F060 alias table for 'weather Gadigal'.

## Testing

## Unit tests (vitest + happy-dom, tests/unit, all under 2 s)
- **env.test.ts**: a user-agent fixture table covering:
  - iOS Safari 16, 17 and 18; iOS Chrome (CriOS); iOS Firefox (FxiOS); iOS Edge;
  - Instagram on iOS and Android (Android carries '; wv)'); Facebook (FBAN/FBIOS); Messenger; Threads (Barcelona); TikTok; LinkedInApp; Snapchat;
  - Android Chrome; Samsung Internet; a Chrome Custom Tab (must NOT be flagged as in-app);
  - iPadOS desktop UA (MacIntel with maxTouchPoints 5); desktop Chrome, Safari and Firefox.
  It asserts app, os, osMajor, escapeHref (x-safari-https only on iOS ≥ 17; intent:// on Android) and menuHint, plus the ?env overrides.
- **storage.test.ts**: a throwing getter falls back to memory with persistent=false; QuotaExceeded makes set() return false; bad JSON falls back; the legacy 'colorscheme' migration works.
- **viewport.test.ts**: event sequences:
  - iOS keyboard (innerHeight 812, vv 812→456) opens and then closes;
  - Android resizes-content (innerHeight 812→480);
  - toolbar jitter under 150 px does not count as a keyboard;
  - scale 2 freezes tracking;
  - each orientation keeps its own baseline;
  - dockMode boundaries at 299, 300, 459 and 460.
- **perf.test.ts**: one case per reason, override precedence, and p90 > 25 ms.
- **links.test.ts**: planOpen across web and mail targets in Safari, Chrome, Instagram iOS and Instagram Android. In-app never auto-opens and uses `_self`; the mail subject is encoded; the intent href string is exact.
- **suggestions.test.ts**:
  - an empty line gives recents, then starters;
  - 'th' gives an insert chip 'theme ' labelled 'theme';
  - 'theme set w' gives run chips labelled Wallaby and Wombat with the full values;
  - 'cd doc' gives an insert chip 'cd documents/';
  - a valid line puts run-current first;
  - follow-ups after 'theme ls'; did-you-mean for 'hlep';
  - running gives only the cancel chip; confirm gives y and N;
  - 'constructor' never becomes a chip.
- **normalise.test.ts**: em and en dashes become --; curly quotes, ellipsis and NBSP are normalised.
- **controller.test.ts**:
  - submit while running is ignored and rings the bell;
  - interrupt aborts and marks the entry cancelled;
  - the backstop timeout marks the entry timeout;
  - clearScreen keeps the line;
  - Tab presses 1, 2, 3 give prefix, list, cycle, and Shift+Tab reverses;
  - insertAtCursor respects the selection and waits for compositionend;
  - the poweroff effect sets state 'off'.
- **html.test.ts**: esc covers &<>"'; cmd and ext escape their attributes; ext always sets rel=noopener noreferrer; art adds aria-hidden plus the screen-reader alternative.
- **keys.test.ts**: ids are unique; runKey routes each action to the right method.
- **session.test.ts**: restore only on back_forward and under 30 minutes; the 1 MB cap is enforced.

## End-to-end tests (Playwright against `vite preview`)
Projects:
- desktop-chromium, desktop-webkit;
- iphone-se (WebKit, 320x568), iphone-13 (WebKit), pixel-7 (Chromium);
- ig-ios and ig-android (the same devices with Instagram user agents).
The fixture fakeVisualViewport.ts replaces window.visualViewport with a controllable EventTarget (`__vv.set({height, offsetTop, scale})`) and spies on window.open and window.close.

Specs:
- **(a) meta**:
  - viewport has no maximum-scale or user-scalable=no and has viewport-fit=cover;
  - og:image is absolute and returns 200 image/png at 1200x630;
  - the manifest parses and its icons return 200;
  - theme-color becomes #e8ddd0 and color-scheme light after `theme set cockatoo`.
- **(b) input**: on touch projects the computed font-size is 16px and the box height matches the line height ±2 px. On desktop the font-size is unchanged.
- **(c) overflow**: `documentElement.scrollWidth <= innerWidth` at 320, 360, 375, 390, 412 and 430 portrait and at 667 and 844 landscape, after banner, help, ls -a, history, fastfetch, cat README.md, theme ls and qr vesen.app. The banner art has 6 line boxes.
- **(d) reflow**: after help at 390x844, resizing to 844x390 increases the grid column count without re-running.
- **(e) keyboard**:
  - after focus, `__vv.set({height:456})` puts the dock bottom at 456±1, the prompt within [0, dock.top], and sets html.kb-open;
  - scale 2 changes nothing;
  - a route-mocked 2 s command never sets `disabled`, and activeElement stays the input.
- **(f) focus**: tapping tab, ↑ or a chip keeps activeElement on the input. Tapping output does not focus the input on touch.
- **(g) chips**:
  - an unfocused 'help' chip runs help without focusing;
  - the long output is anchored within 16 px of the top;
  - 'th' then 'theme' then 'set' then 'swamphen' builds and runs `theme set swamphen`.
- **(h) keys**:
  - ⇥ on 'cath' gives 'cathode';
  - ↑ and ↓ walk history; a long-press on ↑ opens the sheet;
  - '|' inserts at the caret;
  - clear keeps the line.
- **(i) cancel and timeout**: `page.route('**/allorigins**' and '**/wttr.in/**', never resolve)`. Tapping ^C prints the cancelled notice and stops the spinner; with the backstop shortened through a test hook, the timeout message and the ↻ retry chip appear.
- **(j) links**:
  - desktop-chromium: repo calls window.open once and prints the link;
  - ig-*: window.open and window.close are never called, the links have no target=_blank, and email renders a mailto anchor and [data-copy];
  - poweroff then Power on brings back the prompt.
- **(k) perf**: touch and ig-* projects get html.crt-lite and `document.getAnimations()` is empty; desktop gets the running sweep; emulateMedia reducedMotion leaves no animations; `cathode quality full` persists across reload.
- **(l) session**: run ls, navigate to a stub page, go back, and the scrollback is restored; a reload shows a fresh banner.
- **(m) storage blocked**: an addInitScript that throws on localStorage still boots the app.
- **(n) visual snapshots** at 375x667, 390x844, 412x915 and 844x390: idle dock, typing with the keyboard faked, running, and error; Swamphen and Cockatoo.
- **(o) desktop regression**: no dock; inline chips while completing; Tab, Ctrl+C with a selection copies; the framed look is kept.

## Lighthouse CI (mobile, `vite preview`)
- Scores: Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 95.
- Budgets: initial JS ≤ 60 kB gzip (48.7 kB today), font ≤ 45 kB, og.png ≤ 150 kB.
- CLS < 0.05; INP < 200 ms for a chip tap at 4x CPU throttle.

## Static checks
npm run check reports 0 errors; check:boundaries passes; curl -I checks run after every deploy.

## Manual QA checklist
**Setup.** Use the Firebase PR preview URL, DM'd to yourself in Instagram to get the in-app browser, then a production smoke test from the real profile link. Append ?debug=1. Devices: an iPhone SE-size phone and a 6.1-inch iPhone (iOS 16 or 17, plus current); a Pixel or Samsung on current Android plus one older WebView; Gboard and Samsung Keyboard.

**All four targets (iOS Safari, iOS Instagram, Android Chrome, Android Instagram)**
1. No white flash. The banner fits with no row gaps; there is no sideways panning at any width; pinch-zoom works; double-tapping a key does not zoom.
2. Tapping the prompt opens the keyboard with NO zoom. The prompt, chips and keys sit flush above the keyboard and the iOS accessory bar, with no gap or overlap. ?debug=1 shows kb-open=true and the right dockMode.
3. The keyboard stays open across ls, help and `weather Gadigal`. ^C cancels; focus returns.
4. ⌄, iOS Done or Android back hides the keyboard. The shell returns to full height within 300 ms with no blank band, and the dock clears the home indicator.
5. Rotate both ways with the keyboard open and closed after help, ls, history and fastfetch. Everything reflows with no overflow; landscape plus keyboard gives the compact or minimal dock.
6. Chips: build `theme set wombat` by tapping; starter chips run without opening the keyboard; scrolling the chip row does not trigger a tap or edge-swipe back.
7. Keys:
   - ⇥ extends, lists and cycles;
   - ↑/↓ walk history; long-pressing ↑ opens the sheet;
   - ^C works on a line, on the sudo prompt and on a running command;
   - clear works; symbols insert at the caret; ← and → repeat while held.
8. Momentum scrolling of `cat linux.txt` stays inside the terminal. There is no rubber-banding or pull-to-refresh, and pulling down does not dismiss Instagram. The '↓ New output' pill appears when scrolled up.
9. Tapping output never opens the keyboard. Long-press selects and copies text. Tapping a past command inserts it.
10. `email`: copy works (verify by pasting); the mailto opens or the hint shows. `whoami` and `repo` links work. `sudo ls` causes no navigation in-app and shows no Passwords bar. poweroff then Power on works.
11. With Reduce Motion on: no sweep, flicker, smooth scroll or spinner animation. VoiceOver or TalkBack read 'Terminal command', the chip and key labels, and announce new output politely.
12. Performance: 50 commands with `cathode set vintage` and `cathode quality full`, then heavy scrolling, causes no reload or crash.
13. Cockatoo (light theme): chips and keys are legible and the scrollbars are light.

**iOS Safari only**
- The collapsing toolbar causes no jump.
- Landscape notch and home indicator are clear.
- Add to Home Screen shows the icon and 'Vesen', launches standalone, and pads the safe areas.
- The tab-bar tint follows `theme set`.
- With smart punctuation on, `ls —help` runs.
- Stock volumes and IPs are not auto-linked.
- Safari Web Inspector shows no console errors.

**iOS Instagram only**
- Opening from the bio link and from a DM both work; ?debug=1 shows inApp=instagram and crt lite.
- No 100vh overflow under Instagram's top bar.
- whoami → tap LinkedIn → Back restores the scrollback.
- [Open in Safari ↗] either opens Safari or the fallback hint appears within 1.2 s. Record the Instagram version.
- Long-pressing the qr image offers Save.
- The DM link preview shows og.png.
- The theme persists between Instagram sessions.

**Android Chrome only**
- interactive-widget resizes the content.
- Enter submits with Gboard and with Samsung Keyboard (predictive text on).
- Tapping [tab] mid-composition does not duplicate text.
- sudo input does not echo.
- speedtest asks for confirmation on mobile data.
- The address bar follows theme-color.
- Install uses the maskable icon.
- chrome://inspect shows no errors.

**Android Instagram only**
- The WebView is detected.
- The dock stays above the keyboard (adjustResize).
- The hardware back button from an external link restores the session.
- The intent:// escape opens the default browser or shows the hint.
- The copy fallback works.
- System Back leaves Instagram's browser in one step (no extra history entries).
- Quick smoke test in the Facebook and Threads in-app browsers.

**Desktop regression (Chrome, Safari, Firefox)**
- No dock.
- Inline completion chips; Tab, Shift+Tab, Ctrl+C copy versus interrupt, Ctrl+L.
- Framed look; full CRT.
- help, ls and history look as before, apart from the clickable names.
- The favicon swaps with the theme.

## Risks

- **iOS visualViewport timing.** Resize fires during the keyboard animation, and offsetTop can stay non-zero after dismissal. Mitigation: rAF throttling, re-measuring at 50, 300 and 600 ms, scrollTo(0,0) on focusout, no transition on the shell height, and ?debug=1 for on-device verification (Instagram cannot be remote-inspected).
- **Instagram's WebViews differ from Safari and Chrome** in keyboard resize mode, accessory bar, injected scripts, and how they handle target=_blank and mailto. None of this can be emulated, so the real-device QA pass (S9) is mandatory and its results are recorded per app version.
- **The scaled 16px input** may misplace selection handles, the loupe or the caret on some WebKit builds or Android IMEs. Mitigation: a one-variable kill switch gives a plain 16px line, and a QA gate in S2.
- **Keyboard persistence.** Making a focused input readonly (S2) may dismiss the iOS keyboard. S4 removes readonly entirely in favour of type-ahead with submit blocked; this is QA-gated.
- **IME composition.** Programmatic edits (Tab, chips, symbols) during a Gboard or Samsung composition can duplicate or drop text. Mitigation: a compositionstart/compositionend guard that defers edits, covered by a QA case.
- **The escape URLs** (x-safari-https on iOS 17+, intent:// on Android) are undocumented and can be blocked by the host app. They are only ever offered on a tap, always next to the manual menu instruction, and nothing depends on them.
- **User-agent sniffing is brittle**, and Custom Tabs look like Chrome. It only changes defaults (link policy, perf auto, contextual hints) and never removes a function. The fixture table makes updates cheap, and ?env= overrides support QA.
- **Cross-workstream conflicts.** Input.svelte, commands.ts, network.ts, qr.ts and History.svelte are hot spots for the autocomplete, shell, network, qr and code-arrangement workstreams. Mitigation: land S1-S3 first (with little command overlap), agree contracts.ts before S4, keep legacyCompletion.ts explicitly interim, and let check-boundaries.sh stop regressions.
- **Directory names** (src/platform, src/terminal, src/render, src/styles) may clash with the code-arrangement workstream's layout. Agree on them before S4; renaming is mechanical.
- **Old engines.** Container queries and cqi (iOS < 16), lh (< 16.4) and color-mix (< 16.2) are missing on older devices. Fallbacks: overflow-x art, stacked layouts, calc line-heights and rgba colours. QA includes one iOS 16 device.
- **The webfont adds about 40 kB**, and a FOUT can briefly misalign the banner. Mitigation: preload, font-display: swap, a ui-monospace fallback, and a CLS budget. Cascadia Code's OFL Reserved Font Name terms must be checked before shipping a renamed subset; fall back to system monospace if needed.
- **Removing the Firebase catch-all rewrite** turns any deep path into a 404. That is acceptable because the app has no routes, and 404.html links home.
- **Session snapshot** size and staleness. It is capped at 50 entries, 1 MB and 30 minutes, restores only on back_forward navigation, is versioned, and is wrapped in SafeStorage.
- **CRT lite by default on phones** reduces the portfolio's signature look on flagship devices. Mitigation: static scanlines and vignette stay; `cathode quality full` and ?fx=full exist; and the tier can be narrowed to in-app and constrained devices if the owner prefers.
- **Self-XSS (F004)** remains in commands this workstream does not own, such as echo and cat. This design builds no deep-link auto-run (`?run=`), only an optional prefill-only `?cmd=` after F004 lands, and all new helpers escape their input.
- **Vertical space.** Roughly 667 px minus a 260 px keyboard, the accessory bar and Instagram's bar leaves about 300 px. Compact mode (one 44 px row) and ⌄ to read output mitigate this.
- **Meta's link-preview cache** can keep showing a missing image after deploy. Re-scrape with the Sharing Debugger.

## Effort

About 12 engineer-days (range 10-14), including test setup and one round of device QA across the four targets:
- S0 harness and QA tools: 0.5 d
- S1 boot safety, head and hosting: 1 d
- S2 zoom, input and font: 1 d
- S3 shell, viewport, focus and scroll: 1.5 d
- S4 controller extraction: 1.5-2 d
- S5 dock and chips: 2 d
- S6 links, in-app, poweroff and session: 1 d
- S7 output reflow: 1 d
- S8 CRT tiers, bell and data-cost prompts: 0.75 d
- S9 e2e and device QA: 1.5 d

S1-S3 alone take about 3.5 days. They remove the blank-page risk, unlock zoom without focus zoom, keep the prompt above the keyboard, remove the 320 px overflow and give proper link previews and icons. That fixes most of the Instagram first impression before any controller work.

## Trade-offs

- **Controller extraction instead of synthetic KeyboardEvents** into the existing ladder (design 1). It costs about 1.5 days more, but gives keyboard, dock, chips and links a single tested path, and gives the autocomplete workstream a clean seam (goals 3 and 5).
- **HTML-string outputs with escaping helpers** instead of design 2's typed OutputBlock union. This is lower risk and compatible with every other workstream today; a structured model can come later without changing the phone UX.
- **Contextual in-app hints** instead of an up-front 'open in Safari' banner. The first impression is the terminal, not an apology. The cost is that some visitors only learn about the limits when they hit one.
- **Links open in the same view (_self) inside in-app browsers**, with a Back-restore snapshot, instead of new windows. This is reliable in WKWebView hosts and needs one extra tap compared with today's auto-open. Desktop keeps auto-open.
- **Inner scroller plus a fixed shell** instead of document scrolling. Keyboard handling is deterministic and the dock never moves, but iOS Safari's toolbars never collapse.
- **A 16px input visually scaled down**, instead of maximum-scale=1 or 16px text everywhere. Pinch-zoom (WCAG 1.4.4) is kept and phone output stays at 13px so the banner and columns fit, at the cost of a small CSS trick with a kill switch.
- **No swipe gestures for history.** Swipes conflict with Instagram's edge-swipe back and close, Android gesture navigation, chip scrolling and text selection. History is available through ↑/↓, long-press ↑ (sheet), tapping past commands and the recents chips.
- **Esc lives on the symbols page, not the main bar.** Phone visitors rarely need it, and ⌄ (hide keyboard) is more useful in that slot.
- **CRT lite by default on phones and in-app browsers.** Smoother scrolling and lower memory use inside Instagram, at the cost of some spectacle on flagships; the setting is a persisted override.
- **Visual bell by default on touch.** No beeps in public, though this departs from the owner's audible beep, which is kept on desktop.
- **A self-hosted subset font (about 40 kB)**, for box-drawing that looks the same on every platform.
- **Manifest without a service worker.** Avoids stale-bundle bugs on a site that redeploys on every merge to main; no offline mode.
- **Session restore only on back_forward**, which keeps the owner's 'fresh on reload' intent (history.ts:5-7).

## Open questions raised by this design

- Prompt hostname: on phones, should the prompt read `guest@vesen:~$` or keep `guest@www.vesen.app:~$`? And on desktop?
- CRT on phones: inside Instagram and on phones generally, should the default be lite (static scanlines and vignette), off, or the full animated tube? Should flagship phones in Safari or Chrome get full automatically?
- In-app notice: is it fine to explain Instagram's limits only when an action needs them (email, downloads, poweroff), or do you want a one-line notice under the banner on first load?
- Links inside Instagram: open in the same view, with the terminal restored when the visitor presses Back, or try to open a new window (which some in-app browsers silently ignore)?
- Desktop auto-open: should `whoami` keep auto-opening LinkedIn, and `sudo` keep auto-opening the rickroll? On phones both would only print a tappable link.
- Starter chips: which commands, in what order? Is `weather Gadigal` right as a starter, given it needs the weather workstream's alias table once wttr.in is replaced?
- Phone text size: 13px (fits the 44-column banner and more columns) or 14px (easier to read, fewer columns)?
- Bell: visual on phones and audible on desktop, or keep the audible beep everywhere?
- Font: is a self-hosted Cascadia Code subset (about 40 kB, renamed 'Vesen Mono' if the licence requires it) acceptable, so the banner's box-drawing looks the same on iPhone?
- Hosting: are you happy to remove the Firebase catch-all rewrite (so unknown paths get a terminal-styled 404) and to set up the apex vesen.app to www redirect in the Firebase console?
- Testing devices and accounts: which iPhone and Android models can you test on? Can you open preview URLs in Instagram, from a DM to yourself or a second account, on both platforms?
- Speedtest on phones: is a 'downloads about 40 MB, continue? [y/N]' confirmation on mobile data and Save-Data acceptable?
- Copy and branding: confirm the OG title ('Vesen — a terminal in your browser'), the description, the manifest name ('Vesen Terminal' or 'Vesen'), and whether the version line under the banner should read 'v1.2.0 · a terminal by Has Salvesen'.
- Deep links: do you want an optional `?cmd=<text>` that pre-fills the prompt without running it, for example for Instagram story links? It would ship only after the echo/cat escaping fix (F004).
