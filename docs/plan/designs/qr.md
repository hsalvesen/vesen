# In-house QR: reference design

> **How to read this file.** This is the full design that a three-way design panel produced and a judge synthesised for this workstream. It is the detailed reference: interfaces, file plan, steps and tests. Where it conflicts with the shared decisions in [../02-architecture-and-contracts.md](../02-architecture-and-contracts.md) or with the sequencing in [../06-qr.md](../06-qr.md), **those documents win**. Line numbers refer to `main` at commit 23758b9 (5 October 2026).

**Chosen approach:** Scan-first in-house QR: ISO 18004 core with optimal segmentation, themed pixel-snapped SVG card above the CRT, accessible full-screen Present mode, shipped in 5 small PRs

## How it was chosen

- **Drop-in swap: bit-identical in-house encoder, then a high-contrast SVG <img> renderer and flags, shipped as 4 small PRs** scored 8.2. Feasibility/correctness 9.5. I re-ran the prototype: `node --test` passes 6/6, and my own random cross-check matched qrcode@1.5.4 bit for bit in 2398/2398 cases. It is the fastest encoder (v40 6.6 ms, v3 0.17 ms). Its citations check out (commands.ts:319/321, Input.svelte:352-356 and 645-651, app.css:37-43/67-69).

Two departures from the brief:
- It ships qrcode's non-ISO mask penalty, though the brief asks for 'standard penalty scoring'.
- Single-mode encoding costs a version on digit-heavy payloads. In my realistic corpus that was 4/15: tel:+61412345678 goes v2 instead of v1, an orders URL v4 instead of v3, a news URL v5 instead of v4, a vCard v5 instead of v4.

UX 7. It fixes polarity, quiet zone, wrapping, escaping and the keyboard. But the phone visitor only gets 'long-press the image', and the image is an SVG, which may not save to Photos on iOS. There is no full-screen view for showing a friend, no share or copy, no theming, and no accessibility work beyond alt text.

Maintainability 7.5. Small, clean modules, but node:test forces `.ts` import specifiers and Node 22.18 or later.

Effort 9 (3 days). Risk 8.5: minimal hunks, incremental PRs.

- **Layered in-house QR stack: pure ISO core, spec-driven feature module, typed RichBlock output with Svelte QrFigure/QrScanView** scored 7.2. Feasibility/correctness 8. The core prototype (docs/plan/prototypes/qr) is solid. I checked its DP segmenter: it produced the same version as qrcode on every digit-heavy payload where single-mode loses one. Its penalty is the Nayuki-style ISO reading, identical to Design 3's.

The weakness is the plumbing around the core:
- It widens Command.outputs to a RichBlock union and changes History.svelte and commands.ts.
- It adds a specCommands bypass of processCommand's -h interception.
- It builds its own tokenizer and CommandSpec.

All of these overlap with the shell, autocomplete and code-arrangement workstreams, so merge conflicts and duplicate parsers are likely.

UX 8.5: themed SVG that re-themes live, a scan view, export, --explain and dense-code notes.

Maintainability 8 in the long run (strict lib tsconfig, clean layers), with duplication risk in the short run.

Effort 4 (9.5 days). Risk 5: it touches the shared output contract. Its best parts (segmenter, strict lib config, independent oracles, the vintage handling, the div-based text art) are grafted.

- **Scan-first QR: in-house ISO encoder, paper card above the CRT, full-screen Present mode for phones** scored 8.4. Feasibility/correctness 9. I re-ran its cross-check and the claims hold:
- 1280/1280 forced-mask byte matrices and 56/56 numeric/alphanumeric cases identical.
- The test-only compat penalty gives 2000/2000 identical auto-mask matrices.
- The ISO penalty agrees with qrcode on 1304/2000 masks.
- v35-L encodes in 14.3 ms.

Two line citations are off: it says commands.ts:313/316, but the split and help check are at 319/321.

UX 9.5, the highest of the three. It is the only design built around the two real jobs (a laptop visitor scans the screen; an Instagram visitor shows the code to a friend or saves it):
- Present mode with a long-pressable PNG, wake lock and back-to-close.
- Share and copy, with buttons hidden where unsupported.
- The card lifted above the CRT overlay (measured 6/6 decodes vs 4/6 underneath).
- A themed palette with a contrast guard. I confirmed it gives 12.05-20.18:1 across all 10 themes, against today's colours, which are inverted in 9/10 themes and 2.46:1 in cockatoo.
- Payload fixes (email, README.md, javascript:), analytics redaction, and text-art fallback.

Maintainability 7.5: delegated data-* actions fit the current {@html} pipeline, but there are several moving parts.

Effort 6.5 (6 days). Risk 6.5:
- Edge cases in Present mode.
- The pushState('#qr') hash.
- A global `:has()` filter override in vintage mode.
- Behaviour inside Instagram is unverified.

With UX and feasibility weighted highest, it wins narrowly over Design 0.


Ideas grafted from the other candidates:

- From Design 0 (drop-in):
- Delivery as small deployable PRs, with an engine-only swap (PR2) before any UI change, so encoder risk and UI risk ship separately.
- The stroke-path SVG renderer: one stroked `<path>` with relative `m dx dy h len` runs, 2.7-3.3x smaller than filled runs.
- Module size snapped to whole device pixels: floor(px*dpr)/dpr.
- `actions/setup-node@v4` (Node 22) plus an `npm test` gate in both Firebase workflows.
- A minimal Input.svelte Tab hunk that imports the shared example list instead of deleting the qr branch at 561-588, so qr completion keeps working until the autocomplete workstream lands.
- A try/catch around the localStorage writes in history.ts:22-28.
- Full hex matrices for 8 small symbols in the golden fixture, so failures are readable.
- GNU `--name=value` and `--` handling; the error copy ending "Try 'qr --help'".
- The pre-existing `qrcode` call kept as a temporary production-parity check.
- From Design 1 (layered):
- The modular core layout (tables, gf256, bits, segments, segmenter, matrix, mask, encode), seeded from docs/plan/prototypes/qr.
- Optimal DP mixed-mode segmentation. Verified: it removes the extra version single-mode costs on digit-heavy payloads.
- `tsconfig.lib.json` with strict:true for src/lib.
- Independent oracles: GF(256) axioms, zero RS syndromes, brute-force data-module counts, an exhaustive segmenter check, and an SVG-path-to-matrix round trip.
- Golden regeneration after removal via `npm exec --package=qrcode@1.5.4`.
- qrencode naming: -v/--symversion and -8/--8bit.
- Exports always in pure #000/#fff.
- Vintage mode handled by the out-of-`main` full-screen view, not by a global filter override.
- Text art as a `div.qr-text` (avoids the !important `pre` rules), with line-height 1.2 for square half-block modules.
- A pure view-model object (`QrView`), so a future RichBlock/Svelte renderer can replace the HTML string without touching the encoder or the parser.
- Judge refinements to the winner:
- history.pushState({qrPresent:1}, '') with no '#qr' URL change.
- Swipe-down close dropped from the core scope.
- `[data-no-refocus]` also on the Present root, so taps inside it do not pop the keyboard.
- Module sizing uses min(main content width, getAvailableWidth()), because the mobile wrapper caps width at textWrap.ts:29-37.
- Penalty injected through an EncodeOptions test seam, so the compat port never ships.
- qr.ts becomes qr/index.ts, so commands.ts:7 needs no edit.
- Accessibility for every QR surface, resolving the QR and ASCII-art part of F094.

## Summary

Replace qrcode@1.5.4 (src/utils/commands/qr.ts:4,44) with an in-house, framework-free encoder in src/lib/qr. It covers:
- versions 1-40 and EC levels L/M/Q/H
- numeric, alphanumeric and UTF-8 byte segments, with optimal DP mixed-mode segmentation
- Reed-Solomon over GF(256)/0x11D, with block split and interleave
- the 8 masks with ISO 7.8.3 (Nayuki-style) penalty scoring
- BCH format and version information
- free EC boost when -e is not given

Pure renderers produce:
- a themed SVG with one stroked path
- half-block or ASCII text art
- a 1-bit PNG with no canvas involved
- an RGBA raster for tests

The qr command becomes a small module directory, src/utils/commands/qr/ (args, payload, spec, card, actions, index). It outputs a single-line, fully escaped HTML card that fits the current {@html} history pipeline. The card is:
- dark ink on light paper in every theme (≥12:1, verified)
- surrounded by a 4-module quiet zone
- sized in whole device pixels to the real terminal width
- lifted above the CRT overlay
- a button that opens an accessible full-screen Present mode (QrPresenter.svelte), where a long-pressable PNG, Save/Share/Copy and a wake lock serve the Instagram visitor who cannot scan their own screen

Phone fixes:
- The keyboard is dismissed after qr.
- Tapping a card no longer refocuses the input.
- qr payloads are redacted from analytics.
- Flags are qrencode-flavoured: -e/--ec (alias -l/--level), -s/--size, -m/--margin, -t/--type svg|utf8|utf8i|ascii, -v/--symversion, --mask, -8, -f/--fullscreen, --text, --url, --.

Testing:
- Vitest plus jsQR.
- Independent ISO vectors and properties.
- A live cross-check against qrcode while it is installed, then a frozen golden fixture.
- Decoder round-trips, PNG structural checks.
- A device QA matrix that includes Instagram's in-app browsers.

Effort is about 6.5 engineer-days.

## Architecture

LAYERS (dependencies point downward only)

L1 src/lib/qr: pure TS, no DOM, no Svelte or stores. Type-checked with strict:true via tsconfig.lib.json. Its only platform API is TextEncoder.
- tables.ts
  - EC_CODEWORDS_PER_BLOCK and NUM_BLOCKS [ec][version] (ISO Table 9).
  - rawDataModules(v) in closed form; dataCodewords(v, ec).
  - alignmentPositions(v) by formula.
  - Char-count bit widths per band (1-9, 10-26, 27-40).
  - EC format bits L=1, M=0, Q=3, H=2.
- gf256.ts: EXP/LOG tables (0x11D, α=2), gfMul, cached rsGenerator(degree), rsRemainder(data, degree) by LFSR division.
- bits.ts: BitBuffer with push(value, len) and toBytes().
- segments.ts
  - Mode predicates.
  - makeSegment: numeric 10/7/4-bit groups; alphanumeric 11/6-bit pairs over the 45-char set; byte = TextEncoder UTF-8, no ECI.
  - segmentBits(segs, v), which returns Infinity on count overflow.
- segmenter.ts: segmentOptimally(text, v), a DP over {numeric, alnum, byte} in sixths of a bit, per version band, iterating by code point. Seeded from docs/plan/prototypes/qr/segmenter.ts.
- matrix.ts: Grid (modules + function mask as Uint8Array):
  - finders and separators, timing, alignment
  - reserved format area and the dark module at (8, size-8)
  - drawFormat (BCH(15,5) gen 0x537 XOR 0x5412) and drawVersion for v≥7 (BCH(18,6) gen 0x1F25)
  - zig-zag placeCodewords skipping column 6
- mask.ts: the 8 predicates (x = column, y = row); applyMask; penaltyIso (N1 runs ≥5 → 3+(n-5); N2 3 per 2×2; N3 40 per 1:1:3:1:1 with a 4-module light side, the outside counted as light; N4 10 per 5% band from 50%).
- encode.ts: encodeQr(text, opts) and encodeQrSegments(segs, opts):
  1. Smallest version in [min, max] that fits.
  2. Optional EC boost within that version.
  3. Terminator (up to 4 bits), byte align, 0xEC/0x11 padding.
  4. Block split (short blocks first), RS per block, interleave skipping the short-block slot.
  5. Place codewords.
  6. Auto mask = argmin penalty with real format bits drawn; ties → lowest id.
  7. Return a frozen QrCode.
  - The penalty function is an optional EncodeOptions seam, so tests can inject the qrcode-compat port without shipping it.
- render/svg.ts: toSvg(qr, {margin, palette | 'css-vars', title}).
  - A full-size paper `<rect>` plus one stroked `<path>` (first run `M x y+.5`, then relative `m dx dy h len`).
  - viewBox in module units including the quiet zone; shape-rendering=crispEdges.
  - In 'css-vars' mode it uses `style="fill:var(--qr-paper,#fff)"` and `stroke:var(--qr-ink,#000)`; exports use literal hex.
- render/text.ts: toText(qr, {style, margin}).
  - 'utf8': light modules drawn as U+2580/2584/2588 glyphs, so polarity is correct on an ink background.
  - 'utf8i': today's inverted look.
  - 'ascii': '##' per module.
  - textColumns() helper.
- render/png.ts: toPng(qr, {scale, margin}) → 1-bit greyscale PNG. Stored-deflate zlib with Adler-32 and per-chunk CRC-32. Deterministic and canvas-free, so it is immune to Firefox resistFingerprinting and Safari canvas noise. Plus pngDataUrl().
- render/raster.ts: toRgba() for jsQR tests.
- render/layout.ts: moduleSize(totalModules, maxCssPx, dpr, {requested?, cap}) → {px, clamped, dense}, where px = floor(min(cap, requested ?? cap, maxCssPx/total) * dpr) / dpr, and dense = px < 3.
- index.ts: the barrel, and the only import surface.

L1b src/lib/colour.ts
- relativeLuminance and contrastRatio (WCAG).
- qrPalette(theme): ink = darkest of {background, black, foreground}; paper = lightest of {brightWhite, white, foreground, background}; falls back to #000/#fff below 7:1.
- Verified for themes.json: minimum 12.05:1 (kookaburra); cockatoo goes from 2.46:1 to 13.55:1.

L2 src/utils (shared helpers)
- html.ts: escapeHtml and escapeAttr (pure string; also escapes quotes, unlike the DOM copies at network.ts:127,454 which do not).
- mobile.ts gains:
  - isCoarsePointer()
  - isInAppBrowser() (UA /Instagram|FBAN|FBAV|Line\/|TikTok/)
  - canShareFiles() (navigator.canShare with a 1-byte PNG File)
  - terminalContentWidth() = min(main.clientWidth - padding, getAvailableWidth())
  - getAvailableWidth matters because the mobile wrapper caps width at textWrap.ts:29-37.

L3 src/utils/commands/qr/ (replaces qr.ts; commands.ts:7 `./commands/qr` resolves to qr/index.ts unchanged)
- spec.ts: QR_FLAGS (the flag table), QR_EXAMPLES (the single list; the copies at commandSuggestions.ts:14-20 and Input.svelte:563-569 currently disagree), qrCompletion, and qrHelpText() in the Usage:/Examples:/Tip: format that getCommandHelp parses (commands.ts:367-400).
- args.ts: parseQrArgs(argv). Accepts -eH, -e H, --ec=H, --ec H, flags before or after operands, and `--`. Range checks; unknown flags suggested by edit distance.
- payload.ts: classifyPayload(raw, {force, fileExists}).
- card.ts: pure renderCardHtml(view) and renderTextArtHtml(view). Every user string goes through escapeHtml/escapeAttr. Output is a single line, so the whitespace-pre containers (History.svelte:19, textWrap.ts:34) add no stray breaks.
- index.ts: qrCommands.qr(argv): string. Steps: parse → classify → encode → layout (screen facts from mobile.ts) → card or text-art HTML. On a coarse pointer it sets keepKeyboardClosed; with -f it sets qrPresentation. It stays synchronous, so the abort lists (commands.ts:343, Input.svelte:294-301) are untouched. It also exports qrToText(argv) for future pipes and redirects.
- actions.ts (DOM): installQrActions().
  - One delegated document click listener for [data-qr-action] = present | save-png | save-svg | share | copy.
  - It re-encodes deterministically from the card's data-* attributes (payload, ec used, version, mask), so it needs no registry and survives `clear` and history re-renders.
  - A MutationObserver on `main` scrolls the newest [data-qr-card] fully into view.
  - Downloads use a Blob built at click time; no data URLs are stored in history.
  - Status goes to the card's aria-live region.

L4 UI
- src/stores/ui.ts: qrPresentation (writable QrPresentation | null), overlayOpen (derived), keepKeyboardClosed (writable boolean).
- src/components/QrPresenter.svelte, mounted once in App.svelte after <Cathode/> (App.svelte:95):
  - Outside `main`, at position:fixed; inset:0; z-index:10001. That puts it above the overlay (app.css:136-143, z 9999) and the vintage filter (app.css:130-132).
  - role=dialog, aria-modal and aria-labelledby; data-no-refocus.
  - Contents: a white sheet; the PNG <img> (pngDataUrl, scale clamp(ceil(512/total), 4, 24), image-rendering:pixelated) sized min(100vw - 32px, 100dvh - 220px) with a 100vh fallback and safe-area padding; the escaped payload; the meta line; and Save, Share and Copy buttons that are feature-detected and hidden for downloads in in-app browsers; ✕ Close.
  - Optional Screen Wake Lock.
  - history.pushState({qrPresent:1}, '') with no URL change, and popstate closes it.
  - Esc, q, Enter or the close button closes it. Keys s and c save and copy.
  - Focus trap; focus returns to the input on fine pointers only.
  - Honours prefers-reduced-motion.
- Input.svelte:
  - handleKeyDown returns early while overlayOpen.
  - The window onclick handler (645-651) skips refocus when event.target.closest('[data-no-refocus]').
  - The finally block (352-356) calls input.blur() and resets the flag when keepKeyboardClosed is set; otherwise focus() as today.
  - The qr Tab branch (561-588) uses QR_EXAMPLES.
  - track() (264-266) is passed through the tracking.ts redactor.
- theme.ts updateCSSVariables (8-29) also sets --qr-ink and --qr-paper from qrPalette, so earlier cards re-theme live.
- app.css:
  - .qr-card { position:relative; z-index:10000; white-space:normal; line-height:normal }. This lifts the card above the overlay; it works because main and #app create no stacking context except in vintage mode.
  - .qr-figure { text-shadow:none; min-height:44px }
  - .qr-actions button { min-height:44px } on (pointer:coarse)
  - .qr-text { white-space:pre; line-height:1.2; overflow:hidden; font-family: ui-monospace, Menlo, 'SF Mono', 'DejaVu Sans Mono', monospace }
  - Reduced-motion rules.
- In vintage mode the inline card stays under the filter and overlay, and Present mode is the clean scan path (no global :has() override).

DATA FLOW
argv → parseQrArgs → classifyPayload → encodeQr (boostEc unless -e) → moduleSize(terminalContentWidth, dpr) → renderCardHtml (string, single line) → history store → History {@html}. Taps on the card go to the delegated action, which re-encodes from data-* and then opens QrPresenter (PNG), downloads (Blob), shares (File) or copies.

## Key interfaces

```ts
// ===== src/lib/qr/types.ts =====
export type EcLevel = 'L' | 'M' | 'Q' | 'H';
export type QrMode = 'numeric' | 'alphanumeric' | 'byte';
export type MaskId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type PenaltyFn = (modules: Uint8Array, size: number) => number;
export interface Segment { readonly mode: QrMode; readonly text: string; readonly charCount: number; readonly bits: readonly number[] }
export interface EncodeOptions {
  ec?: EcLevel;                       // default 'M'
  boostEc?: boolean;                  // default false in core; the command passes true when -e is absent
  minVersion?: number;                // 1..40, default 1 (qrencode -v semantics)
  maxVersion?: number;                // default 40
  mask?: MaskId | 'auto';             // default 'auto' = argmin penaltyIso, ties -> lowest id
  segments?: 'optimal' | QrMode;      // default 'optimal' (DP); 'byte' == -8
  penalty?: PenaltyFn;                // TEST SEAM ONLY (qrcode-compat port lives in tests/helpers)
}
export interface QrCode {
  readonly version: number;           // 1..40
  readonly size: number;              // 17 + 4*version
  readonly ec: EcLevel;               // after boost
  readonly requestedEc: EcLevel;
  readonly mask: MaskId;
  readonly segments: readonly { mode: QrMode; charCount: number }[];
  readonly dataBits: number;          // headers + payload
  readonly capacityBits: number;      // dataCodewords(version, ec) * 8
  readonly modules: Uint8Array;       // row-major size*size, 1 = dark, no quiet zone
}
export class QrCapacityError extends Error {
  readonly bytes: number; readonly ec: EcLevel; readonly maxBytes: Readonly<Record<EcLevel, number>>; // v40 byte: L 2953, M 2331, Q 1663, H 1273
}

// ===== src/lib/qr/index.ts =====
export function encodeQr(text: string, o?: EncodeOptions): QrCode;
export function encodeQrSegments(segs: readonly Segment[], o?: EncodeOptions): QrCode;
export function maxPayloadBytes(ec: EcLevel, mode?: QrMode, version?: number): number;
export interface Palette { ink: string; paper: string }
export function toSvg(qr: QrCode, o?: { margin?: number /*4*/; palette?: Palette | 'css-vars'; title?: string }): string;
export type TextStyle = 'utf8' | 'utf8i' | 'ascii';
export function toText(qr: QrCode, o: { style: TextStyle; margin?: number /*2*/ }): string[];
export function textColumns(qr: QrCode, o: { style: TextStyle; margin?: number }): number;
export function toPng(qr: QrCode, o: { scale: number; margin?: number /*4*/ }): Uint8Array; // 1-bit greyscale, #000 on #fff
export function pngDataUrl(png: Uint8Array): string;
export function toRgba(qr: QrCode, o: { scale: number; margin?: number }): { width: number; height: number; data: Uint8ClampedArray };
export function moduleSize(totalModules: number, maxCssPx: number, dpr: number,
  o?: { requested?: number; cap?: number /* 8 fine, 10 coarse */ }): { px: number; clamped: boolean; dense: boolean };

// ===== src/lib/colour.ts =====
export function contrastRatio(a: string, b: string): number;
export function qrPalette(theme: Theme, minContrast?: number /*7*/): Palette & { contrast: number; source: 'theme' | 'fallback' };

// ===== src/utils/html.ts =====
export function escapeHtml(s: string): string;   // & < > " '
export function escapeAttr(s: string): string;   // escapeHtml + newline/tab as entities

// ===== src/utils/mobile.ts (additions) =====
export function isCoarsePointer(): boolean;
export function isInAppBrowser(ua?: string): boolean;
export function canShareFiles(): boolean;
export function terminalContentWidth(): number;   // min(main content box, getAvailableWidth())

// ===== src/utils/commands/qr/args.ts =====
export type QrType = 'svg' | TextStyle;
export interface QrArgs {
  payload: string;                 // operands joined by ' ' (processCommand already split on /\s+/, commands.ts:319)
  ec?: EcLevel;                    // -e/--ec, -l/--level: l|m|q|h|low|medium|quartile|high
  size: number | 'fit';            // -s/--size 1..32 CSS px per module, default 'fit'
  margin?: number;                 // -m/--margin 0..10; default 4 (svg/png) / 2 (text)
  type: QrType;                    // -t/--type, default 'svg'
  minVersion?: number;             // -v/--symversion 1..40
  mask?: MaskId;                   // --mask 0..7
  eightBit: boolean;               // -8/--8bit
  fullscreen: boolean;             // -f/--fullscreen
  force?: 'text' | 'url';          // --text | --url
}
export type ParseResult = { args: QrArgs } | { error: string; hint?: string };
export function parseQrArgs(argv: readonly string[]): ParseResult;

// ===== src/utils/commands/qr/payload.ts =====
export type PayloadKind = 'url' | 'uri' | 'email' | 'phone' | 'text';
export type PayloadNote = 'https-added' | 'is-a-file' | 'email-tip' | 'phone-tip';
export interface ClassifiedPayload { kind: PayloadKind; value: string; note?: PayloadNote }
export function classifyPayload(raw: string, o?: { force?: 'text' | 'url'; fileExists?: (p: string) => boolean }): ClassifiedPayload | { error: string };

// ===== src/utils/commands/qr/spec.ts =====
export interface FlagSpec { short?: string; long: string; aliases?: string[]; arg?: string; values?: readonly string[]; describe: string }
export const QR_FLAGS: readonly FlagSpec[];
export const QR_EXAMPLES: readonly string[];   // ['qr vesen.app', 'qr https://tldr.sh', 'qr explainshell.com', 'qr www.wikipedia.org/wiki/Computer_terminal', 'qr shellcheck.net', 'qr commandlinefu.com']
export const qrCompletion: { flags: readonly FlagSpec[]; examples: readonly string[] };
export function qrHelpText(): string;           // Usage:/Examples:/Tip: blocks for getCommandHelp

// ===== src/utils/commands/qr/card.ts =====
export interface QrView {
  payload: ClassifiedPayload; qr: QrCode; args: QrArgs;
  layout: { modulePx: number; clamped: boolean; dense: boolean; widthPx: number };
  env: { coarse: boolean; inApp: boolean; canShareFiles: boolean };
}
export function renderCardHtml(v: QrView): string;        // single line, all user text escaped
export function renderTextArtHtml(v: QrView, fontPx: number): string;

// ===== src/utils/commands/qr/index.ts =====
export const qrCommands: { qr: (argv: string[]) => string };   // unchanged contract (commands.ts:458-465)
export function qrToText(argv: string[]): string;               // for future pipes/redirects

// ===== src/utils/commands/qr/actions.ts =====
export type QrAction = 'present' | 'save-png' | 'save-svg' | 'share' | 'copy';
export function installQrActions(root?: Document): () => void;

// ===== src/stores/ui.ts =====
export interface QrPresentation { qr: QrCode; payload: ClassifiedPayload; returnFocus?: HTMLElement | null }
export const qrPresentation: Writable<QrPresentation | null>;
export const overlayOpen: Readable<boolean>;
export const keepKeyboardClosed: Writable<boolean>;

// ===== Card DOM contract (one line inside the whitespace-pre output div) =====
// <div class="qr-card" data-qr-card data-no-refocus data-qr-payload="{escAttr}" data-qr-kind="url" data-qr-ec="Q" data-qr-version="2" data-qr-mask="3">
//  <div class="qr-head"><span cyan>qr</span> <span green title="{escAttr full}">{esc middle-ellipsis}</span> <span dim>· added https://</span></div>
//  <button type="button" class="qr-figure" data-qr-action="present" style="width:min(100%,{W}px)" aria-label="QR code for {esc}. Show full screen">
//    <svg aria-hidden="true" focusable="false" viewBox="0 0 {n} {n}" shape-rendering="crispEdges">…</svg></button>
//  <div class="qr-meta">v2 · 25×25 · EC Q (boosted from M) · 17/22 B · mask 3</div>
//  <div class="qr-hint">{pointer/kind specific}</div>
//  <div class="qr-actions" role="group" aria-label="QR code actions"><button data-qr-action="present|save-png|save-svg|share|copy">[ … ]</button>…</div>
//  <div class="qr-status" role="status" aria-live="polite"></div></div>
```

## What the visitor sees

COMMAND SURFACE (help, completion and suggestions all come from spec.ts)
Synopsis: qr [OPTION]... [--] TEXT...
- Bare `qr` prints the usage from qrHelpText() without a beep (today it beeps at qr.ts:65). The first example is `qr vesen.app` ("share this terminal").
- `qr --help` / `qr -h` prints the standard three-block help through getCommandHelp. It lists every flag:
  - -e/--ec (alias -l/--level) L|M|Q|H: "damage the code survives: 7/15/25/30%; default M, raised for free when it fits"
  - -s/--size N|fit
  - -m/--margin N
  - -t/--type svg|utf8|utf8i|ascii
  - -v/--symversion N
  - --mask 0-7
  - -8/--8bit
  - -f/--fullscreen
  - --text, --url
  - The tip: "Click or tap a code to show it full screen. Codes are made in your browser and never sent anywhere."
- Tab: `qr <Tab>` still completes from QR_EXAMPLES (Input.svelte:561-588 now imports the shared list). `qrCompletion` exposes flags and values (e -> L M Q H, t -> types) for the autocomplete workstream.

PAYLOAD RULES (the head line always shows exactly what was encoded, HTML-escaped, middle-ellipsised, full value in title)
- A bare host, optionally with port, path or query (`vesen.app`, `localhost:5173/x`), with an alphabetic TLD or localhost, gets https:// added after validation by new URL(). Dim note: "added https:// · --text encodes exactly what you typed".
- Known schemes are kept as typed: http(s), mailto, tel, sms, geo, WIFI:, BEGIN:VCARD, otpauth, and any `scheme://`.
- `javascript:` and `vbscript:` are refused: "qr: won't encode javascript: links".
- An existing VFS file name (`qr README.md`) encodes the name as text, with the tip "README.md is a file here; this code contains the name, not the contents".
- An email address stays text, with the tip "use qr mailto:has@salvesen.app for a tap-to-email code". This fixes today's `https://has@salvesen.app` from qr.ts:79-87.
- A phone-like number stays text, with a tel: tip.
- Anything with whitespace, or like v1.2.0, 3.14 or 'e.g. this', is literal text.
- --text and --url force the choice.

DESKTOP
`qr https://github.com/hsalvesen/vesen` prints:
- the head line
- a crisp card: theme ink on theme paper (swamphen #222235 on #ffffff, 15.6:1), a 4-module quiet zone, 8 CSS px per module snapped to device pixels (296 px for v3), rounded 6 px corners, drawn above the scanlines
- the meta line: `v3 · 29×29 · EC M · 34/42 B · mask 2`
- the hint: "Scan with your phone camera to open the link" ("…to read the text" for text)
- actions: `[ full screen ] [ save png ] [ save svg ] [ copy ]`

Other desktop behaviour:
- `-s 12` is capped to fit, with the dim note "size reduced to 8 px to fit this window".
- `-f`, or clicking the code, opens Present mode. Esc, q or Enter closes it; s saves; c copies. Focus is trapped and returns to the prompt.
- `qr -t utf8 hello` prints a qrencode-style half-block block: light glyphs on an ink field, 2-module quiet zone, line-height 1.2 for square modules, never wrapped, selectable.
- `-t utf8i` gives today's inverted look, with "note: inverted codes don't scan on every phone".
- `-t ascii` draws `##` per module.
- If the art does not fit at a font size of 8 px or more, it says "note: utf8 art needs 37 columns; this screen fits 35. Showing an image instead." and renders the card.

PHONE AND INSTAGRAM IN-APP BROWSER (375 px; no Tab key; keyboard covers the bottom; pinch-zoom disabled by index.html:6)
- After `qr vesen.app`:
  - The input is blurred, so the keyboard closes (keepKeyboardClosed is consumed in Input.svelte's finally at 352-356, so it never flickers open).
  - The newest card is scrolled fully into view.
  - The card measures min(content width, 320 px) with up to 10 px modules (a v2 code is 264 px).
  - The hint reads "Tap the code for full screen, then let a friend scan it."
  - Actions: `[ full screen ] [ share ] [ copy ]`. Share appears only if canShareFiles(). Save is hidden in in-app browsers, where downloads do nothing.
  - All targets are at least 44 px.
  - Tapping the card or its buttons never refocuses the input ([data-no-refocus]). Tapping elsewhere in the terminal brings the keyboard back as today.
- Present mode (tap, or -f):
  - A white full-screen sheet above everything, including the vintage CRT filter. It uses position:fixed with inset:0 and safe-area padding, so it does not depend on 100vh.
  - The code is a PNG <img> as large as fits (min(100vw - 32px, 100dvh - 220px)). Below it: the payload in 16 px monospace (2 lines, middle ellipsis) and the meta line.
  - Buttons: [ Save image ] [ Share ] [ Copy link ] and ✕ Close.
  - In-app browsers show "Press and hold the code to save it, or take a screenshot".
  - It closes with ✕, Android back or the iOS back swipe (popstate on a state-only pushState entry), or a tap outside the code. The URL never changes.
  - The screen stays awake while it is open, where supported. Closing leaves the keyboard down.
- No window.open, mailto or download is required anywhere in the flow.
- Status messages go to the card's or dialog's live region for 4 s:
  - "Copied."
  - "Couldn't copy here. Press and hold the link to copy it."
  - "Saved qr-vesen.app.png"
  - "Saving isn't available in this app. Tap the code, then press and hold to save."
  - A cancelled share shows nothing.

THEMES AND CRT
- Cards re-theme live on `theme set` through --qr-ink/--qr-paper, staying at 7:1 or better (measured 12.05-20.18:1).
- In the scanlines and phosphor modes the card sits above the overlay with no glow on the figure.
- In vintage mode, main's filter (app.css:130-132) keeps the inline card under the overlay. The hint adds "tap for a clean full-screen view".
- Exports (PNG/SVG) are always #000 on #fff.

LOADING
None. Encoding takes under 1 ms for typical links and about 7-15 ms at v40, so output appears with the prompt as today.

ERRORS (beep, red `qr:` line, yellow hint "Try 'qr --help' for usage.", all escaped, no code printed)
- "qr: unknown option '--sz'. Did you mean '--size'?"
- "qr: '-e' needs one of L, M, Q, H (got 'X')"
- "qr: '-s' needs a number from 1 to 32 or 'fit'"
- "qr: '-v' needs a version from 1 to 40"
- "qr: --mask needs a number from 0 to 7"
- "qr: missing text or link. Try: qr vesen.app"
- "qr: to encode text that starts with '-', put -- first: qr -- -5°C"
- "qr: too long for a QR code (3,120 bytes). Level M holds 2,331 bytes, L holds 2,953. Try -e L or a shorter link."

WARNINGS (no beep)
- Modules under 3 px: "note: 2.7 px modules are dense for a phone screen. Tap the code for full screen."
- -m below 4 (SVG) or below 2 (text): "note: quiet zones this small may not scan."

ACCESSIBILITY (QR part of F094)
- The figure button has aria-label "QR code for <payload>. Show full screen", and the SVG is aria-hidden.
- Text art is aria-hidden, with an sr-only "QR code for <payload>".
- Present mode is a labelled modal dialog with a focus trap and focus return.
- Status messages are announced politely.
- Motion respects prefers-reduced-motion.

KNOWN INTERIM LIMITS (owned by the shell workstream)
- Runs of spaces collapse (commands.ts:319).
- `-h` anywhere triggers help (commands.ts:321), so `qr -- -h` cannot be encoded.
- Quotes are passed through literally until the tokenizer lands.

## Files

| Path | Purpose |
|---|---|
| `src/lib/qr/types.ts` | NEW. EcLevel, QrMode, MaskId, Segment, EncodeOptions (incl. test-only penalty seam), QrCode, QrCapacityError(bytes, ec, maxBytes per level). |
| `src/lib/qr/tables.ts` | NEW. ISO Table 9 EC codewords per block and block counts; rawDataModules(v); dataCodewords(v, ec); alignmentPositions(v); char-count bit widths; maxPayloadBytes(ec, mode). |
| `src/lib/qr/gf256.ts` | NEW. GF(2^8) EXP/LOG over 0x11D, gfMul, cached rsGenerator(degree), rsRemainder(data, degree). |
| `src/lib/qr/bits.ts` | NEW. BitBuffer (push with range checks, toBytes). |
| `src/lib/qr/segments.ts` | NEW. Mode predicates, makeSegment (numeric/alphanumeric/UTF-8 byte), segmentBits, writeSegments. |
| `src/lib/qr/segmenter.ts` | NEW. segmentOptimally(text, version): DP mixed-mode segmentation (seed: docs/plan/prototypes/qr/segmenter.ts). |
| `src/lib/qr/matrix.ts` | NEW. Grid with function mask; finder/separator/timing/alignment/dark module; drawFormat; drawVersion; zig-zag placeCodewords. |
| `src/lib/qr/mask.ts` | NEW. 8 mask predicates, applyMask, penaltyIso returning {n1,n2,n3,n4,total} (also used by the optional --explain). |
| `src/lib/qr/encode.ts` | NEW. encodeQr / encodeQrSegments: version search, EC boost, padding, block split + RS + interleave, placement, mask choice, frozen QrCode. |
| `src/lib/qr/index.ts` | NEW. Barrel: encodeQr, encodeQrSegments, maxPayloadBytes, QrCapacityError, renderers, layout, types. |
| `src/lib/qr/render/svg.ts` | NEW. toSvg: paper rect + single stroked run-length path, crispEdges, viewBox incl. quiet zone, 'css-vars' or hex palette, optional <title>. |
| `src/lib/qr/render/text.ts` | NEW. toText(style utf8\|utf8i\|ascii, margin default 2) and textColumns. |
| `src/lib/qr/render/png.ts` | NEW. 1-bit greyscale PNG with stored-deflate zlib, CRC-32, Adler-32; pngDataUrl; pngBlob. |
| `src/lib/qr/render/raster.ts` | NEW. toRgba for jsQR tests. |
| `src/lib/qr/render/layout.ts` | NEW. moduleSize(): fit-to-width, whole-device-pixel snapping, -s clamp, dense flag. |
| `src/lib/colour.ts` | NEW. relativeLuminance, contrastRatio, qrPalette(theme) with 7:1 guard and #000/#fff fallback. |
| `src/utils/html.ts` | NEW. escapeHtml and escapeAttr (pure string). network.ts:127/454 adopt it in the same PR or via the code-arrangement workstream. |
| `src/utils/mobile.ts` | EDIT. Add isCoarsePointer, isInAppBrowser, canShareFiles, terminalContentWidth (no new env.ts, avoiding a second device-detection module). |
| `src/utils/commands/qr.ts` | DELETE (PR3), replaced by the qr/ directory; the qrcode import (line 4), the unused currentTheme (line 62) and the duplicated usage (lines 64-73) go with it. |
| `src/utils/commands/qr/index.ts` | NEW. qrCommands.qr(argv): string (contract unchanged, synchronous); qrToText for future pipes. PR2 interim version: same half-block output, new engine, escaped caption. |
| `src/utils/commands/qr/spec.ts` | NEW. QR_FLAGS, QR_EXAMPLES (first: 'qr vesen.app'), qrCompletion {flags, values, examples} for the autocomplete workstream, qrHelpText(). |
| `src/utils/commands/qr/args.ts` | NEW. parseQrArgs → {args} \| {error, hint}; narrowed with `'error' in r` because the root tsconfig is strict:false (tsconfig.json:15). |
| `src/utils/commands/qr/payload.ts` | NEW. classifyPayload: scheme kept, javascript:/vbscript: refused, VFS file names as text with tip, bare host → https:// validated by new URL(), email/phone as text with a mailto:/tel: tip, whitespace → text, --text/--url override. |
| `src/utils/commands/qr/card.ts` | NEW. Pure QrView → single-line escaped card HTML / text-art HTML; meta line; pointer- and in-app-aware hint and action set; sr-only text alternatives. |
| `src/utils/commands/qr/actions.ts` | NEW. installQrActions(): delegated click handler (present, save-png, save-svg, share, copy), deterministic re-encode from data-*, Blob downloads, Web Share files, clipboard with execCommand fallback, aria-live status, MutationObserver scroll-into-view. |
| `src/stores/ui.ts` | NEW. qrPresentation, overlayOpen, keepKeyboardClosed. |
| `src/components/QrPresenter.svelte` | NEW. Full-screen accessible Present mode (dialog, PNG img, Save/Share/Copy/Close, wake lock, popstate close, focus trap, reduced motion, data-no-refocus). |
| `src/App.svelte` | EDIT. Mount <QrPresenter/> after <Cathode/> (line 95); call installQrActions() in onMount and its uninstall on destroy. |
| `src/components/Input.svelte` | EDIT 5 small hunks: overlayOpen early return in handleKeyDown; [data-no-refocus] exemption at 645-651; blur instead of focus at 352-356 when keepKeyboardClosed; QR_EXAMPLES at 561-588; redacted track() at 264-266. |
| `src/utils/tracking.ts` | EDIT. track(cmd, args) applies a per-command redactor; qr sends only flag names and values, never the payload. |
| `src/stores/theme.ts` | EDIT updateCSSVariables (8-29): set --qr-ink/--qr-paper from qrPalette(theme). |
| `src/stores/history.ts` | EDIT. Wrap both localStorage.setItem calls (22-28) in try/catch (writes are write-only: lines 6-7 clear on load). |
| `src/app.css` | EDIT. Add .qr-card/.qr-head/.qr-figure/.qr-meta/.qr-hint/.qr-actions/.qr-status/.qr-text rules, z-index lift, 44 px coarse-pointer targets, reduced motion. |
| `src/utils/helpTexts.ts` | EDIT 74-79 → qr: qrHelpText(); 109 → 'Make a QR code (offline)'. |
| `src/utils/commandSuggestions.ts` | EDIT 14-20 to import QR_EXAMPLES (used unchanged at 59-61 and 109-118); add flag suggestions after 'qr -'. |
| `tests/qr/gf256.test.ts` | NEW. Field axioms over all pairs; generator polynomials; zero syndromes for random blocks at every EC length in Table 9. |
| `tests/qr/vectors.test.ts` | NEW. ISO Annex I, HELLO WORLD 1-M and 1-Q codewords; 32 format strings + min Hamming distance 7; version info v7..v40; alignment positions; capacities; brute-force data-module counts. |
| `tests/qr/segmenter.test.ts` | NEW. DP equals exhaustive optimum (strings ≤7 chars); never longer than single-mode; astral code points. |
| `tests/qr/penalty.test.ts` | NEW. Hand-built matrices with known N1-N4; auto mask = argmin penaltyIso. |
| `tests/qr/oracle.test.ts` | NEW, temporary (describe.skipIf qrcode missing). Live comparison with qrcode@1.5.4: forced masks across 40 versions × 4 levels × 8 masks × 3 modes, pinned mixed segments, 2000 seeded auto-mask payloads under the compat penalty, plus the exact production call parity report. |
| `tests/qr/golden.test.ts` | NEW. Re-derives payloads and compares SHA-256 of packed matrices with tests/fixtures/qr-golden.json; compares full matrices for 8 small symbols. |
| `tests/qr/roundtrip.test.ts` | NEW. jsQR decode of toRgba for ~200 seeded payloads (v1-40, L/M/Q/H, UTF-8/emoji/macrons, 'Gadigal', 'Aotearoa'), 1.2× vertical stretch, 3×3 blur, 10% patch at Q/H, rasterised text art (both polarities). |
| `tests/qr/render.test.ts` | NEW. SVG path parsed back to the module set; viewBox = size+2m; text art dimensions and inverse; PNG signature/IHDR/CRCs, zlib.inflateSync(IDAT) equals expected rows, Adler-32; moduleSize never exceeds width and is a multiple of 1/dpr. |
| `tests/qr/command.test.ts` | NEW. Table tests for parseQrArgs and classifyPayload (~40 cases); renderCardHtml escapes '<u>x</u>' and quotes in data-qr-payload; capacity/usage/error copy; qrPalette ≥7:1 for every themes.json entry; tracking redactor. |
| `tests/helpers/penaltyQrcodeJs.ts` | NEW. Test-only port of qrcode@1.5.4 scoring (in-bounds 11-bit N3, ceil-based N4), injected through the EncodeOptions penalty seam. |
| `tests/fixtures/qr-golden.json` | NEW. ~300 entries {seed\|text, segments, ec, version, mask, sha256} + 8 full hex matrices, generated from qrcode@1.5.4. |
| `scripts/gen-qr-golden.mjs` | NEW. Fixture generator with seeded PRNG; documented re-run after removal: `npm exec --package=qrcode@1.5.4 -- node scripts/gen-qr-golden.mjs`. |
| `vitest.config.ts` | NEW. environment 'node', include tests/**/*.test.ts. |
| `tsconfig.lib.json` | NEW. extends ./tsconfig.json with strict:true, noImplicitAny:true, include src/lib/**/*.ts. |
| `package.json` | EDIT. Scripts test (vitest run), test:watch, typecheck:lib (tsc -p tsconfig.lib.json); devDependencies vitest ~2.1 (Vite 5 compatible) and jsqr ^1.4.0; PR2 removes qrcode (line 29) and @types/qrcode (line 26). |
| `package-lock.json` | EDIT. Regenerated by npm install / npm uninstall qrcode @types/qrcode (prunes ~30 packages per Design 0's count). |
| `.github/workflows/firebase-hosting-pull-request.yml` | EDIT. Add actions/setup-node@v4 (node-version 22, cache npm) before line 16; run `npm ci && npm test && npm run typecheck:lib && npm run build`. |
| `.github/workflows/firebase-hosting-merge.yml` | EDIT. Same at line 14, so a broken encoder can never deploy to live. |
| `README.md` | EDIT. qr usage and flags, Present mode, privacy (encoded locally), the in-house encoder and how it is verified. |

## External services

- No runtime network APIs: encoding and rendering are offline and deterministic, so CORS, rate limits and Instagram's network quirks do not apply. Nothing the visitor encodes leaves the device (analytics redaction closes the Umami leak at Input.svelte:264-266 / tracking.ts:9-13).
- ISO/IEC 18004:2015 model 2: Table 9 (EC blocks), Table 3 (char-count widths), Annex E (alignment), §7.8.3 (penalty), Annex C/D (format/version BCH), Annex I (worked example).
- TextEncoder (UTF-8 byte mode, no ECI; the same as qrcode@1.5.4, so payload bytes are identical).
- Inline SVG with CSS custom properties (--qr-ink/--qr-paper) and shape-rendering=crispEdges; no CSP is set in firebase.json or httpd.conf, so inline SVG and data:/blob: images are allowed.
- Present mode: data-URL PNG <img> (in-house encoder), Screen Wake Lock (best effort), history.pushState/popstate, matchMedia('(pointer: coarse)') and ('(prefers-reduced-motion: reduce)'), devicePixelRatio.
- Export: Blob + URL.createObjectURL + <a download> (desktop; hidden in in-app browsers), navigator.canShare({files}) / navigator.share (feature-detected, called inside the click handler), navigator.clipboard.writeText with a textarea + execCommand fallback.
- Test-only: vitest ~2.1, jsqr ^1.4.0 (pure-JS decoder), node:zlib and node:crypto; qrcode@1.5.4 as a temporary oracle (QRCode.create([{data, mode}], {errorCorrectionLevel, version, maskPattern})).

## Steps

1. PR1: test harness, core encoder and oracles. No user-visible change; deployable. About 1.75 days.
- Add vitest ~2.1 and jsqr ^1.4.0, vitest.config.ts, tsconfig.lib.json, and the scripts test, test:watch and typecheck:lib.
- Add actions/setup-node@v4 (node 22, cache npm) to both Firebase workflows and run `npm ci && npm test && npm run typecheck:lib && npm run build`. The PR workflow (line 16) also gates preview deploys.
- Write src/lib/qr: types, tables, gf256, bits, segments, segmenter, matrix, mask, encode, index. Seed them from docs/plan/prototypes/qr (already modular, ISO penalty, DP segmenter). Borrow Design 0's typed-array loops ((a design-time prototype, not kept) v40 6.6 ms) where they are faster.
- Write tests/qr/gf256, vectors, segmenter and penalty tests.
- Add tests/helpers/penaltyQrcodeJs.ts and tests/qr/oracle.test.ts: live comparison with qrcode@1.5.4 for forced masks across 40 versions × 4 levels × 8 masks × 3 modes, pinned mixed segments, and 2000 seeded auto-mask payloads through the penalty seam.
- Run scripts/gen-qr-golden.mjs to freeze tests/fixtures/qr-golden.json (about 300 hashed entries plus 8 full matrices), and add golden.test.ts.
- Add roundtrip.test.ts (jsQR) with the raster renderer.
- Acceptance:
  - All green.
  - svelte-check still reports exactly the 2 known theme.ts errors.
  - `npm run build` unchanged.
2. PR2: engine swap, escaping and dependency removal. Visually near-identical; deployable. About 0.5 day.
- Move src/utils/commands/qr.ts to src/utils/commands/qr/index.ts. commands.ts:7 needs no edit.
- Replace buildMatrix (qr.ts:43-58) with encodeQr(input, {ec:'M'}) feeding the existing half-block renderer.
- Add src/utils/html.ts and escape the caption (qr.ts:93-96 currently renders `<u>` tags). Point network.ts:127/454 at it if the code-arrangement workstream agrees.
- Remove the unused currentTheme (qr.ts:62).
- Run `npm uninstall qrcode @types/qrcode`. oracle.test.ts then skips itself, and the golden, vector and round-trip tests must stay green.
- Acceptance:
  - `grep -rn "from 'qrcode'" src` is empty.
  - The JS bundle shrinks (Design 0 measured 142.85 to 128.80 kB, gzip 48.71 to 43.68 kB, for a byte-only encoder; expect slightly less with the segmenter).
  - The 2 known svelte-check errors are unchanged.
3. PR3: renderers, card, flags and phone basics. The visible change; deployable. About 2.5 days.
- Add src/lib/qr/render (svg with stroked paths, text, png, raster, layout) and src/lib/colour.ts.
- Add render.test.ts (PNG structure via zlib.inflateSync, SVG path round trip, text-art inverse, moduleSize snapping).
- Add src/utils/commands/qr/{spec,args,payload,card}.ts and rewrite index.ts. Add command.test.ts.
- theme.ts: set --qr-ink/--qr-paper. app.css: the .qr-* rules and the z-index:10000 lift.
- mobile.ts: isCoarsePointer, isInAppBrowser, canShareFiles, terminalContentWidth.
- Add src/stores/ui.ts.
- Input.svelte hunks:
  - [data-no-refocus] at 645-651
  - blur when keepKeyboardClosed at 352-356
  - QR_EXAMPLES at 561-588
  - redacted track() at 264-266
- tracking.ts gets the redactor. history.ts gets try/catch at 22-28.
- helpTexts.ts 74-79 and 109; commandSuggestions.ts 14-20.
- Resolves the QR and ASCII-art part of F094: an aria-label on the figure button, aria-hidden SVG and text art with sr-only alternatives, and a role=status live region per card.
- Browser check at 375×812, DPR 3, and at 1280 px:
  - The card is 264-296 px; documentElement.scrollWidth equals the viewport.
  - document.activeElement is BODY after qr on a coarse pointer.
  - `qr <u>x</u>` yields 0 <u> elements.
  - Screenshots decode with OpenCV and jsQR, with scanlines on, in cockatoo, swamphen and treefrog.
4. PR4: Present mode and actions. Deployable. About 1 day.
- Add src/utils/commands/qr/actions.ts: delegated present, save-png, save-svg, share and copy, re-encoding from data-*; Blob downloads revoked after 30 s; Web Share files; clipboard with execCommand fallback; the MutationObserver scroll-into-view.
- Add src/components/QrPresenter.svelte, mounted after <Cathode/> in App.svelte (line 95). installQrActions() runs in onMount.
- Input.svelte: handleKeyDown returns early while overlayOpen.
- The -f flag sets qrPresentation.
- Completes the dialog part of F094: role=dialog, aria-modal, aria-labelledby, focus trap and return, Esc and q close, reduced motion.
- Test detectors and the redactor with stubbed UA and navigator (Instagram iOS and Android, Safari, Chrome Android, desktop).
5. Device QA on the Firebase preview channel the PR workflow already deploys. About 0.75 day.
- Platforms: iPhone Safari, iPhone Instagram in-app browser (opened from the profile link), Android Chrome, Android Instagram in-app browser, and desktop Chrome, Safari and Firefox.
- Variations: themes cockatoo, swamphen and treefrog plus a spot-check of all 10; cathode off, scanlines, phosphor and vintage; widths 320, 375 and 414 portrait plus landscape; payloads at v2, v8 and v20.
- Scanners: iOS Camera and Google Lens at 20-30 cm, from a laptop screen and from a phone in Present mode.
- Check:
  - long-press save in both in-app browsers
  - the share sheet and copy fallbacks
  - the keyboard stays down after qr and after closing Present
  - back closes Present without leaving the site
  - no horizontal scroll on rotation
  - utf8 art scans in Safari (Menlo-first stack)
- Record the in-app findings in the PR and README, and fix anything found.
6. PR5: docs and optional extras. About 0.25 day, plus optional work.
- README section: usage, flags, Present mode, privacy, the in-house encoder and its verification.
- Optional, each independent:
  - `qr --explain` (segments, capacity, block structure, per-mask N1-N4 with the chosen mask starred, format and version bits), about 0.5 day.
  - `-o FILE.svg|.txt` and stdin once the shell, pipe and VFS-write workstream lands, about 0.5 day.
  - A `qrencode` alias.
  - A subset of public/fonts/CascadiaCode.ts as the glyph font for text art, coordinated with the typography work.

## Testing

PRINCIPLE: every layer has an oracle independent of qrcode, and qrcode is used only to prove table, placement and ordering parity before it is removed.

1. INDEPENDENT VECTORS AND PROPERTIES (vitest, node env)
- ISO Annex I "01234567" 1-M: EC = A5 24 D4 C1 ED 36 C7 87 2C 55.
- "HELLO WORLD" 1-M:
  - data = 32 91 11 120 209 114 220 77 67 64 236 17 236 17 236 17
  - EC = 196 35 39 119 235 215 231 226 93 23
- "HELLO WORLD" 1-Q: EC = A8 48 16 52 D9 36 9C 00 2E 0F B4 7A 10.
- All 32 format strings (e.g. M/mask 0 = 101010000010010), with minimum pairwise Hamming distance 7. Version info for v7-v40 (v7 = 0x07C94, v40 = 0x28C69).
- Alignment positions: v2 [6,18], v7 [6,22,38], v32 [6,34,60,86,112,138], v40 [6,30,58,86,114,142,170].
- rawDataModules(v) equals a brute-force count of non-function modules for all 40 versions.
- Capacities:
  - byte at v40: L/M/Q/H = 2953/2331/1663/1273
  - numeric L v40 = 7089; alphanumeric L v40 = 4296
  - version boundaries: 14 bytes fit v1-M, 15 bytes go to v2
- QrCapacityError carries maxBytes.
- GF(256): field axioms over all 65,536 pairs; zero RS syndromes at α^0..α^(n-1) for random blocks at every EC length used.
- DP segmenter equals the exhaustive optimum for strings of 7 characters or fewer over a mixed alphabet, is never longer than single-mode, and handles astral code points.
- Penalty: hand-built matrices with known N1-N4; the auto mask equals the argmin.
- EC boost: a short numeric payload upgrades to H. An explicit ec disables the boost.

2. ORACLE CROSS-CHECK (PR1, describe.skipIf qrcode is missing)
The library is called as QRCode.create([{data, mode}], {errorCorrectionLevel, version, maskPattern}).
- Forced masks for every version, level, mask and mode. The prototypes already show 1280/1280, 56/56, Design 0's 6,068/6,068, and my rerun of 2398/2398.
- Mixed segments pinned to the same segment list.
- 2000 seeded auto-mask payloads with the compat penalty injected through EncodeOptions.penalty, expecting 2000/2000 identical.
- A report-only parity check against today's exact production call, QRCode.create(text, {errorCorrectionLevel:'M'}). It asserts the in-house version is ≤ the library's, which the DP segmenter guarantees.

3. GOLDEN FIXTURE (survives removal)
- tests/fixtures/qr-golden.json, generated by scripts/gen-qr-golden.mjs: about 300 entries {seed|text, segments, ec, version, mask, sha256(packed modules)}, plus 8 full hex matrices.
- Coverage: v1-v40, L/M/Q/H, the three modes and mixed, UTF-8 and emoji, exact-capacity and +1-byte edges, plus compat-penalty auto entries.
- A second assertion checks that the shipped ISO mask choice has the minimum ISO score of all 8.
- Regenerate with `npm exec --package=qrcode@1.5.4 -- node scripts/gen-qr-golden.mjs`.

4. DECODE ROUND-TRIP (jsQR)
- About 200 seeded payloads across v1-v40 and all levels, including URLs, 'Gadigal', 'Aotearoa', macrons, 🦉 and CJK. The decoded binaryData must equal the TextEncoder bytes.
- Robustness: a 1.2× vertical stretch (half-block geometry), a 3×3 box blur, and a blanked 10% patch away from the finders at Q/H.
- Rasterised utf8 and utf8i text art decode with inversionAttempts 'attemptBoth'.

5. RENDERERS
- The SVG path parsed back into a module set equals the symbol; viewBox = size + 2m; the markup contains only numbers plus an escaped <title> (fuzzed with '<"&>').
- Text art: line count ceil((size+2m)/2), each line size+2m columns, glyph set, and a lossless inverse.
- PNG: signature, IHDR (bit depth 1, colour type 0), every chunk CRC, zlib.inflateSync(IDAT) equal to the expected filtered rows, Adler-32.
- moduleSize never exceeds maxCssPx, px*dpr is an integer, the requested size is clamped, and dense is flagged below 3 px.

6. COMMAND LAYER (table tests)
- parseQrArgs: -eH, -e h, --ec=Q, -l Q, -s 0 → error, -s fit, --sz → suggests --size, -t utf8i, --mask 9 → error, -v 41 → error, `-- -5°C`, and flags only → missing payload.
- classifyPayload:
  - vesen.app → https-added
  - localhost:5173/x → url
  - README.md with fileExists → is-a-file
  - has@salvesen.app → email tip
  - +61 412 345 678 → phone tip
  - v1.2.0, 3.14 and 'hello. world' → text
  - HTTP://X kept; WIFI:… kept
  - javascript:alert(1) → error
  - --text and --url overrides
- renderCardHtml: '<u>x</u>' and quotes are escaped in the text and in data-qr-payload; there is no newline inside the card; the hint and action set vary with the coarse, in-app and canShareFiles stubs.
- qrPalette: ≥7:1 for every themes.json entry, and a synthetic low-contrast theme falls back to #000/#fff.
- tracking redactor: `qr -e H secret` sends only '-e H'.

7. REPO GATES
- `npm test`, `npm run typecheck:lib`, svelte-check reporting exactly the 2 existing theme.ts errors, and `npm run build` in both Firebase workflows.
- Bundle check: the JS chunk is smaller than 142.85 kB before PR4.

8. BROWSER AND DEVICE
- Local Chrome at 375×812 with DPR 3, and at 1280 px:
  - the card bounding box, scrollWidth, activeElement after qr, the injection test
  - OpenCV and jsQR decodes of full-page screenshots with scanlines on, in cockatoo, swamphen and treefrog
- The step-5 device matrix covers the Instagram in-app browsers on iOS and Android.

## Risks

- Behaviour inside Instagram's in-app browsers is unverified. Long-press 'Save Image' on a data-URL <img>, navigator.share with files, the clipboard and downloads may each be blocked by the host app (WKWebView needs app-side delegates; Android WebView lacks Web Share). Mitigation:
- feature detection and hidden buttons
- an always-visible 'press and hold, or take a screenshot' hint
- device QA before PR4 ships to live
- Codes look different from today's. The ISO penalty picks the same mask as qrcode in only about 65% of cases (1304/2000), the DP segmenter can choose a smaller version, and the EC boost changes the printed level. Every symbol stays standard-compliant and is verified by jsQR. The golden and oracle tests pin masks and segments, so this cannot cause false failures.
- The CRT lift (z-index 10000 above .crt-overlay at 9999, app.css:136-143) depends on main and #app not creating a stacking context. A future transform, filter or opacity on them would trap the card again. Vintage mode already does (app.css:130-132), and Present mode is the escape there. Mitigation: a CSS comment and a check in the CRT workstream's QA.
- Half-block text depends on the font. iOS's generic monospace may lack U+2580-2588, or the glyphs may not fill the line box at line-height 1.2, which leaves gaps. Mitigation:
- an explicit Menlo-first font stack
- the column-fit check with automatic image fallback
- text art is opt-in only
- screenshot decode in device QA
- Present mode is the one non-terminal surface, with focus, keyboard and back-gesture edge cases. If the user navigates away before popstate, a stale state entry is left; it is ignored on load. Mitigation:
- the overlayOpen guard in Input.svelte
- [data-no-refocus] on the dialog
- a focus trap
- a QA checklist
- Merge friction. Input.svelte (5 small hunks), helpTexts.ts, commandSuggestions.ts, mobile.ts and tracking.ts are also targets of the autocomplete, mobile, accessibility and code-arrangement workstreams. Mitigation:
- small hunks
- qr.ts becomes qr/index.ts so commands.ts:7 is untouched
- the HTML-string contract is kept
- QrView is the agreed seam if the output-type workstream later introduces typed blocks
- the features-grep branch touches different helpTexts hunks and its own escapeHtml at fileSystem.ts:62, which can adopt html.ts
- Dispatcher limits remain until the shell workstream lands: whitespace collapses (commands.ts:319), '-h' anywhere triggers help (commands.ts:321), and there is no quote handling. These are documented in the help Tip and the README.
- Stored-deflate PNGs are uncompressed: about 34 KB at 518 px (v3) up to about 130 KB at 1024 px. They are generated lazily for Present mode and saves, and never stored in history. Acceptable; a fixed-Huffman deflate is a later option.
- History is still written to localStorage on every change (history.ts:22-28), although it is cleared on load (6-7). Inline SVG cards are about 1.5 KB at v3 but up to about 56 KB at v40, so the try/catch prevents a QuotaExceededError from throwing inside the store subscriber. Dropping that write-only persistence altogether is recommended to the code-arrangement workstream.
- Test tooling. vitest ~2.1 must stay on the Vite 5 line (pin it). If another workstream standardises on node:test, these tests port mechanically. CI needs setup-node; the engines field (>=18.17) still allows building without tests.
- Performance on low-end phones: the 8 auto-mask penalty passes take about 7-15 ms at v40 in Node, perhaps 3-4× that on a slow Android. That is acceptable for a rare case, and the typed-array loops from Design 0 keep typical links under 1 ms.

## Effort

About 6.5 engineer-days (range 5.5-7.5). Three working prototypes ((a design-time prototype, not kept) docs/plan/prototypes/qr, (a design-time prototype, not kept) are already verified against qrcode and the ISO vectors, so core time goes mostly to tests.

| Work | Days |
|---|---|
| PR1: harness, CI, core encoder and segmenter, vectors, oracle, golden, jsQR | 1.75 |
| PR2: engine swap, html.ts, dependency removal | 0.5 |
| PR3: renderers, palette, args and payload, card, CSS, Input/tracking/history hunks, help and suggestions | 2.5 |
| PR4: Present mode and actions | 1.0 |
| Device QA and fixes | 0.75 |
| PR5: README | 0.25 |
| **Total** | **6.75** |

The headline 6.5 days assumes the prototypes are reused as they stand.

Optional extras:
- --explain: 0.5 day
- -o and stdin after the shell workstream: 0.5 day
- qrencode alias: under 0.1 day

If the owner prefers the bare minimum, PR1, PR2 and a cut-down PR3 (card without actions) is about 3.5 days and fixes scannability, but leaves the Instagram show-a-friend flow unsolved.

## Trade-offs

**Encoder**
- **ISO penalty instead of qrcode's variant:** this is faithful to the brief and the spec. Parity with the old library is proved only in tests, through the penalty seam, so roughly 35% of codes get a different mask than today. Design 0's alternative (copy qrcode's scoring so the swap is bit-identical) was rejected because it ships a known deviation from the standard.
- **Optimal mixed-mode segmentation (about 1 KB) instead of single-mode:** the encoder is never larger than qrcode. Single-mode lost a version on 4 of 15 realistic digit-heavy payloads. The cost is that segment choice may differ from qrcode's; it is pinned in tests.
- **Left out:** Kanji, ECI, Micro QR and structured append. They are not needed for URLs and UTF-8 text on modern scanners.
- **EC boost on by default:** free robustness through scanlines and glare, but the printed level can differ from M. An explicit -e disables it.

**Display**
- **Themed ink and paper with a 7:1 guard (measured ≥12:1) instead of fixed black on white:** on-brand, and it re-themes live. Exports stay pure black on white. If the owner prefers fixed paper, it is a single change in qrPalette.
- **Inline SVG card plus a PNG in Present mode, instead of Design 0's inline SVG <img>:** inline SVG gives theming, crispness and a button for accessibility. Long-press save moves to Present mode's PNG, which iOS saves more reliably than an SVG image, at the cost of one extra tap on phones.
- **Card lifted above the CRT glass:** it looks like a sticker on the screen, not phosphor. Accepted for reliability (6/6 vs 4/6 decodes). Vintage mode is not hacked globally with :has(); Present mode covers it.
- **Present mode is a non-terminal overlay:** justified because phones cannot pinch-zoom (index.html:6) and cannot scan their own screen. It is kept minimal: no swipe gesture and no URL hash.

**Architecture**
- **HTML-string card with delegated, stateless data-* actions, instead of Design 1's RichBlock/Svelte output contract:** it fits today's {@html} pipeline and avoids colliding with the shell workstream's output types. The pure QrView object keeps a clean upgrade path.
- **Local flag parser in qr/args.ts:** it ships now. QR_FLAGS and qrCompletion are plain data, so the shared getopt and autocomplete can adopt them later.
- **vitest + jsQR instead of node:test:** two dev dependencies, but there are no `.ts` import specifiers or Node 22.18 requirement, it supports Svelte component tests later, and jsQR is a true independent decoder.
- **Stored-deflate PNG instead of canvas.toBlob or a deflate implementation:** larger files but deterministic, testable in Node, and immune to fingerprinting noise.

## Open questions raised by this design

- Colour: should the inline QR use theme-derived ink and paper (all 10 themes measured at 12-20:1, re-themes live), or always plain black on white like the exports?
- On phones, should Present mode (full screen) open automatically after `qr`, or only on tap or `-f`? Opening it automatically suits Instagram visitors, but it is less like a terminal.
- Vintage CRT mode: is it acceptable that the inline code stays under the vintage filter and overlay, with Present mode as the clean way to scan? The alternative is turning the vintage filter off for the whole terminal while a QR is on screen.
- Is it fine that `qr x` may print EC Q or H instead of M, because the level is raised for free when the code size allows? `-e M` would always keep M.
- Should a bare email address stay plain text with a tip to use `mailto:` (proposed), or be converted to `mailto:` automatically?
- Is Umami tracking (VITE_TRACKING_ENABLED) switched on in production? If it is:
- Do you approve redacting qr payloads?
- Should arguments be redacted for every command? Today all typed arguments are sent (Input.svelte:264-266, tracking.ts:9-13).
- Are you happy to add vitest and jsqr as dev dependencies and a Node 22 setup step in the Firebase workflows? The alternative is the zero-dependency node:test, which needs `.ts` import specifiers and Node 22.18 or later. Other workstreams should use the same runner.
- Before PR4 goes live, can you test on a physical iPhone and an Android phone with the Instagram app, opening the site from your profile link? Saving, sharing and copying inside those in-app browsers cannot be verified any other way.
- Should `javascript:` and `vbscript:` payloads be refused outright (proposed), or encoded literally like any other text?
- Are the optional extras worth the time for the portfolio: `qr --explain` (an annotated walk through the encoding pipeline) and a `qrencode` alias, about half a day each?
