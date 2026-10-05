# Phone and Instagram experience

**Goal:** someone who taps the link in the Instagram bio sees a sharp, correctly sized terminal within a moment, can explore it by tapping alone, and can type without the keyboard hiding the prompt.

**Reference design:** [designs/phone-and-instagram.md](designs/phone-and-instagram.md). The shared decisions in [02-architecture-and-contracts.md](02-architecture-and-contracts.md) override it where they differ. What the Instagram in-app browser allows is summarised in [appendix-b-services-and-instagram.md](appendix-b-services-and-instagram.md).

## What is wrong today

- `#app` is sized with `100vh` (`index.html:13`). With iOS and Android toolbars showing, the bottom of the terminal sits under them, and the soft keyboard covers the suggestion row (F076).
- The viewport meta disables pinch zoom (`index.html:6`) to hide the fact that the 12 px input makes iOS zoom on focus, while output renders at 11.2 px (F077).
- The input is disabled while a command runs, so the keyboard closes after every command (F012).
- Every tap anywhere refocuses the input, so the keyboard keeps popping back up while someone reads (F011).
- Tab, Up, Ctrl+C and Ctrl+L exist only as keyboard shortcuts. A phone visitor cannot complete, recall or cancel anything (F067, F047).
- `whoami`, `repo`, `email` and the sudo joke call `window.open` or `mailto:`, which Instagram blocks, while printing "Opening…" (F051).
- The link has no preview card, no theme colour, no touch icon and no manifest (F064).
- The CRT scanline effect is on by default for every visitor, including phones, and animates forever (F079).

## The first impression, step by step

1. **Before any script runs**, a small inline boot script paints the theme background and `theme-color`, so there is no white flash.
2. **The banner** is drawn in the self-hosted font, scaled to fit the width, with no wrapping or sideways scrolling at 320-430 px. Under it are the line "a terminal by Has Salvesen" and two tappable commands, `help` and `cat README.md`.
3. **The prompt** reads `guest@vesen:~$`. The keyboard is not open.
4. **With the keyboard closed, the dock shows** a row of starter chips that run in one tap, such as `help`, `cat README.md`, `fastfetch`, `ls`, `theme ls` and `cathode ls`. Network commands join once their new backends are proven. Below the chips is a bar reading "Type a command…".
5. **After a command runs,** its follow-up chips appear. After `theme ls`, for example, every theme becomes a chip.
6. **When the visitor types,** the app shrinks to the visible area. The prompt, chip row and key bar sit directly above the keyboard, and the keyboard stays open between commands.
7. **While a command runs,** the chips collapse into one large Stop chip, and the status line shows what is happening and for how long.

## Inside Instagram's browser

- **Links:** nothing navigates without a tap. Openers print a card with the link and a Copy button. Tapping a link opens it in the same view, and pressing Back restores the scrollback, the line and the current folder from a session snapshot.
- **Email:** `email` offers "Open mail app" (a real `mailto:` link) and "Copy address".
- **QR codes:** `qr` shows a full-screen Present mode with a long-press-to-save image, because the visitor cannot scan their own screen.
- **Open in Safari or Chrome:** only actions that need the real browser show a one-line hint ("••• → Open in browser") and an escape chip. There is no up-front banner.
- **Power off:** `poweroff` shows a "vesen is off" screen with a Power on button. It never leaves the visitor on a dead page.

## Decisions that change the reference design

| Topic | Reference design | This plan |
|---|---|---|
| Completion | `legacyCompletion.ts` behind a provider | The shared engine from [03-terminal-input.md](03-terminal-input.md); no interim copy |
| Escaping helpers | Its own `render/html.ts` | The output model's blocks and component blocks |
| Run lifecycle | `TerminalController` state | The shell `Session` job store, with the controller as a thin UI adapter |
| Backstop timeout | 20 s for every cancellable command | Per-spec `budgetMs` (default 15 s, weather 25 s, stock 10 s) |
| Storage keys | `vesen.theme.v1` | `vesen:theme:v1` from the shared registry |
| README content | Unwrap lines in `public/README.md` | Convert to `{colour}` markup in `src/content/`, as the shell design does |

## Work sequence

| Slice | Phase | Days | Delivers | Resolves |
|---|---|---|---|---|
| Device capability probe | 0 | 0.5 + owner | A throwaway page on a preview channel that logs everything this plan assumes about Instagram's browser (see below) | Removes the biggest unknown |
| Boot safety, head and hosting | 1 | 1 | Safe storage, theme stored by name, head side effects moved out of stores, Open Graph and Twitter tags, icons, manifest, pre-paint script, 404 page | F001, F002, F063, F064 |
| Zoom, input and type | 1 | 1 | Viewport meta without the zoom lock, scaled 16 px input, input never disabled, prompt as a `<span>` with the short host, the self-hosted font | F077, F012, F061 |
| App shell, viewport, focus and scroll | 1 | 1.5 | Fixed shell sized from `visualViewport`, safe areas, one stick-to-bottom rule with a "new output" pill, touch-aware focus, CRT overlay inside the screen | F076, F010, F011 |
| Dock, chips and key bar | 3 | 2 | ChipRow, KeyBar (full, compact and minimal modes), history sheet, hardware-keyboard detection with `keys on, off or auto` | F067 |
| Links, in-app policy, power off and session | 3 | 1 | `planOpen()`, link cards, `open --external`, the Shutdown screen, the Back-navigation snapshot | F051, F029, F049 |
| Output reflow | 3 | 1 | Help, ls and history as CSS grids; banner and art scaled to fit; container queries for side-by-side layouts | F015, F016, F074 |
| CRT tiers, bell and data-cost prompts | 1 | in visual workstream | Lite CRT on touch and constrained devices, visual bell on touch, confirm before a 40 MB speed test on mobile data | F079, F028 |
| Device QA | each milestone | 1.5 total | The checklist below, run from an Instagram DM on both phones | |

## The device capability probe

Deploy a throwaway page to a Firebase preview channel and open it from an Instagram DM on an iPhone and an Android phone. It records:

- the user agent;
- `visualViewport` and `innerHeight` before and after the input gets focus, and whether `interactive-widget=resizes-content` is honoured;
- what happens with `window.open`, `target=_blank` and `mailto:`;
- clipboard write, `navigator.share`, `canShare({ files })`, and long-press save of a `data:` PNG;
- a geolocation prompt with a timer;
- a `localStorage` write that is read back after closing and reopening Instagram;
- `AbortSignal.any` and `AbortSignal.timeout`;
- `CSS.supports` for container queries, `dvh`, `lh` and `color-mix`;
- whether the `instagram://extbrowser/` and `intent://` escapes work from a tap.

Record the results in `docs/plan/device-probe-results.md` before Phase 3 starts. Several later choices depend on them: the touch editor, persistence, link handling and QR saving.

## Device QA checklist (each milestone)

Run on iOS Safari, iOS Instagram, Android Chrome and Android Instagram.

- [ ] No white flash. The banner fits at 320, 375 and 414 px, with no sideways scroll on the page.
- [ ] Tapping the prompt does not zoom, and pinch zoom works.
- [ ] The keyboard stays open across three commands, and the prompt stays above it.
- [ ] Chips run and insert without closing the keyboard. The Stop chip cancels a slow command.
- [ ] Rotation reflows `help`, `ls` and `fastfetch` without re-running them.
- [ ] `whoami`, `email` and `repo` show cards. Tapping a link and pressing Back restores the terminal.
- [ ] `qr vesen.app` opens Present mode, and the image can be saved or screenshotted.
- [ ] Reduced motion stops the CRT animation and the cursor blink.

## Questions for the owner

- **CRT on phones:** should the default inside Instagram and on phones be lite (static scanlines and vignette), off, or the full animated effect?
- **Text size:** should phone text be 13 px (fits the 44-column banner) or 14 px (easier to read)?
- **Starter chips:** which commands should a first-time phone visitor see, in what order, and should they run in one tap?
- **Desktop auto-open:** should `whoami` and `sudo` keep auto-opening a tab on desktop? On phones they would only print a tappable link.
- **Branding:** confirm the link preview title and description, and the home-screen name ("Vesen" or "Vesen Terminal").
- **Test devices:** which iPhone and Android phone can you test on, from an Instagram DM to yourself?
