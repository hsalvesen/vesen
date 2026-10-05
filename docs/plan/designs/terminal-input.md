# Terminal input and completion: reference design

> **How to read this file.** This is the full design that a three-way design panel produced and a judge synthesised for this workstream. It is the detailed reference: interfaces, file plan, steps and tests. Where it conflicts with the shared decisions in [../02-architecture-and-contracts.md](../02-architecture-and-contracts.md) or with the sequencing in [../03-terminal-input.md](../03-terminal-input.md), **those documents win**. Line numbers refer to `main` at commit 23758b9 (5 October 2026).

**Chosen approach:** Strangler prompt engine: shared lexer, spec-driven completion core, mirrored native input, keyboard-riding phone dock

## How it was chosen

- **Strangler engine: pure completion core plus a mirrored prompt line, swapped into Input.svelte one deployable PR at a time** scored 7.9. Weights: feasibility 0.3, UX 0.3, maintainability 0.15, effort 0.1, risk 0.15.

Feasibility 9. The native <input> stays the editing surface, so IME, autocorrect, paste and type=password for sudo keep working without new code. The core is pure modules testable in node. Delivery is 6 deployable PRs, and parity tests encode Input.svelte:381-613 and commandSuggestions.ts:38-234 before anything is swapped. I checked the 16px-scaled-input trick in Chromium on macOS: 120 glyphs at 16px x 0.75 and 16px x 0.875 measure exactly the same width as at 12px and 14px (0.000 px drift) for monospace, Menlo and the Tailwind mono stack.

UX 7. It delivers tappable chips, a list-then-cycle grid, a block cursor in cursorColor, ghost text, readline keys, Ctrl+R, selection-aware Ctrl+C, and no disabled input while busy. Gaps:
- Keyboard occlusion on phones is deferred to another workstream, while #app is still h-screen (index.html:13).
- Window clicks still focus the input on every tap over output (only interactive targets are skipped), so the keyboard pops up while reading (F011).
- Ps1 keeps '~' (Ps1.svelte:4).
- The scroll juggling and createEventDispatcher in App.svelte:19-56 stay (F010).
- Keystrokes are dropped while busy instead of being typed ahead.
- When no prefix can extend, Tab needs a second press before anything appears.

Maintainability 7. The tokenizer is used for completion only; execution keeps split(/\s+/) (commands.ts:319). The shell workstream's prototype lexer (scratchpad shellproto/lexer.ts) already has a different token shape and throws on incomplete input, so two lexers would drift apart.

Effort 9 (about 6.5-7 days). Risk 8.

- **Spec-driven completion and a pure line-editor core (one declaration per command, three layers)** scored 6.5. This is the strongest architecture:
- one lexer shared by completion and execution;
- one generic AbortController per command, which deletes the three allowlists at Input.svelte:207-209, Input.svelte:295-297 and commands.ts:343;
- registry duplicate detection, which would catch reset being defined at both commands.ts:116 and fileSystem.ts:479;
- a prompt that shows the real cwd;
- a strict tsconfig for the core, an architecture test, and fast-check round-trip properties.

Feasibility 6. The real input becomes a 1-2ch, opacity:0, pointer-events:none sink, and the whole line is drawn by LineView. Native caret placement, iOS caret drag and magnifier, selection handles and long-press inside the line are all lost and have to be rebuilt with caretPositionFromPoint mapping. Writing the model back to the DOM during Android composition is the hardest part of xterm-style editors, and this design puts it on the critical path.

UX 8: line wrapping, syntax colouring, a key bar and an accessory row.

Maintainability 9.

Effort 4. It takes about 13 days, and parseArgv, the help renderers, legacyRunner and the Runner/TerminalIO ports reach into the shell and arrangement workstreams.

Risk 4. It has the largest blast radius, though the kill switch helps. The accessory must also never be mounted inside <main>. I checked on the live site: with html.crt-vintage, the filter on main (app.css:130-132) makes main the containing block for position:fixed descendants. A fixed child resolved to main's bottom edge (794 px) instead of the viewport's (812 px).

- **Thumb & Tab: one spec-driven completion engine powering a mirrored line editor (desktop) and a dock pinned above the keyboard (phone)** scored 7.5. This has the best phone and Instagram story:
- the app column is sized from visualViewport, with the dock in normal flow, so it works even though WKWebView does not resize the layout viewport;
- a touch-aware focus policy that focuses synchronously inside the gesture;
- Run and Stop buttons;
- an input that is never disabled, with type-ahead;
- an interrupt that gives the prompt back even when a provider ignores the abort signal (F047);
- smart-punctuation and paste normalisation, and writingsuggestions=false;
- ghost text whose colour is solved for 3:1 contrast;
- a did-you-mean chip;
- a single accept() path, with a test that tapping a chip and selecting the same menu item give the same line.

Its Tab phases are the friendliest of the three designs: extend, list straight away when nothing can extend, then cycle.

Feasibility 7. A wrapping, transparent, scaled textarea with a PS1 text-indent multiplies the alignment surface, because every wrap boundary has to match the mirror. Secret mode cannot use type=password on a textarea.

Several proposals carry product risk:
- Starter chips run 'stock TEAM' and 'weather Gadigal' on first tap, while allorigins took more than 10 s and Open-Meteo cannot geocode Gadigal.
- The live theme preview would be persisted by theme.subscribe writing to localStorage (theme.ts:99-100) unless it bypasses the store.
- Persisting history contradicts the deliberate session-only history in history.ts:5-7.

Maintainability 8.

Effort 4. It takes about 14 days and includes font subsetting and theme tokens that belong to the UI workstream.

Risk 6.


Ideas grafted from the other candidates:

- From design 3: Tab phases idle, extended, listed, menu. A unique match is accepted; otherwise the common prefix is extended; when nothing can extend, the full list shows on the first Tab; the next Tab enters menu-select. Enter inside the menu accepts without running. This replaces design 1's fixed press-2 list and press-3 cycle.
- From design 3: the phone dock is in normal flow inside an #app column sized from visualViewport (--vvh/--vv-top), rather than fixed to the layout viewport. It holds [Tab] [up], scrolling chips, and Run/Stop/Cancel.
- From design 3: a touch-aware focus policy. Taps on output never open the keyboard. Mouse clicks are ignored when they are double clicks, drags, make a selection, or land on an interactive element. Focus is called synchronously inside the gesture, with preventScroll.
- From design 3: the input is never disabled and keeps accepting type-ahead while a command runs. The interrupt races the command promise, so Ctrl+C, Esc or Stop gives the prompt back immediately and any late output is dropped.
- From design 3: normalize.ts maps iOS smart punctuation and cleans pastes (leading '$ ' stripped, inner newlines become '; ', nothing auto-runs). The input sets writingsuggestions=false, data-1p-ignore and data-lpignore.
- From design 3: CSS tokens --theme-cursor, --theme-ghost (solved for at least 3:1 contrast per theme) and --theme-selection, plus one --term-font token shared by the mirror, the input and History. Today the input uses 'monospace' (Input.svelte:673) while Ps1 inherits the Tailwind mono stack (index.html:12).
- From design 3: a did-you-mean chip (Damerau-Levenshtein distance 2 or less), non-acceptable placeholder ghosts ('<city or place>'), and a one-tap-run starter chip row on an empty line on touch devices.
- From design 3: one BINDINGS table, platform-aware (Ctrl+W, Ctrl+P, Ctrl+N and Ctrl+T bound on macOS only), which also generates 'help keys'. Ctrl+D on an empty line prints a poweroff hint.
- From design 3: a parity test that tapping chip i produces the same line as menu-selecting candidate i and pressing Enter, both going through the single accept().
- From design 2: one tolerant lexer shared by completion, mirror colouring, an argv bridge in processCommand (commands.ts:319) and later the shell workstream's parser. Its token shape is a superset of both scratchpad prototypes.
- From design 2: a generic AbortController for every command. This deletes the allowlists at Input.svelte:207-209, Input.svelte:295-297 and commands.ts:343.
- From design 2: a Map-backed registry that rejects duplicates and never resolves inherited keys such as 'constructor' (F031). A coverage test pins the registry to Object.keys(commands).
- From design 2: case folding applied to each path segment, so 'cat Documents/my' still completes. Also fast-check round-trip property tests and an architecture test that keeps DOM, Svelte and store imports out of src/shell.
- From design 2: an observable cwd, a Ps1 that renders the real directory, and the cwd stored on each history entry. Simplified here: the controller reads currentPath after each run, so no command code changes. Also a ?prompt=legacy kill switch for one release and a Playwright smoke suite.
- From designs 2 and 3: theme chips carry a colour swatch (also addresses F075's 'chips in the suggestion row'); a visual bell plus an aria-live 'No completions' announcement instead of a beep; candidates capped at 200 with a '+N more' footer.
- New, verified: the dock must be a sibling of <main>. With html.crt-vintage, the filter on main (app.css:130-132) makes main the containing block for position:fixed. On the live site a fixed child resolved to main's bottom edge (794 px), not the viewport's (812 px).
- New: programmatic edits go through document.execCommand('insertText') on the selected replace range, falling back to setRangeText. This keeps native undo and input events coherent without a custom undo stack.
- New: --input-scale is measured at runtime (the mirror's font size divided by 16) instead of hard-coding 0.75 and 0.875, so it follows whatever terminal font size the UI workstream picks for F077. The input also gets an explicit text-shadow:none.

## Summary

The base is design 1's strangler plan: a pure, unit-tested core that is swapped into the app in 8 PRs, each deployable on its own, with golden parity tests written before anything changes.

The core lives under src/shell, matching F081's target layout. It contains:
- one tolerant, quote- and escape-aware lexer, shared with the shell workstream;
- a Map-backed CommandSpec registry for all 26 commands;
- a completion engine: complete(), accept(), a Tab state machine, ghost text and chips;
- a readline keymap with a history store and reverse search.

One CompletionResult drives four things, all through a single accept():
- Tab: unique match, then common-prefix extension, then an immediate list, then menu cycling;
- the grey ghost (history first, then completion, then a placeholder);
- inline chips on desktop;
- a dock on touch devices that rides above the software keyboard.

The real <input> remains the editing surface, so IME, autocorrect, paste and type=password still work. It becomes transparent and sits over an aria-hidden mirror that draws a block cursor in theme.cursorColor and the ghost. On phones the input is 16px and scaled down, so iOS does not zoom on focus.

The Tab branches (Input.svelte:381-613), getCompletions (Input.svelte:51-110), commandSuggestions.ts and the {@html} suggestion row are deleted. So are the window-level keydown handling, the disabled-while-busy input and the App.svelte scroll juggling.

Phone-specific grafts from design 3 (in-app WebView issues are summarised in the risks): the dock lives in a column sized to visualViewport, outside <main>; taps on output do not open the keyboard; Run/Stop buttons; type-ahead while a command runs; an interrupt that returns at once; punctuation normalisation.

Grafts from design 2: execution adopts the same lexer through an argv bridge, every command gets an AbortController, and the prompt shows the real cwd.

About 10.5 engineer-days.

## Architecture

LAYERS (imports point downwards only; an architecture test enforces this)

1) src/shell/**: pure TypeScript. No svelte, no stores, no window, document or localStorage. Tests run in node.
- lexer.ts: the single tolerant lexer.
  - It never throws. Instead it returns complete=false plus openQuote or danglingEscape.
  - Each token carries raw text, the unquoted value, start/end spans, and the parts and quoted flags the parser needs. This is a superset of the scratchpad prototypes proto/lexer.ts and shellproto/lexer.ts. The shell workstream's parser maps complete=false to bash's 'unexpected EOF while looking for matching' error.
  - argvFromLine() is the bridge processCommand uses until that parser lands.
- quote.ts: escapeTail(), which escapes only newly appended text and never a leading '~'.
- spec.ts and specs.ts: CommandSpec data for all 26 commands, in a registry built by createRegistry().
  - The registry is backed by a Map, rejects duplicate names and aliases, and returns undefined for inherited keys (F031).
  - The arrangement workstream later adds run() through defineCommand. Until then a coverage test pins specs to Object.keys(commands) (commands.ts:458-465).
- complete/{types,context,match,sources,engine,tab,ghost,chips}.ts.
- editor/{readline,keymap,normalize}.ts.
- history/historyStore.ts.

2) src/ui/prompt/**: Svelte 5.
- completionEnv.ts: the only adapter that reads app state: virtualFileSystem and currentPath (virtualFileSystem.ts:469-472), themes.json, cathodeModeInfo (cathode.ts:14-19), commandHistory (history.ts:17) and the registry.
- runLine.ts: the execution adapter. It takes over the Enter rules now in Input.svelte:243-357:
  - empty line;
  - sudo enters secret mode;
  - clear and reset do not add a display entry, and reset is not recorded in history;
  - commandHistory push;
  - tracking.
  It creates one AbortController per run and races the command promise against abort. It returns {entry, recordInHistory, interrupted}.
- promptController.svelte.ts: a rune class holding the canonical text, cursor, mode, tab, nav, search, status and cwd state. result, ghost and chips are $derived. It handles DOM events and turns reducer effects into DOM writes.
- LineEditor.svelte and PromptLine.svelte.
- CompletionRow.svelte: desktop, inline inside <main> under the prompt.
- PromptDock.svelte: touch devices, a sibling of <main>.
- Chip.svelte.
- actions/focusPolicy.ts and actions/stickToBottom.ts.
- src/ui/viewport.svelte.ts: visualViewport tracking, shared with the mobile workstream.

3) App.svelte: #app is a flex column containing [main: History, PromptLine, CompletionRow, status row] and, on coarse pointers, [PromptDock].

COMPLETION ENGINE: complete({text, cursor}, env)
a) Lex text[0, cursor]. The current word is the last word token, unless the head ends in unquoted whitespace or an operator, in which case it is an empty word at the cursor. replaceFrom is the word start and replaceTo is the cursor, so text after the cursor is kept.
b) The current simple command is everything after the last | || && ; or &.
- A word right after > >> < 2> or &> gets path completion.
- A word in first position gets command names plus aliases (hidden ones excluded).
- A commandLine source (sudo) strips itself and the rest re-enters as a fresh line.
c) Walk the earlier words against the spec. Descend into subcommands, note a pending flag that takes a value, and count positionals, skipping flags, flag values and anything after '--'. Then:
- A prefix starting with '-' gets the spec's flags plus the global -h/--help, which processCommand honours at commands.ts:321, minus flags already used.
- Argument index 0 on a command with subcommands gets the subcommands.
- Otherwise use args[i], or the last arg if it is variadic, and evaluate its ValueSource.
d) Matching:
- Case-sensitive prefix match first. If nothing matches, fall back to case-insensitive matching (caseFolded), applied per path segment.
- Sources flagged caseInsensitive (themes, cathode modes, examples, tickers) always match case-insensitively.
- Dotfiles are offered only when the basename prefix starts with '.'.
- Subcommands and flags keep their declared order; everything else is sorted with localeCompare. Results are de-duplicated and capped at 200, and the uncapped total is kept.
e) Path source:
- Split the word at its last '/'. Resolve the directory part with the normalising resolvePath, which is fixed for the '~/' and '/' branches (virtualFileSystem.ts:492-499).
- List the directory's own keys.
- Directories end in '/' and are non-terminal, so the next Tab descends into them.
- accept 'dir' drops files; accept 'file' still lists directories so the user can navigate.
- cd also offers '../' when the word is '', '.' or '..', matching commandSuggestions.ts:65.
f) accept():
- If the candidate starts with the typed prefix case-sensitively, the user's raw text is kept and escapeTail(remainder, quote) is appended.
- If it matched only by case folding, the whole word is rewritten.
- Terminal candidates close an open quote and add a space, unless the next character is already a space. Directories and '--opt=' add nothing.
f2) Example: 'cd ~/doc' completes to 'cd ~/documents/'.
g) Lookahead: if the only candidate equals the typed word exactly and the spec has subcommands or an enumerable first argument, result.next is the completion for the next level. So typing 'theme' still shows [ls, set], as commandSuggestions.ts:47-48 does today. Accepting a next-level chip inserts ' ' + value.
h) The engine never throws. Each source call is wrapped; on failure it returns an empty result and logs with console.debug in dev builds.

TAB STATE MACHINE (tab.ts)
Any edit or non-Tab key resets the state to idle, except while a menu is open.
- idle + Tab:
  - 0 candidates: visual bell (the prompt underline flashes for 150 ms) and aria-live 'No completions';
  - 1 candidate: accept('final'), then back to idle so the next Tab descends;
  - the common prefix is longer than the typed word: extend it and move to 'extended';
  - otherwise: move to 'listed' and show the full grid.
- extended + Tab, with the line unchanged since: move to 'listed'.
- listed + Tab: move to 'menu' and insert candidate 0 with accept('cycle'), which adds no space and keeps '/'. Tab and Shift+Tab move through the list and wrap; Esc restores the anchor line; Enter accepts with the suffix and does not run; a printable key, space or Right commits and keeps editing.
- Tab on an empty line lists every command.

GHOST (ghost.ts)
Candidates, in priority order:
1. the newest history entry that starts with the whole line (fish-style);
2. otherwise the remainder of a unique candidate, or the common-prefix remainder;
3. otherwise the ArgSpec placeholder, shown dim and not acceptable.
The ghost shows only when the cursor is at the end, nothing is selected, the mode is edit and no menu is open.

DOM STRATEGY (LineEditor.svelte)
- The input remains the editing surface. The controller adopts its value and selection on input, select, document selectionchange and compositionend.
- .prompt-line is position:relative and holds .mirror (aria-hidden; renders before | cursor cell | after | ghost; white-space:pre; font var(--term-font)) and the <input>.
- The input is absolutely positioned at inset 0, with color, -webkit-text-fill-color and caret-color all transparent, text-shadow:none, and ::selection set to color-mix(in srgb, var(--theme-cursor) 35%, transparent).
- At (pointer: coarse) or widths under 768px, the input font-size is 16px with transform: scale(var(--input-scale)), transform-origin 0 0, and width calc(100% / var(--input-scale)). --input-scale is the mirror's computed font size divided by 16, re-measured on resize and on document.fonts.ready.
- Long lines scroll horizontally like readline's horizontal-scroll-mode: mirror.scrollLeft = input.scrollLeft * scale on input, scroll and select.
- The block cursor uses var(--theme-cursor) with the character drawn in var(--theme-background). It blinks on a 1.06 s steps(1) cycle and holds steady for 600 ms after each keystroke. It becomes a hollow outline when unfocused and is hidden while busy or while text is selected. It does not blink under prefers-reduced-motion.
- A pointerup inside the ghost span's rectangle accepts the ghost.
- Programmatic edits select [replaceFrom, replaceTo] and call document.execCommand('insertText'), falling back to setRangeText. A suppress flag stops the controller's own input event from resetting the Tab session. While composing, writes wait until compositionend, except when the user explicitly taps a chip.
- Secret mode uses type=password, and the mirror renders only the cursor.

EVENT ROUTING
- keydown, beforeinput, input and the composition events are listened for on the input only. This removes the window onkeydown at Input.svelte:652 and the duplicate listener at Input.svelte:145-151.
- One small window keydown listener remains:
  - a printable key while focus is on body or main focuses the input synchronously with preventScroll, so the character lands in it;
  - Ctrl+C or Esc while busy and the input is unfocused interrupts.
- The focusPolicy action on main:
  - a mouse click focuses the input, unless event.detail > 1, the pointer dragged more than 6 px, the selection is not collapsed, or the target is inside a, button, input, textarea, select, [contenteditable] or [data-interactive];
  - a touch focuses only on the prompt line or the empty area below it.

BUSY AND INTERRUPT
When the user presses Enter:
- The line is snapshotted and cleared, and the mode becomes busy.
- PromptLine shows PS1 followed by the frozen line.
- The status row shows the spinner, then the label (speedtestPhase for speedtest, otherwise 'running'), then the elapsed seconds after 1 s, then 'Ctrl+C or Esc to stop' after 3 s.
- The input stays focused and is never disabled. Typing goes into it as type-ahead, which is not shown until the prompt returns. Enter while busy rings the bell.

When the user interrupts (Ctrl+C, Esc or Stop):
- The run is aborted and the UI resolves immediately with an entry ending in '^C'.
- A run token drops any late output.

PHONE LAYOUT
- viewport.svelte.ts writes --vvh and --vv-top from visualViewport resize and scroll events, throttled with requestAnimationFrame.
- #app is position:fixed with inset 0, height var(--vvh, 100dvh) and transform translateY(var(--vv-top)). It is a flex column: main is flex 1 with overscroll-behavior:contain; PromptDock is flex none with env(safe-area-inset-bottom) padding.
- The dock must be a sibling of main, because html.crt-vintage's filter on main (app.css:130-132) makes main the containing block for position:fixed (verified on the live site).

SCROLLING
The stickToBottom action replaces App.svelte:17-56 and Input.svelte:159-189. A ResizeObserver watches main's content. After a change, the view scrolls instantly to the bottom only if it was within 40 px of the bottom before the change. Editing keeps the prompt line in view.

CWD
- After each run the controller sets cwd from currentPath, using ~ for /home/user. Each history entry stores its cwd at submit time, and Ps1 renders it. No command code changes.
- Later the VFS workstream replaces this with its own cwd store behind completionEnv.fs.

ARGV BRIDGE
- processCommand builds args with argvFromLine(input) instead of input.trim().split(/\s+/) (commands.ts:319). Operators are re-emitted as words, so echo's legacy redirect parsing (fileSystem.ts:380-405) still works.
- Every command receives the AbortController; the allowlist at commands.ts:343 is deleted.
- The shell workstream's parser later replaces this bridge but consumes the same lexer.

## Key interfaces

```ts
// ===== src/shell/lexer.ts  (shared with the shell/parser workstream)
export type Quote = '"' | "'" | null;
export type Operator = '|' | '||' | '&&' | ';' | '&' | '>' | '>>' | '<' | '2>' | '2>>' | '&>' | '2>&1';
export type WordPart =
  | { kind: 'lit'; text: string; quoted: boolean }                  // quoted => no glob / tilde
  | { kind: 'var'; name: string; quoted: boolean; braced: boolean };
export interface WordToken {
  kind: 'word'; start: number; end: number;   // UTF-16 [start, end)
  raw: string;                                 // line.slice(start, end)
  value: string;                               // quotes removed, escapes applied, $VAR left literal
  parts: WordPart[]; quoted: boolean; openQuote: Quote; danglingEscape: boolean;
}
export interface OpToken { kind: 'op'; start: number; end: number; raw: Operator }
export type Token = WordToken | OpToken;
export interface LexResult { tokens: Token[]; complete: boolean; commentAt: number | null }
export function lex(line: string): LexResult;                                   // total: never throws
export function argvFromLine(line: string): { argv: string[]; error?: string }; // ops re-emitted as words

// ===== src/shell/quote.ts
export function escapeTail(text: string, quote: Quote): string;
export function quoteWord(value: string): string;

// ===== src/shell/spec.ts
export interface EnumValue { value: string; summary?: string; swatch?: string }
export type ValueSource =
  | { kind: 'path'; accept?: 'any' | 'file' | 'dir'; includeParent?: boolean }
  | { kind: 'command' }                                   // help
  | { kind: 'commandLine' }                               // sudo: rest is a nested line
  | { kind: 'enum'; values: () => readonly EnumValue[]; caseInsensitive?: boolean }
  | { kind: 'examples'; caseInsensitive?: boolean; fromHistory?: boolean } // this arg position of spec.examples
  | { kind: 'free'; placeholder: string };
export interface FlagSpec { short?: string; long?: string; summary: string; value?: { name: string; source: ValueSource } }
export interface ArgSpec { name: string; source: ValueSource; optional?: boolean; variadic?: boolean }
export interface Example { line: string; summary?: string; starter?: number }   // starter = rank on touch empty line
export interface CommandSpec {
  name: string; summary: string; aliases?: readonly string[];
  flags?: readonly FlagSpec[]; args?: readonly ArgSpec[]; subcommands?: readonly CommandSpec[];
  examples?: readonly Example[]; hidden?: boolean;
}
export interface SpecRegistry {
  get(nameOrAlias: string): CommandSpec | undefined;     // Map-backed: get('constructor') === undefined
  names(opts?: { includeHidden?: boolean }): string[];
  all(): readonly CommandSpec[];
  validate(): string[];   // duplicates, args+subcommands together, non-final variadic, examples that fail to lex
}
export function createRegistry(specs: readonly CommandSpec[]): SpecRegistry;

// ===== src/shell/complete/types.ts
export interface EditState { text: string; cursor: number }
export interface FsEntry { name: string; type: 'file' | 'dir' }
export interface CompletionEnv {
  registry: SpecRegistry;
  fs: { home: readonly string[]; cwd(): readonly string[]; list(abs: readonly string[]): readonly FsEntry[] | null };
  history(): readonly string[];                                  // oldest .. newest
}
export type CandidateKind = 'command' | 'subcommand' | 'flag' | 'dir' | 'file' | 'value' | 'example';
export interface Candidate {
  value: string;        // unescaped replacement for the word, e.g. 'documents/linux.txt'
  label: string;        // chip / grid text, e.g. 'linux.txt', 'documents/'
  kind: CandidateKind; summary?: string; swatch?: string;
  terminal: boolean;    // false for dirs and '--opt=': no space, keep completing
}
export type Slot = 'command' | 'subcommand' | 'flag' | 'flag-value' | 'arg' | 'redirect' | 'none';
export interface CompletionResult {
  state: EditState; replaceFrom: number; replaceTo: number;     // replaceTo === state.cursor
  prefix: string; quote: Quote; slot: Slot; spec?: CommandSpec; placeholder?: string;
  candidates: Candidate[]; total: number; common: string; caseFolded: boolean;
  next?: CompletionResult;                                      // lookahead for an exactly typed word
}

// ===== src/shell/complete/engine.ts, match.ts
export function complete(st: EditState, env: CompletionEnv): CompletionResult;          // never throws
export function accept(r: CompletionResult, c: Candidate, mode: 'final' | 'cycle'): EditState;
export function extendToCommon(r: CompletionResult): EditState | null;
export function longestCommonPrefix(values: readonly string[], caseInsensitive?: boolean): string;
export function didYouMean(word: string, pool: readonly string[], maxDistance?: number): string[];

// ===== src/shell/complete/tab.ts
export type TabState =
  | { phase: 'idle' }
  | { phase: 'extended'; key: string }                                  // key = text + '\u0000' + cursor
  | { phase: 'listed'; key: string; result: CompletionResult }
  | { phase: 'menu'; key: string; result: CompletionResult; index: number; anchor: EditState };
export interface TabEffect { edit?: EditState; list?: 'show' | 'hide'; highlight?: number | null; bell?: boolean }
export function pressTab(s: TabState, st: EditState, env: CompletionEnv, reverse: boolean): { tab: TabState; effect: TabEffect };
export function menuKey(s: Extract<TabState, { phase: 'menu' }>, key: 'enter' | 'escape' | 'commit'): { tab: TabState; effect: TabEffect };

// ===== src/shell/complete/ghost.ts, chips.ts
export interface Ghost { text: string; source: 'history' | 'completion' | 'placeholder'; acceptable: boolean }
export function ghostFor(st: EditState, r: CompletionResult, history: readonly string[]): Ghost | null;
export function applyGhost(st: EditState, g: Ghost, unit: 'all' | 'word'): EditState;
export type PromptMode = 'edit' | 'busy' | 'secret' | 'search';
export type ChipAction = 'apply' | 'run' | 'replace-command' | 'history-prev' | 'tab' | 'submit' | 'interrupt' | 'cancel';
export interface Chip {
  id: string; label: string; matchLen: number; action: ChipAction;
  kind: CandidateKind | 'starter' | 'didyoumean' | 'control';
  candidate?: Candidate; line?: string; summary?: string; swatch?: string; selected?: boolean;
}
export function chipsFor(s: { mode: PromptMode; state: EditState; result: CompletionResult; tab: TabState;
  touch: boolean; registry: SpecRegistry; history: readonly string[]; max: number }): Chip[];

// ===== src/shell/editor/readline.ts, keymap.ts, normalize.ts
export interface KillRing { text: string; lastWasKill: boolean }
export type EditOp = 'bol' | 'eol' | 'charLeft' | 'charRight' | 'wordLeft' | 'wordRight' | 'killToStart' | 'killToEnd'
  | 'killWordBackUnix' | 'killWordBackAlnum' | 'killWordFwd' | 'yank' | 'deleteChar' | 'transpose';
export function applyOp(st: EditState, op: EditOp, ring: KillRing): { state: EditState; ring: KillRing };
export function yankLastArg(st: EditState, history: readonly string[]): EditState;            // Alt+.
export interface KeyChord { key: string; code: string; ctrl: boolean; alt: boolean; meta: boolean; shift: boolean; isComposing: boolean; keyCode: number }
export type Action =
  | { a: 'op'; op: EditOp } | { a: 'tab'; reverse: boolean } | { a: 'submit' } | { a: 'acceptGhost'; unit: 'all' | 'word' }
  | { a: 'history'; dir: -1 | 1 } | { a: 'search'; dir: -1 | 1 } | { a: 'searchCancel' } | { a: 'yankLastArg' }
  | { a: 'interrupt' } | { a: 'clearScreen' } | { a: 'escape' } | { a: 'eof' } | { a: 'native' };
export interface KeyCtx { mode: PromptMode; platform: 'mac' | 'other'; atEnd: boolean; empty: boolean;
  hasGhost: boolean; hasSelection: boolean; menuOpen: boolean; escArmed: boolean }
export interface Binding { chord: string; platforms?: ('mac' | 'other')[]; when?: (c: KeyCtx) => boolean; action: Action; label: string }
export const BINDINGS: readonly Binding[];
export function resolveKey(e: KeyChord, ctx: KeyCtx): Action;
export function normalizeTyped(s: string): string;
export function normalizePaste(s: string): string;

// ===== src/shell/history/historyStore.ts
export interface SafeStorage { get(key: string): string | null; set(key: string, value: string): void }
export interface HistoryNav { index: number; prefix: string; draft: EditState | null }   // index -1 = editing draft
export interface SearchHit { index: number; entry: string; at: number }
export interface HistoryStore {
  entries(): readonly string[];
  add(line: string): void;                                         // ignorespace, ignoredups, cap 500
  step(nav: HistoryNav, st: EditState, dir: -1 | 1): { nav: HistoryNav; state: EditState } | null;
  search(query: string, from: number, dir: -1 | 1): SearchHit | null;
}
export function createHistoryStore(backing: { get(): string[]; set(v: string[]): void }, storage?: SafeStorage | null): HistoryStore;

// ===== src/ui/prompt/runLine.ts
export interface RunIO { signal: AbortSignal; enterSecret(label: string): void }
export interface RunResult { entry: Command | null; recordInHistory: boolean; interrupted: boolean }
export function runLine(line: string, io: RunIO): Promise<RunResult>;

// ===== src/ui/prompt/promptController.svelte.ts
export class PromptController {
  mode: PromptMode;                                      // $state
  text: string; cursor: number; selEnd: number; composing: boolean;
  tab: TabState; nav: HistoryNav;
  search: { query: string; hit: SearchHit | null; failed: boolean; saved: EditState } | null;
  cwd: string;                                           // '~', '~/documents', '/etc'
  status: { line: string; label: string; startedAt: number } | null;
  bellAt: number; focused: boolean;
  readonly result: CompletionResult;                     // $derived complete({text, cursor}, env)
  readonly ghost: Ghost | null;                          // $derived
  readonly chips: Chip[];                                // $derived
  constructor(deps: { env: CompletionEnv; history: HistoryStore; platform: 'mac' | 'other'; touch: () => boolean; run: typeof runLine });
  attach(input: HTMLInputElement): () => void;           // keydown, beforeinput, input, composition*, select, focus, blur
  pressTab(reverse?: boolean): void;
  choose(chip: Chip): void;                              // same accept() path as Tab and menu
  acceptGhost(unit?: 'all' | 'word'): void;
  submit(): Promise<void>;
  interrupt(): void;                                     // abort + immediate prompt + '^C'
  clearScreen(): void;
  destroy(): void;
}

// ===== src/ui/viewport.svelte.ts
export interface ViewportState { height: number; offsetTop: number; keyboard: boolean; coarse: boolean;
  reducedMotion: boolean; inApp: 'instagram' | 'facebook' | null }
export function trackViewport(root: HTMLElement): ViewportState & { destroy(): void };

// ===== src/interfaces/command.ts (backwards compatible)
export interface Command { command: string; outputs: string[]; cwd?: string; status?: 'ok' | 'interrupted' }

// ===== src/shell/specs.ts (excerpt)
const themeEnum = () => themes.map(t => ({ value: t.name, swatch: t.background }));
export const specs: CommandSpec[] = [
  { name: 'cd', summary: d.cd, args: [{ name: 'dir', optional: true, source: { kind: 'path', accept: 'dir', includeParent: true } }] },
  { name: 'cat', summary: d.cat, args: [{ name: 'file', source: { kind: 'path', accept: 'file' } }], examples: [{ line: 'cat README.md', starter: 3 }] },
  { name: 'ls', summary: d.ls, flags: [{ short: 'a', long: 'all', summary: 'include dotfiles' }], args: [{ name: 'dir', optional: true, source: { kind: 'path' } }] },
  { name: 'rm', summary: d.rm, flags: [{ short: 'r', long: 'recursive', summary: 'remove directories' }], args: [{ name: 'path', source: { kind: 'path' } }] },
  { name: 'theme', summary: d.theme, subcommands: [
      { name: 'ls', summary: 'list themes' },
      { name: 'set', summary: 'switch theme', args: [{ name: 'theme', source: { kind: 'enum', values: themeEnum, caseInsensitive: true } }] }] },
  { name: 'weather', summary: d.weather, args: [{ name: 'location', variadic: true, source: { kind: 'examples', caseInsensitive: true, fromHistory: true } }],
    examples: [{ line: 'weather Gadigal' }, { line: 'weather Oslo' }, { line: 'weather Aotearoa' }] },
  { name: 'sudo', summary: d.sudo, args: [{ name: 'command', variadic: true, source: { kind: 'commandLine' } }] },
  // ... all 26 commands; d = commandDescriptions (helpTexts.ts:83-110)
];
```

## What the visitor sees

DESKTOP: TYPING
- The caret is a blinking block in the theme's cursorColor. It holds steady while you type, becomes a hollow outline when the terminal is unfocused, and does not blink under reduced motion.
- Grey ghost text after the cursor offers the rest of your most recent matching command, or else the rest of the top completion. For example, 'the' shows 'me'.
- Right, End, Ctrl+E (or Ctrl+F on a Mac) at the end of the line accepts the whole ghost. Alt+Right or Alt+F accepts one word.
- After 'weather ', a dim '<city or place>' hint appears. It cannot be accepted.
- Under the prompt, compact clickable chips show candidates: directories in blue with '/', commands, flags, and themes with a colour dot.
- Typing exactly 'theme' still shows [ls] and [set], as today.

TAB
- First Tab: a unique match completes, adding a space, or '/' for a directory so the next Tab keeps going ('cat documents/l' becomes 'cat documents/linux.txt '). Several matches extend to their common prefix ('ca' becomes 'cat').
- When nothing can extend, the full grid appears at once. Pressing Tab again after an extension also shows the grid.
- The next Tab cycles through the candidates inline, with the chip highlighted. Shift+Tab goes back, Esc restores what you typed, Enter accepts without running, and any other key keeps the choice and carries on.
- On an empty line, Tab lists every command.
- With no match, the prompt underline flashes. There is no beep.
- Flags complete after '-' ('ls -' gives -a, --all, -h, --help). Flags already used are not offered again.
- Paths complete through '~/', '/', '../' and nested directories, after '>' and '>>', and after '|', '&&' or ';', where a new command name is completed.
- 'sudo theme set k' and 'help ca' complete as expected.
- If the case does not match, completion falls back to ignoring it ('cat rea' gives 'README.md').
- Dotfiles appear only once you type '.'.
- An open quote is closed on completion ('cat "READ' gives 'cat "README.md" ').
- rm no longer suggests the unimplemented -f.
- Esc then Tab within 1 s moves keyboard focus out of the terminal.

READLINE AND HISTORY
- Line movement: Ctrl+A/E and Home/End. Words: Alt+B/F.
- Killing and yanking: Ctrl+U and Ctrl+K kill to the start and end. Ctrl+W kills the previous word on Mac only; Alt+Backspace and Ctrl+Backspace do it everywhere. Alt+D kills the next word. Ctrl+Y yanks. Alt+. inserts the previous command's last argument.
- Ctrl+L clears the screen and keeps the current line. Ctrl+D deletes forward, and on an empty line prints a hint to use poweroff.
- Up and Down walk history filtered by what you have typed, skipping duplicates. Down past the newest entry restores your draft.
- Ctrl+R shows (reverse-i-search)`q': with the match highlighted. Ctrl+R goes older and Ctrl+S newer. Enter runs the match, arrows place it on the line for editing, and Esc or Ctrl+G cancels. When nothing matches it shows (failed reverse-i-search).
- Cmd shortcuts on a Mac stay native.
- 'help keys' prints all bindings.

COPY AND FOCUS
- Selecting output and pressing Ctrl+C copies on Windows and Linux.
- Without a selection, Ctrl+C prints the line with '^C' and gives a fresh prompt, as bash does.
- Clicking output to select, double-clicking and dragging never steal focus or jump the scroll.
- A plain click refocuses the prompt without scrolling. Typing while unfocused focuses the prompt without losing the first character.
- Output follows the bottom only if you were already there.

RUNNING A COMMAND
- The prompt shows the command, frozen. The status row shows the spinner, the label (for example the speedtest phase) and the elapsed seconds after 1 s, then adds 'Ctrl+C or Esc to stop' after 3 s.
- Every command can be stopped, and the prompt returns at once even if the network call hangs.
- Anything you type meanwhile appears in the next prompt.
- Completion never waits on the network.

SUDO
- The prompt shows 'Password:' and echoes nothing. Ctrl+C or the Cancel chip prints 'sudo: password entry cancelled'.

PHONE AND INSTAGRAM IN-APP BROWSER
- The input is 16px but drawn at terminal size, so nothing zooms on focus and pinch-zoom can be re-enabled.
- Tapping or scrolling output never opens the keyboard. Tapping the prompt does.
- A 48px dock rides on top of the software keyboard because the app is sized to the visual viewport. It holds [Tab] and [up], scrolling chips, and [Run], which becomes [Stop] while a command runs or [Cancel] at the password prompt.
- Tapping a chip inserts it exactly as Tab would, and the keyboard stays open. A directory chip then shows its contents, so you can walk a path entirely by tapping.
- Mistyped commands get a [did you mean fastfetch?] chip.
- Tapping the grey ghost accepts it.
- On an empty line, starter chips marked with a run glyph run in one tap without opening the keyboard. The default list is help, fastfetch, cat README.md, theme ls and cathode ls; network commands are added once their backends are reliable.
- The keyboard's return key reads Go.
- The keyboard stays open between commands.
- Curly quotes and em dashes from iOS are straightened. Multi-line pastes become one line and never auto-run.

ACCESSIBILITY
- The input is a labelled combobox with aria-expanded and aria-activedescendant pointing into the role=listbox chips. The mirror is aria-hidden.
- 'No completions' is announced politely.
- Ghost text meets 3:1 contrast on every theme, and chip text meets 4.5:1.
- The prompt is a <span>, not an <h1>.

## Files

| Path | Purpose |
|---|---|
| `src/shell/lexer.ts` | Shared tolerant lexer. Returns word tokens (raw, value, parts, quoted, openQuote, danglingEscape, spans) and operator tokens (\| \|\| && ; & > >> < 2> 2>> &> 2>&1) plus a comment position. Never throws. argvFromLine() is the bridge for processCommand. Shared ownership with the shell/parser workstream. |
| `src/shell/quote.ts` | escapeTail(text, quote): outside quotes escapes whitespace and ' " \ \| & ; < > ( ) $ ` * ? # !; inside double quotes escapes only " \ $ `; never escapes a leading ~. Also quoteWord(). |
| `src/shell/spec.ts` | Types CommandSpec, FlagSpec, ArgSpec, ValueSource, EnumValue and Example, plus createRegistry() (Map-backed, rejects duplicates, validate()). This is the type the arrangement workstream later extends with run(). |
| `src/shell/specs.ts` | Specs for all 26 commands. Example lists now duplicated in Input.svelte:537-540/563-569, commandSuggestions.ts:9-20 and helpTexts.ts live only here. rm declares only -r/--recursive (fileSystem.ts:247). theme set takes an enum of theme names with swatches; cathode set takes an enum of modes without 'off'; sudo takes commandLine; help takes command. |
| `src/shell/complete/types.ts` | EditState, FsEntry, CompletionEnv, Candidate, CandidateKind, Slot, CompletionResult. |
| `src/shell/complete/context.ts` | cursorContext(): finds the simple command under the cursor, the slot (command, subcommand, flag, flag-value, arg, redirect), argument index, open quote, replace span, and the sudo recursion. |
| `src/shell/complete/match.ts` | Case-sensitive-then-case-insensitive prefix matching (per path segment), longestCommonPrefix, didYouMean (Damerau-Levenshtein distance 2 or less). Replaces the 8 copies of the common-prefix reduce at Input.svelte:398, 424, 461, 487, 519, 551, 579 and 597. |
| `src/shell/complete/sources.ts` | Evaluates each ValueSource: path, command, commandLine, enum, examples (this argument position of spec.examples plus recent history values) and free (placeholder only). Each one is wrapped so it can never throw. |
| `src/shell/complete/engine.ts` | complete(), accept() (raw-preserving insertion, quote closing, suffix rules), extendToCommon(), and the lookahead result in next. |
| `src/shell/complete/tab.ts` | Pure Tab state machine with phases idle, extended, listed and menu; pressTab() and menuKey(). |
| `src/shell/complete/ghost.ts` | ghostFor() (history, then completion, then placeholder) and applyGhost() for the whole ghost or one word. |
| `src/shell/complete/chips.ts` | chipsFor(): completion chips (with match length and swatch), lookahead chips, a did-you-mean chip for an unknown command, starter chips on an empty touch line, an up-arrow 'history' chip, and control chips (Stop while busy, Cancel in secret mode, Run). Replaces commandSuggestions.ts. |
| `src/shell/editor/readline.ts` | Pure edit operations on EditState: bol, eol, char and word moves, killToStart, killToEnd, killWordBackUnix (Ctrl+W), killWordBackAlnum (Alt+Backspace), killWordFwd, yank, deleteChar, transpose, yankLastArg. A one-slot kill ring concatenates consecutive kills. |
| `src/shell/editor/keymap.ts` | BINDINGS table (platform-aware; Alt keys matched on event.code because Option+B produces a symbol on macOS) and resolveKey(). Returns 'native' for isComposing, keyCode 229, Meta chords, and Ctrl+C with a selection. Also renders the 'help keys' output. |
| `src/shell/editor/normalize.ts` | normalizeTyped(): curly quotes become straight, en and em dashes become '--', NBSP becomes a space. normalizePaste(): CRLF becomes LF, a leading '$ ' is stripped, the trailing newline is dropped, inner newlines become '; '. Nothing auto-runs. |
| `src/shell/history/historyStore.ts` | Over the commandHistory writable: add() with ignorespace and ignoredups and a cap of 500; step() navigates filtered by the typed prefix and restores the draft past the newest entry; search() for reverse-i-search. Optional persistence through an injected SafeStorage, used only if the owner approves. |
| `src/shell/__tests__/*.test.ts and src/shell/__tests__/fixtures.ts` | vitest suites in a node environment. The fixture CompletionEnv mirrors the real /home/user layout plus nested directories, names with spaces and quotes, dotfiles and an empty directory. It never imports virtualFileSystem.ts, which calls window at import time (virtualFileSystem.ts:12-29). |
| `src/ui/prompt/completionEnv.ts` | Browser CompletionEnv adapter over virtualFileSystem/currentPath, themes.json, cathodeModeInfo, commandHistory and the registry. In dev builds it warns about any command with no spec. |
| `src/ui/prompt/runLine.ts` | Execution adapter carrying the rules from Input.svelte:243-357: sudo enters secret mode; clear/reset skip display; reset is not recorded; tracking sends the command name only. One AbortController per run, a promise race with the abort, a run token, and status 'interrupted' entries ending in '^C'. |
| `src/ui/prompt/promptController.svelte.ts` | Rune class holding mode, text, cursor, tab, nav, search, status, cwd and bell state; $derived result, ghost and chips. attach(input) wires all DOM events. Also choose(), pressTab(), acceptGhost(), submit(), interrupt() and clearScreen(). |
| `src/ui/prompt/LineEditor.svelte` | Mirror plus transparent native input: block cursor, ghost (tap to accept), selection colour, scaled 16px input on coarse pointers, horizontal scroll sync. Attributes: enterkeyhint=go, autocapitalize=none, autocorrect=off, spellcheck=false, autocomplete=off, writingsuggestions=false, data-1p-ignore, data-lpignore, aria-label 'Terminal command line', role=combobox, aria-expanded, aria-controls, aria-activedescendant. |
| `src/ui/prompt/PromptLine.svelte` | Live prompt row. Shows Ps1 (live cwd) plus LineEditor in edit mode; '(reverse-i-search)`q': match' or the failed form in search mode; 'Password:' in secret mode; PS1 plus the frozen line in busy mode. Also the visual-bell class. |
| `src/ui/prompt/CompletionRow.svelte` | Replaces CommandSuggestionsRow.svelte. On desktop and fine pointers, an inline compact strip of chips (first 12 plus '+N more'), a full grid when listed, and the highlighted item in menu mode. role=listbox; text nodes only, no {@html}. Hidden on coarse pointers, where the dock takes over. |
| `src/ui/prompt/PromptDock.svelte` | Touch-only dock, a sibling of <main>, 48px tall: [Tab] and [up] on the left, horizontally scrolling chips, and on the right [Run], [Stop] while busy, or [Cancel] in secret mode. A dim 'no matches' or empty-directory note so the layout never jumps. |
| `src/ui/prompt/Chip.svelte` | A <button> with the typed prefix in bold, kind styling from CSS variables, an optional theme swatch dot and a 44px minimum height on coarse pointers. pointerdown calls preventDefault so the input keeps focus and the keyboard stays up. The title or long-press shows the summary. |
| `src/ui/prompt/actions/focusPolicy.ts` | Svelte action on <main> implementing the mouse/touch focus policy and type-to-focus. Uses focus({preventScroll: true}) synchronously inside the gesture. |
| `src/ui/prompt/actions/stickToBottom.ts` | ResizeObserver-based scroll that sticks to the bottom only when the view was already within 40px of it, and keeps the prompt in view during edits. Replaces App.svelte:17-56 and Input.svelte:159-189. |
| `src/ui/viewport.svelte.ts` | trackViewport(): visualViewport sets --vvh and --vv-top; also exposes keyboard-open, coarse-pointer, reduced-motion and in-app-browser flags. Co-owned with the mobile workstream. |
| `src/App.svelte` | #app becomes a column of <main> (History, PromptLine, CompletionRow, status) and PromptDock on coarse pointers. Removes the four bindable states and the scroll juggling (lines 12-56), the CommandSuggestionsRow wiring (line 85) and the Input binding (line 82). Creates the PromptController. |
| `src/components/Ps1.svelte` | Props cwd, live and compact. Renders the real directory instead of the hard-coded '~' (line 4). Uses <span> instead of <h1> (lines 10 and 14). Compact form below 480px, subject to the owner's choice of hostname. |
| `src/components/History.svelte` | Passes entry.cwd to Ps1 (line 11). Font comes from var(--term-font) instead of 'monospace' (line 28). |
| `src/interfaces/command.ts` | Command gains optional cwd and status ('ok' \| 'interrupted'). Backwards compatible with the banner entry. |
| `src/stores/theme.ts` | updateCSSVariables (lines 8-29) also sets --theme-cursor from cursorColor, --theme-ghost (foreground mixed toward background until contrast is 3:1) and --theme-selection. |
| `src/stores/history.ts` | Deletes the dead serialisation and removal of display history (lines 6-7, 22-28). Persists commandHistory only through the safe storage helper, and only if the owner approves. |
| `src/app.css` | --term-font token, cursor blink keyframes, prefers-reduced-motion overrides, bell flash. |
| `src/utils/commands.ts` | Line 319 uses argvFromLine(input). Line 343: every command gets the AbortController and the allowlist goes. |
| `src/utils/virtualFileSystem.ts` | resolvePath (lines 488-517) normalises '.' and '..' for the '~/' and '/' branches too, sharing one segment loop. |
| `index.html` | With the mobile workstream: viewport meta 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content' (drops maximum-scale and user-scalable at line 6 once the input is 16px); #app sized with 100dvh and --vvh instead of h-screen (line 13). |
| `src/components/Input.svelte, src/components/CommandSuggestionsRow.svelte, src/utils/commandSuggestions.ts` | DELETE. commandSuggestions.ts goes in PR2. CommandSuggestionsRow goes in PR3. Input.svelte is kept behind ?prompt=legacy for one release, then deleted in PR8. |
| `vitest.config.ts, package.json` | devDependencies vitest ^2.1 (Vite 5 compatible), fast-check, jsdom and @playwright/test. Scripts: test (vitest run) and test:e2e (playwright test). |
| `playwright.config.ts, tests/e2e/prompt.spec.ts` | About 15 smoke cases against vite preview on desktop Chromium and WebKit, iPhone 13 (WebKit) and Pixel 7 (Chromium). |
| `.github/workflows/firebase-hosting-pull-request.yml and firebase-hosting-merge.yml` | 'npm ci && npm run build' becomes 'npm ci && npm test && npm run build'. Playwright is an optional job on PRs that touch src/ui/prompt. |
| `README.md` | A 'Keyboard and touch' section covering Tab behaviour, readline keys, Ctrl+R, the Esc-then-Tab focus escape, the dock and chips. |

## External services

- No network access on the keystroke path. Completion, ghost text and chips are synchronous and local, so the slow proxies (allorigins measured at more than 10 s) can never stall typing.
- Virtual file system: virtualFileSystem and currentPath (src/utils/virtualFileSystem.ts:469-472), read through completionEnv.fs, using own keys only. The seed has 76 entries with no special characters, so the escaping rules are latent but tested against fixtures.
- themes.json: 10 theme names, plus background as a chip swatch and cursorColor for --theme-cursor.
- cathodeModeInfo (src/stores/cathode.ts:14-19): modes and summaries, with 'off' excluded after 'set'.
- commandHistory (src/stores/history.ts:17): history ghost, Up/Down filtered by prefix, Ctrl+R, and recent argument values. Session-only unless the owner approves persistence.
- The registry built from specs.ts, plus Object.keys(commands) (src/utils/commands.ts:458-465) for the coverage test.
- Static examples kept in specs.ts. weather examples must resolve with whatever the weather workstream ships, since Open-Meteo returns nothing for Gadigal or Aotearoa. Stock tickers are AAPL, TEAM, GOOGL and MSFT plus history values.
- Browser APIs:
- KeyboardEvent key, code, isComposing and keyCode (229 for IME and Android soft keyboards).
- beforeinput inputType (insertFromPaste, insertLineBreak) and CompositionEvent.
- document selectionchange, window.getSelection(), HTMLInputElement.setSelectionRange and setRangeText, document.execCommand('insertText').
- visualViewport resize and scroll events.
- matchMedia('(pointer: coarse)') and matchMedia('(prefers-reduced-motion: reduce)').
- CSS 100dvh and env(safe-area-inset-bottom).
- navigator.userAgentData.platform, falling back to navigator.platform, for Mac detection.
- navigator.userAgent, only to detect the Instagram and Facebook in-app browsers.
- Dev-only npm packages: vitest ^2.1, fast-check, jsdom, @playwright/test. Nothing new ships in the bundle. Budget: no more than +10 kB raw and +4 kB gzip over 142.85 kB / 48.7 kB.

## Steps

1. PR1, core and tooling (1.5 d, no visible change).
- Add vitest ^2.1, fast-check and jsdom, plus vitest.config.ts and the 'test' script. Run npm test before the build in both Firebase workflows.
- Write src/shell/lexer.ts, quote.ts, spec.ts and specs.ts (26 commands; rm declares only -r/--recursive) and the fixture env.
- Resolves F021: resolvePath normalises '..' for the '~/' and '/' branches (virtualFileSystem.ts:492-499).
- Resolves F031 for completion: Map-backed createRegistry.
- Write parity tests first, encoding today's Tab branches (Input.svelte:381-613) and suggestion rows (commandSuggestions.ts:38-234) as golden cases. Intended differences are asserted explicitly: trailing space after a unique match, no rm -f, no 'nano' (Input.svelte:389).
- Check: svelte-check still reports exactly the 2 known errors in theme.ts.
2. PR2, engine swap (1.5 d).
- Add complete/{context,match,sources,engine,tab,ghost,chips}.ts and src/ui/prompt/completionEnv.ts.
- In Input.svelte, replace getCompletions (51-110) and the Tab ladder (381-613) with pressTab(), including the phases and the bell.
- CommandSuggestionsRow renders engine candidates as text nodes instead of {@html} (CommandSuggestionsRow.svelte:55-62).
- Delete src/utils/commandSuggestions.ts.
- Resolves F022 and F017 (rm -f, commandSuggestions.ts:145-160), and the suggestion-row part of F004.
3. PR3, chips (1 d).
- Add CompletionRow.svelte and Chip.svelte: <button> chips, role=listbox/option, kind colours from CSS variables, theme swatches, a compact strip, a grid when listed, the highlight in menu mode, '+N more', pointerdown preventDefault, and 44px targets on coarse pointers.
- Delete CommandSuggestionsRow.svelte and its createEventDispatcher events.
- In theme.ts add --theme-cursor, --theme-ghost and --theme-selection. Chips use them instead of bright-black (CommandSuggestionsRow.svelte:68).
- Resolves F067. Partially resolves F068 for suggestions and F075 (theme chips).
4. PR4, controller and mirrored line (2 d).
- Add promptController.svelte.ts, runLine.ts, LineEditor.svelte and PromptLine.svelte, and replace Input.svelte. The old component stays reachable at ?prompt=legacy for one release.
- Add the --term-font token to app.css and use it in the mirror, the input and History.svelte:28 (today the input uses 'monospace' at Input.svelte:673).
- Add the block cursor, ghost text (with tap to accept) and the scaled 16px input on coarse pointers.
- Move keydown to the input. Delete the window onkeydown (Input.svelte:652) and the duplicate listener (145-151).
- Resolves F012: the input is never disabled and type-ahead works. Deletes displayValue (39-48), input.disabled (304-306, 353-356, 667-668) and the invalid input:readonly rule (701).
- Resolves F014: selection-aware Ctrl+C that prints ^C.
- Resolves F011: focusPolicy.
- Resolves F045: one AbortController per run, and the allowlists at Input.svelte:207-209 and 295-297 are deleted.
- Resolves the UI half of F047 (promise race, Esc alias, Stop) and partially F013 (label, elapsed time, stop hint).
- Resolves the input part of F094: aria-label, role=combobox, aria-expanded, aria-controls and aria-activedescendant, plus enterkeyhint=go.
5. PR5, readline and history (1 d).
- Add readline.ts, keymap.ts (BINDINGS, plus 'help keys'), historyStore.ts and normalize.ts.
- Reverse-i-search lives in PromptLine. Add the Esc-then-Tab focus escape.
- Resolves F046: Ctrl+R no longer reloads; Ctrl+U/K/A/E/D/W work; ^C is echoed; Up keeps the draft.
- Resolves F025: remove the dead display-history serialisation and removal (history.ts:6-7, 22-28).
- Persist commandHistory only if the owner approves, through the safe storage helper. This covers F001 for this store.
6. PR6, phone dock (1.5 d).
- Add viewport.svelte.ts, PromptDock.svelte and the column layout in App.svelte. The dock is a sibling of <main> because of the vintage filter (app.css:130-132).
- Add the stickToBottom action, replacing App.svelte:17-56 and Input.svelte:159-189. Resolves F010.
- Starter chips on an empty touch line; did-you-mean chip; Stop and Cancel chips.
- With the mobile workstream, change index.html: viewport meta (drop maximum-scale and user-scalable at line 6; add viewport-fit=cover and interactive-widget=resizes-content) and size #app with 100dvh/--vvh instead of h-screen (line 13). This resolves F076 and F077 for the prompt.
7. PR7, real cwd and argv bridge (1 d).
- Resolves F023 and the h1 part of F094: Ps1 takes cwd, live and compact props, uses <span> instead of <h1> (Ps1.svelte:4, 10, 14); Command gains cwd; History passes it (History.svelte:11); the controller syncs cwd from currentPath after each run.
- First slice of F039: processCommand uses argvFromLine (commands.ts:319), so quoted or escaped paths that completion inserts actually run.
- Delete the allowlist at commands.ts:343 (finishes F045).
- Regression tests cover echo redirects (fileSystem.ts:380-405), weather and curl.
8. PR8, end-to-end tests, device pass and clean-up (1 d).
- Playwright smoke suite.
- Manual device matrix on the Firebase PR preview, opened from an Instagram DM link on iOS and Android.
- Remove ?prompt=legacy and Input.svelte.
- README 'Keyboard and touch' section.
- Check bundle and performance budgets.

## Testing

UNIT TESTS (vitest, node environment, about 160 cases, under 2 s). Every src/shell module is pure and runs against fixtures.ts, so no window-dependent module is imported.

1. lexer:
- quotes, escapes, every operator with and without spaces ('a>>b', 'x|y', '2>&1');
- unterminated quotes and a dangling backslash, which must give complete=false and must not throw;
- comments;
- spans round-trip: line.slice(start, end) === raw;
- golden: 'echo "a \"b\" c" 'd e' f\ g>>out' gives [echo] [a "b" c] [d e] [f g] [>>] [out].

2. Property tests (fast-check):
- For 2,000 random names over [a-z space ' " \ $ * ~ | > ;], in no-quote, single-quote and double-quote contexts, lexing the line after accept() yields a last word whose value equals the candidate.
- complete() never throws for any string and cursor position.
- The common prefix is a prefix of every candidate.

3. Completion and insertion table:

| Input | Result |
|---|---|
| ca | cat |
| c | [cat, cathode, cd, clear, curl] listed |
| cd ~/doc | cd ~/documents/ (no '\~') |
| cat ~/.s | ~/.ssh/ (the fixture puts dotfiles in home) |
| cd ../../e | ../../etc/ |
| cat documents/l | cat documents/linux.txt |
| cat "my | cat "my notes.txt" |
| cat my | cat my\ notes.txt |
| cat it | it\'s.txt |
| cat Documents/my | per-segment case fold |
| echo hi > doc and echo hi >doc | path completion |
| ls \| ca | command completion |
| ls - | -a, --all, -h, --help |
| ls -a - | -a is not offered again |
| theme set SW | swamphen |
| cathode set o | no match |
| sudo theme set k | kangaroo, kookaburra |
| help ca | cat, cathode |
| cd docu ls, cursor at 7 | the tail ' ls' is kept |
| theme | next = [ls, set] |
| constructor | no spec found, no throw |

4. tab.ts sequences:
- extend, then listed, then menu 0, menu 1, then Shift+Tab back to menu 0, then Esc restores the anchor;
- Enter in the menu accepts without submitting;
- a unique accept followed by Tab descends a level;
- zero candidates rings the bell;
- Tab on an empty line lists all commands.

5. Chip parity: for every row of table 3, chip i produces the same line as menu-selecting i and pressing Enter.

6. ghost: a history ghost beats a completion ghost; the placeholder cannot be accepted; no ghost with the cursor mid-line.

7. readline, history and reverse search:
- Ctrl+W versus Alt+Backspace boundaries on 'cd /home/user/docs';
- consecutive kills concatenate, then yank;
- prefix navigation skips duplicates, and Down restores the draft;
- reverse search older, newer, failed and cancel;
- persistence survives a SafeStorage that throws.

8. keymap:
- Mac Option+B (key '∫', code KeyB) moves a word left;
- isComposing and keyCode 229 give native;
- Ctrl+C with a selection gives native;
- on Windows, Ctrl+W gives native;
- Meta+C gives native;
- Right accepts the ghost only at the end of the line.

9. normalize: curly quotes become straight, '—all' becomes '--all', '$ ls -la\n' becomes 'ls -la' and is not submitted, 'a\r\nb' becomes 'a; b'.

10. Registry:
- validate() returns [];
- specs match Object.keys(commands) exactly;
- every example lexes and completes to a valid slot;
- a test asserts no key overlap between the spread command objects, which flags reset at commands.ts:116 and fileSystem.ts:479.

11. Architecture: no file under src/shell imports svelte, ../stores or ../utils, or references window, document or localStorage.

12. Benchmark: complete() p95 under 1 ms on the fixture with 200 commands.

CONTROLLER TESTS (vitest with jsdom)
- Input events update text, ghost and chips.
- Tab writes the right value and selection.
- choose() keeps document.activeElement on the input.
- Busy mode never sets disabled and keeps type-ahead.
- interrupt() aborts the fake run's signal and resolves immediately, and late output is dropped.
- compositionstart, then input, then compositionend causes no DOM write mid-composition.
- Secret mode never renders the value.

END TO END (Playwright against vite preview; desktop Chromium and WebKit, iPhone 13, Pixel 7)
- Tab nesting through 'cd d', Tab, Tab.
- 'c' then Tab, Tab shows the grid and then cycles.
- Typing 'the' then pressing Right accepts the history ghost.
- Prefix Up, and Ctrl+R.
- Select banner text and press Control+C: nothing is added to history.
- Clicking output leaves scrollTop unchanged.
- With a route stubbed to delay 20 s, Ctrl+C returns the prompt within 100 ms.
- Phone at 375x812:
  - getComputedStyle(input).fontSize is 16px or more;
  - every dock button is at least 44x44;
  - tapping a chip leaves activeElement on the input;
  - after Enter, activeElement is still the input;
  - tapping a starter runs it and does not focus the input;
  - scrollWidth is no wider than innerWidth with a 200-character line and with the grid open;
  - the dock's bounding box stays inside visualViewport after a simulated resize;
  - Ps1 shows ~/documents after 'cd documents'.
- Alignment: for lines of 1, 40 and 120 characters, the cursor span's x matches the input caret, measured on an off-screen 16px clone multiplied by the scale, within 1 px.

MANUAL DEVICE MATRIX (in-app browsers cannot be automated)
- iPhone on iOS 17 and 18: Safari, and Instagram opened from the profile link or a DM.
- Android 14: Chrome with Gboard and with Samsung Keyboard, and the Instagram WebView.
- iPad with a hardware keyboard.
- macOS Safari, Chrome and Firefox.
- Windows Chrome: Ctrl+W limitation, Alt+Backspace, Ctrl+C copy.
- A Japanese IME.
- Reduced motion.
- VoiceOver on iOS.

On every phone check: no zoom; the keyboard stays open across commands; the dock sits on the keyboard; long-press copy of output works; dictation works; with cathode set vintage the dock still rides the keyboard and the mirror has no doubled glyphs.

GATES ON EVERY PR
- npm test in both Firebase workflows.
- svelte-check shows exactly the 2 known theme.ts errors, or fewer if the UI workstream fixes them.
- Build stays within +10 kB raw / +4 kB gzip.

## Risks

- The mirror and input can misalign: subpixel rounding with the scale trick, a fallback font before the web font loads, or Windows font hinting.
- Mitigation: one --term-font token, --input-scale measured at runtime, re-measuring on resize and on document.fonts.ready, the Playwright alignment test, and text-shadow:none on the input.
- Last resort: if drift exceeds half a character, show the native input text and hide the mirror text; the block cursor is lost but nothing else.
- On Chromium for macOS I measured 0.000 px drift over 120 glyphs; Windows ClearType has not been verified.
- iOS WKWebView opens the keyboard only when focus() is called synchronously inside a user gesture.
- Any future code that disables the input, or focuses it from setTimeout or requestAnimationFrame, brings the closing-keyboard bug back.
- Mitigation: controller invariants plus an end-to-end assertion that activeElement is still the input after Enter. Chip pointerdown calls preventDefault, with a synchronous refocus in the click handler as the fallback.
- Android IME composition: Gboard and Samsung treat whole words as compositions, and keydown arrives as keyCode 229 / 'Unidentified'.
- Readline keys only work with hardware keyboards; phones rely on the dock's Tab and up buttons, chips and ghost tap.
- DOM writes are deferred until compositionend, except an explicit chip tap, which commits the composition.
- Browser-reserved shortcuts: Ctrl+W, Ctrl+T and Ctrl+N cannot be intercepted on Windows and Linux.
- Capturing Ctrl+R, L, D, U and K while the prompt is focused overrides browser shortcuts, and Ctrl+A no longer selects all inside the field.
- Mitigation: these keys are captured only while the input is focused; Mac-only bindings where needed; alternatives documented in 'help keys'.
- Capturing Tab creates a keyboard trap (WCAG 2.1.2).
- Mitigation: Esc then Tab within 1 s moves focus out; this is announced through aria-describedby and listed in 'help keys'.
- The argv bridge changes execution slightly:
- quotes are stripped before commands see them;
- backslash escapes apply;
- unterminated quotes print bash's EOF error.
Mitigation: regression tests for echo redirects (fileSystem.ts:380-405), weather and curl. The shell workstream must consume this lexer rather than its scratchpad copy (shellproto/lexer.ts throws on incomplete input).
- Instagram's visualViewport quirks: offsetTop jumps when the iOS toolbar changes, and Android WebView may ignore interactive-widget.
- Mitigation: the dock is in normal flow inside a column sized from --vvh with a 100dvh fallback, so it stays usable even if the height is wrong.
- Cathode effects: html.crt-vintage sets filter on main (app.css:130-132), which captures position:fixed descendants. The dock must therefore stay outside main; a test guards this.
- The phosphor and vintage text-shadows must not be applied to the transparent input; text-shadow:none is set explicitly.
- Programmatic edits through execCommand('insertText') rely on a deprecated, though universally supported, API.
- If it is unavailable, setRangeText is used, and Cmd+Z may then skip completion edits.
- Specs live apart from command implementations until the arrangement workstream co-locates them, so they can drift.
- Mitigation: the coverage and example smoke tests, plus a dev-build warning in completionEnv.
- Product risk:
- Starter chips that run commands must not include flaky network commands until the weather and stock workstreams land (allorigins took more than 10 s; Gadigal is unresolvable on Open-Meteo).
- The desktop chip row is the same noise level as today's Suggestions row, which some visitors may find un-terminal-like.
- Cross-workstream dependencies:
- the stores read localStorage at import time without try/catch (theme.ts:86, theme.ts:100, cathode.ts:56; history.ts:6-7 until PR5), so a webview that blocks storage blanks the page before the prompt renders (F001, robustness workstream);
- the VFS workstream must keep completionEnv.fs.list and the cwd hook;
- the mobile workstream owns the viewport meta and #app sizing.

## Effort

About 10.5 engineer-days (range 9-13, depending on how many fixes real phone keyboards need), in 8 PRs that each deploy on their own:

| PR | Scope | Days |
|---|---|---|
| PR1 | Core and tooling | 1.5 |
| PR2 | Engine swap | 1.5 |
| PR3 | Chips | 1 |
| PR4 | Controller and mirror | 2 |
| PR5 | Readline and history | 1 |
| PR6 | Phone dock | 1.5 |
| PR7 | cwd and argv bridge | 1 |
| PR8 | End-to-end tests and device pass | 1 |

Two ship points:
- After PR3 (about 4 days): correct Tab everywhere and tappable chips on the existing input, which fixes the 375 px tap problem and the duplicated logic.
- After PR6 (about 8.5 days): the Instagram-ready experience.

Code size: about 950 lines are removed (Input.svelte, commandSuggestions.ts, CommandSuggestionsRow.svelte, the App.svelte scroll code). About 1,500 lines of production code and about 900 lines of tests are added.

## Trade-offs

- Native input under a mirror, rather than a hidden sink with a fully drawn line (design 2). IME, autocorrect, dictation, selection handles, type=password and accessibility all stay native. The cost is that long lines scroll horizontally instead of wrapping. A wrapping textarea (design 3) can replace LineEditor later if the alignment test holds on real devices.
- Hybrid Tab: extend first, list immediately when nothing can extend, cycle on the next Tab. This is friendlier than strict bash (bell, then list) and avoids design 1's wasted second press. The list is temporary and never written to scrollback.
- Chips stay visible on desktop, as today's Suggestions row is, but are subtle and inline. On phones they move to the dock above the keyboard. Starter chips run in one tap; completion chips only fill in the line, and a run glyph shows the difference.
- Busy mode accepts type-ahead instead of blocking keys. It is more authentic and keeps IME stable, at the cost of text the user cannot see until the prompt returns.
- Interrupt resolves the UI immediately and drops late output, so the prompt can never be held hostage by a provider that ignores the abort signal. A command that keeps working in the background may still have side effects; network calls only.
- Readline is captured only while the prompt is focused. Ctrl+W and Ctrl+P are Mac-only, and Alt+Backspace and Ctrl+Backspace work everywhere: browser conventions win over full readline parity on Windows and Linux.
- Case-insensitive matching is a fallback, not the default, and there is no fuzzy matching. Tab stays predictable, and phone auto-capitalisation is still handled.
- One lexer is shared with execution now, through the argv bridge, instead of completion-only tokenising. Quoted completions run, and the shell workstream inherits rather than duplicates it, at the cost of small behaviour changes in echo quoting.
- Specs stay a separate registry for now rather than being co-located with run(). Fewer files change in this workstream; drift is guarded by tests until the arrangement workstream merges them through defineCommand.
- No live theme preview while cycling (design 3). It would persist through theme.subscribe writing localStorage (theme.ts:99-100); it can be added later through a non-persisting preview path.
- No web font in this workstream. The --term-font token removes today's Courier-versus-SF Mono mismatch on iOS (Input.svelte:673 versus index.html:12); loading Cascadia is left to the UI workstream.
- Tooling grows to vitest, fast-check, jsdom and Playwright, as dev-only dependencies, because alignment and focus regressions on phones are the most likely failures and need end-to-end coverage.

## Open questions raised by this design

- Should command history be kept across reloads (local only, capped at 500, with 'history -c')? That would make ghost text and Up useful for returning visitors. Today history.ts:5-7 and the 'history' help text in helpTexts.ts:7 deliberately reset it on every reload.
- Which starter chips should a first-time phone visitor see on an empty line, and should they run in one tap? The proposed default is help, fastfetch, cat README.md, theme ls and cathode ls. Should weather and stock wait until their new backends are reliable?
- Prompt hostname: keep 'www.vesen.app' (Ps1.svelte:3 uses window.location.hostname) or show a short 'vesen'? Should the cwd be abbreviated (~/p/vesen) on screens under 480px?
- Desktop suggestion chips: always visible while typing, as today's Suggestions row is, or shown only after Tab, which is more terminal-pure? Should there be a setting to turn them off?
- On Windows and Linux, is it acceptable that Ctrl+A, U, K, D, R and L act as readline keys while the prompt is focused, overriding the browser's select-all, view-source, bookmark, reload and address-bar shortcuts? The alternative is binding them on macOS only.
- Long commands: keep horizontal scrolling inside the prompt (lower risk), or invest about 1.5 more days in a wrapping prompt that continues under PS1, like a real terminal?
- The sudo 'password' prompt currently opens a YouTube rickroll with window.open (Input.svelte:248), which Instagram's in-app browser may block. Should it fall back to printing a link, or should the joke change?
- Can pinch-zoom be re-enabled (removing maximum-scale=1 and user-scalable=no from index.html:6) once the input is 16px? This is an accessibility gain (F077), but it changes how the site feels on phones.
- Do you want a Termux-style extra-keys row on phones (Tab, arrows, ^C, /, |, ~, -), or only the minimal dock ([Tab], [up], chips, Run/Stop)?
- Do you agree that the shell workstream and this one share a single lexer (src/shell/lexer.ts), and who should own changes to it?
