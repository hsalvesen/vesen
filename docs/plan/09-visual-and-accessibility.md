# Visual system and accessibility

**Goal:** one coherent look across every command and all ten themes, readable text everywhere, a deliberate first impression on a phone, and an interface that works with a screen reader, a keyboard alone, zoom and reduced motion.

None of the six design panels owned this work. Each assumed "the UI workstream" would do it and invented its own colour variables in the meantime. This workstream exists to stop that, and it lands before the weather, stock and QR renderers so they can use its tokens. The relevant findings are in [01-audit.md](01-audit.md) under Visual design and Accessibility.

## What is wrong today

- **Contrast fails.** Suggestions use `brightBlack`, which falls below 4.5:1 on seven of ten themes and as low as 1.6:1. Cockatoo, the only light theme, renders body text in `white` at 2.5:1. The default theme's `yellow` slot is a red, so the prompt user, errors and labels share one hue (F068).
- **Old output keeps old colours.** Eighteen places bake the current theme's hex values into output, so after `theme set` earlier output keeps the old palette. Two DOM-patching functions cover only some cases (F009, F030).
- **The font is never loaded.** A 649 kB Cascadia Code file ships, but nothing loads it. Prompt, input and output use three different font stacks, and iOS falls back to Courier, which misaligns box-drawing art (F061).
- **Spacing is inconsistent.** There are seven different line heights, and block art shows seams at desktop sizes (F096).
- **The CRT effect is unconditional.** Scanlines, a 45% vignette and an endless sweep animation are on by default for everyone, including phones. The phosphor and vintage flicker runs at about 23 changes a second, which sits in the photosensitivity risk band (F079).
- **No designed cursor or focus state.** The theme's `cursorColor` is never used (F073).
- **Five different error styles**, and help panels that differ from bare usage text (F087, F043).
- **The scrollbar** is a fixed light-grey 20 px WebKit bar on every theme (F078).
- **Icons.** Ten 134 kB favicons are re-downloaded on each theme switch. There is no link preview image, touch icon or manifest (F063, F064).
- **Screen readers.** The input has no accessible name, output is never announced, every prompt is an `<h1>`, and ASCII art is read out glyph by glyph (F094). Pinch zoom is disabled (F077).

## Deliverables

### 1. Role tokens and palette fixes (1 day)

- Add the `--role-*` layer defined in [02-architecture-and-contracts.md](02-architecture-and-contracts.md#10-one-token-namespace). Each theme in `themes.json` gains an optional `roles` map, and missing roles are computed from the palette.
- Fix the failing values. Cockatoo needs a dark `fg-strong`, a darker `muted`, and accents of 4.5:1 or better on `#e8ddd0`. Swamphen needs a true warm role for `warn` and `sun`, so errors stop sharing a hue with the prompt.
- Add `scripts/check-contrast.mjs` to CI. It fails if any role used for text drops below 4.5:1, or 3:1 for large or bold text, on any theme.
- Replace every inline `get(theme)` hex in command output with role or palette variables. Delete the DOM-patching helpers in favour of the live-binding spans in the output model.

### 2. Type and rhythm (0.5 day)

- Subset Cascadia Code to Latin, box drawing, block elements, arrows and braille (about 40-80 kB as WOFF2). Because "Cascadia Code" is a reserved font name, ship the subset as **Vesen Mono**, with `OFL.txt` alongside it. Preload it with `font-display: swap` and a `ui-monospace, Menlo, Consolas, monospace` fallback.
- Define one `--term-font`, one `--term-fs` (13 or 14 px on phones, the owner's choice, and 16 px on desktop), and one `--term-lh` (1.35).
- Add an `.art` class with `line-height: 1`, no ligatures and no wrapping, for the banner, logos, swatches and charts.
- Remove all 17 inline `font-family: monospace` overrides.

### 3. CRT tiers and defaults (0.5 day)

| Tier | When | What it shows |
|---|---|---|
| full | Desktop with a fine pointer, not reduced motion | Today's modes |
| lite | Phones, in-app browsers, Save-Data, low memory | One static vignette and a 3 px scanline gradient snapped to device pixels. No filter, no sweep, a capped text shadow |
| off | Reduced motion, increased contrast, forced colours | Nothing |

Other changes:

- Animations pause when the page is hidden.
- The flicker slows to 3 changes a second or fewer with a smaller amplitude.
- Glow and filter move off the scrolling container.
- `cathode quality auto|full|lite|off` overrides the tier, and `cathode ls` shows the tier and the reason it was chosen.

### 4. Components (1 day)

- **Cursor:** a block in `--role-cursor`. It is hollow when unfocused, steady for 600 ms after a keystroke, and does not blink under reduced motion.
- **Chips:** `--role-chip-fg` on a tinted `--role-chip-bg` with a 1 px border. On touch they are at least 44 px tall. The selected chip is outlined.
- **Errors:** one style, `cmd: message` in `--role-error`, optionally followed by a dim hint line. The bell flashes visually on touch.
- **Panels:** one callout style (4 px left border, 12% tint), used for help, notices and cancellations.
- **Help:**
  - grouped `name  description` rows;
  - `--help` and `man` share NAME, SYNOPSIS, OPTIONS and EXAMPLES headings;
  - examples become run chips.
- **`theme ls`:** one row per theme, with eight swatches drawn in that theme's own colours and a marker for the current theme.
- **Banner:** the logo as `.art`, then "vesen v2.0.0 · a terminal by Has Salvesen", then a line of keys ("Tab completes · ↑ history · help <cmd>"). A narrower logo is used below 480 px.
- **Scrollbar:** `scrollbar-width: thin` in `--role-muted`. The WebKit rules are dropped on touch.

### 5. Icons, link preview and screenshots (0.5 day)

- One SVG favicon per theme (about 400 bytes each), with only the SVG `href` swapped on theme change. Add a 32 px PNG fallback, a 180 px `apple-touch-icon` and a manifest.
- A 1200×630 `og.png` of the banner on the swamphen background.
- Regenerate `docs/themes` screenshots and `themes.gif` from the new look with a Playwright script, so they never drift again.

### 6. Accessibility acceptance checklist (0.5 day, then once per milestone)

- [ ] The input has `aria-label="Terminal command"`, `enterkeyhint="go"`, and combobox semantics pointing at the chip listbox.
- [ ] The transcript is `role="log"` with `aria-live="polite"`, and `aria-busy` is set while a command runs.
- [ ] Output longer than about 20 lines announces a one-line summary ("help: 42 commands listed") instead of every line.
- [ ] Prompts are `<span>`s, and the page has one visually hidden `<h1>`.
- [ ] Art, QR codes and swatches are `aria-hidden`, with screen-reader-only text alternatives.
- [ ] Pinch zoom works, and no input is smaller than 16 px on touch.
- [ ] Escape then Tab leaves the terminal, so there is no keyboard trap.
- [ ] Every text role reaches 4.5:1, or 3:1 for large text, on every theme; the contrast script enforces this.
- [ ] Reduced motion, increased contrast, forced colours and reduced transparency are honoured.
- [ ] VoiceOver on iOS and TalkBack on Android can run `help`, hear the result, tap a chip and cancel a command.

## Work sequence

All of this lands in Phase 1, in parallel with the safety work: about 4 days, plus about half a day of screen-reader QA at each later milestone.

## Questions for the owner

- **CRT defaults:** is the lite tier on phones right, or should phones get the full effect or none? On desktop, should scanlines stay on by default?
- **Font:** may vesen ship a subset of Cascadia Code renamed "Vesen Mono", with its licence file?
- **Palettes:** may the cockatoo and swamphen colours change enough to pass contrast? The themes keep their names and overall character.
- **Phone text size:** 13 px or 14 px?
