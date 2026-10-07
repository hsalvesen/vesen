# [Vesen Terminal](https://www.vesen.app)

> A modern, web-based terminal emulator built with SVELTE.

![banner](/docs/themes/banner.gif)
## Overview

Vesen Terminal is a fully-featured web-based terminal emulator that replicates a Unix-like environment in the browser. It features a virtual file system, interactive commands, modifiable themes, and a responsive design that works across devices.


## Stack

- **Frontend framework**: [Svelte 5](https://svelte.dev/)
- **Build tool**: [Vite](https://vitejs.dev/)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/)
- **Hosting**: [Firebase Hosting](https://firebase.google.com/docs/hosting)
- **Package manager**: npm (Node.js 22.12+, see `.nvmrc`)

## Quick start

### Local development

**Prerequisites**: Node.js 22.12 or higher (`nvm use` reads `.nvmrc`)

```bash
# Clone the repository
git clone https://github.com/hsalvesen/vesen.git
cd vesen

# Install dependencies
npm install

# Start development server at http://localhost:3000
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Getting started
Type `help` in the terminal to see every command by category, `man <command>` for one command's manual (`man vesen` is about the terminal itself), and `help keys` for the keys. Explore the file system with `ls` and `cd`; `exit` ends the session and offers a new one, and `poweroff` shows a Power on button that starts one with your files kept.

`whoami`, `about` and `contact` say who made vesen, with link cards that have Copy. A desktop browser also opens LinkedIn or the source for `whoami` and `repo`; on phones a link opens only when tapped, and inside Instagram's browser it opens in the same view, so Back brings the terminal back as it was. `privacy` lists every service a command talks to and what it is sent, and `debug report` copies the details a bug report needs.

At the prompt, Tab completes, ↑ and ↓ step through the history lines that start with what is typed, Ctrl+R searches the history, and grey text offers the rest of a past line (→ takes it). While the prompt has focus, the readline keys edit the line: Ctrl+A, E, U, K, Y, L and D everywhere, Ctrl+W, P, N, F, B and T on a Mac, and Alt+B, F, D, Y, . and Backspace. Ctrl+C stops the running command or abandons the line; on Windows and Linux, with text selected, it copies instead (a Mac copies with Cmd+C). Escape then a key is that key with Alt, as in readline (Esc . inserts the last argument), and Escape then Tab leaves the terminal for the rest of the page.

On a phone, a dock rides above the keyboard. Its chips run a starter command in one tap without opening the keyboard, offer what comes next after a command (every theme after `theme ls`), and build a line by tapping: a completion goes on the line as Tab would put it, and one that finishes the line runs it. Holding a chip that runs puts it at the prompt instead. The key bar has tab, ↑, ↓, ^C, clear, ••• for symbols and ⌄ to put the keyboard away; holding ↑ opens a list of past commands. A hardware keyboard hides the key bar; `keys on|off|auto` chooses. Open the page with `?dock=1` to see the dock on a desktop.

## Stock quotes

`stock AAPL` shows a card with the price in the instrument's own currency, the change, the market's phase (open, pre-market, closed and when it opens), a chart and the day and 52-week ranges; `stock AAPL CBA.AX BTC-USD` shows a table, `stock -s commonwealth bank` finds tickers by name, and `stock -r 5d AAPL` changes the chart's range. Chips under a card refresh it or change the range in one tap. Quotes may be delayed, and every card says where its data came from and how old it is. Not investment advice.

The quotes come through vesen's own stock service, a small Cloudflare Worker in [`worker/stock`](worker/stock/README.md) that calls Yahoo Finance (and Cboe for US listings when Yahoo is down). The build finds it through `VITE_STOCK_API`: copy `.env.example` to `.env.local` and set it there, or set the `VITE_STOCK_API` repository variable, which CI passes to the build. Left unset or empty, `stock` uses an interim source, Yahoo's chart through the public `api.allorigins.win` proxy: it is slower, every card it feeds says "via public proxy, may be slow", and `privacy` lists it.

Every request has an 8 s deadline and the whole command 10 s; a quick failure is tried once more, and answers are reused for 30 s. The last good quote of each ticker is kept in this browser (`vesen:stock:v1`, with the recent tickers), and shown marked STALE when live data cannot be reached.

To run your own copy on another domain, deploy your own Worker with your domain in its `ALLOWED_ORIGINS` (see its README) and build with `VITE_STOCK_API` pointing at it. vesen's Worker answers only vesen.app, its preview channels and localhost, so elsewhere `stock` says that live quotes aren't available on that host.

## Themes

![themes](/docs/themes/themes.gif)
View all themes: [Vesen themes](/docs/themes), or run `theme ls` in the terminal to see each one's colours.

The CRT effect (`cathode ls`) shows in full on a desktop, in a lighter static form on phones and in in-app browsers, and not at all when the system asks for reduced motion, more contrast or forced colours. `cathode quality auto|full|lite|off` overrides that choice.

##  Development

### Project structure
```bash
src/
├── main.ts                       # Calls app/bootstrap.ts, then mounts the app, or shows a plain boot error
├── app/bootstrap.ts              # Composition root: host redirect, storage and its migrations, theme and CRT
│                                 # applied to the page, stale-chunk reload, the banner
├── App.svelte                    # The app shell: the screen frame (transcript, prompt, new-output pill,
│                                 # CRT overlay) above the phone dock, which loads in its own chunk
├── app.css                       # Imports the style sheets below
├── styles/                       # tokens.css (Vesen Mono, --term-font, --term-fs, --term-lh),
│                                 # terminal.css (base type, the .art class for banners, logos and charts),
│                                 # shell.css (the fixed shell sized to the visible viewport; phones
│                                 # edge to edge, the desktop framed), components.css (output in role
│                                 # colours: errors, panels, theme ls swatches, the scrollbar) and
│                                 # crt.css (the CRT effect, by tier)
├── constants.ts                  # Repository URL (the prompt's host is in vfs/identity.ts)
├── global.d.ts                   # Build-time globals
├── components/
│   └── Cathode.svelte            # CRT overlay, inside the screen frame
├── interfaces/                   # TypeScript interfaces (command, theme)
├── shell/                        # The DOM-free shell kernel (docs/adr/0001-architecture.md)
│   ├── types.ts                  # CommandSpec, command context, registry, history, TTY, streams, identity
│   ├── lexer-types.ts            # The lexer's result and tokens
│   ├── help.ts                   # help, --help, man, whatis and apropos, all generated from the specs
│   ├── reader.ts                 # A running command reading a line at the prompt (rm -i, sudo's password)
│   ├── complete/                 # Tab completion, the ghost and the chips, from the specs
│   ├── editor/                   # The line editor's pure parts: readline ops and the kill ring, the key
│   │                             # table (keymap.ts), history stepping and reverse-i-search, the `> `
│   │                             # continuation, and straightening typed and pasted text
│   └── keys.ts                   # help keys and man vesen, generated from the key table
├── output/                       # DOM-free output
│   ├── model.ts                  # Spans, blocks, actions, the `out` builders and plain()
│   ├── html-to-text.ts           # Plain text of legacy HTML output, for pipes
│   ├── legacy-policy.ts          # What the legacy HTML shim keeps: tags, attributes, classes, styles
│   └── escape.ts                 # HTML escaping for command output
├── vfs/                          # The virtual file system, DOM-free: vfs.ts (permissions, symlinks,
│                                 # devices, /proc, a 512 KB quota), path.ts, seed.ts (the tree a session
│                                 # starts with: /home/guest, /home/has, /etc, /proc, /dev, /usr/bin),
│                                 # special.ts (/proc and /dev), persist.ts (files under ~ kept across
│                                 # reloads as an overlay on the seed), identity.ts (guest@vesen)
├── content/                      # The owner's styled documents (README, history, linux notes) in {colour}
│                                 # markup, converted once from HTML by scripts/convert-content.mjs
├── commands/                     # One CommandSpec per file, DOM-free, by category: portfolio/ (theme,
│                                 # cathode, banner, whoami, linkedin, about, contact and email, repo, open
│                                 # and xdg-open, qr), files/ (ls, cat, cp, mv, rm, rmdir, mkdir, touch, ln,
│                                 # stat, cd, pwd), text/ (echo, printf), shell/ (help, man, whatis,
│                                 # apropos, history, clear, reset, alias, unalias, export, unset, env,
│                                 # printenv, set, source, type, which, command, true, false, test, exit,
│                                 # login, sleep, sudo), system/ (date, keys, poweroff, reboot, shutdown,
│                                 # privacy, debug, fastfetch), network/ (weather, curl, speedtest, and
│                                 # stock with its card's words in stock/); lib/ is what they share: the
│                                 # banner, the link cards, weather's way to its service, and qr's options
│                                 # and payloads; legacy.ts, the adapter that ran the commands in
│                                 # src/utils until each was ported, goes in the clean-up
├── lib/                          # colour.ts (luminance, contrast, mixing, nudging a colour until it reads)
│                                 # and roles.ts (each theme's --role-* colours, computed from its palette
│                                 # where themes.json does not set them, and the contrast each must meet);
│                                 # qr/ (the QR encoder: segments, error correction, masks, and text, SVG,
│                                 # raster and PNG renderers, and the view a QR card draws); sysfacts.ts and
│                                 # sysnames.ts (reading and naming what a browser says about its system)
├── platform/                     # Browser-facing helpers: env.ts (touch, the in-app browser and the
│                                 # system), errors.ts (recent errors for debug report), canonical host
│                                 # redirect, stale-chunk reload,
│                                 # head.ts (palette colours, theme-color, favicon), theme-apply.ts (the
│                                 # role colours), perf.ts (the CRT tier: full, lite or off, and why),
│                                 # crt.ts (CRT classes), measure.ts (--input-scale for the 16px touch
│                                 # input), viewport.ts (--app-h, --app-top and --kb-h from visualViewport,
│                                 # and the dock's layout for the visible height), geolocation.ts (the
│                                 # device's location for weather --here, on its own timer, rounded to ~1 km)
├── services/
│   ├── net.ts                    # fetch with timeouts, cancelling, byte caps and typed network errors
│   ├── storage.ts                # localStorage and sessionStorage with a memory fallback; one-time migrations
│   ├── types.ts                  # Service interfaces: net, storage, bell, opener, clipboard, clock, system info
│   ├── sysinfo.ts                # System facts for fastfetch, /proc and debug report: the user agent, the GPU,
│   │                             # client hints, battery, storage, and the public IP only when asked
│   ├── opener.ts                 # The in-app link policy: planOpen, the new tab inside the gesture, and the
│   │                             # escape to the real browser behind a tap
│   ├── clipboard.ts              # Copy: the Clipboard API, then execCommand
│   ├── session-snapshot.ts       # The screen saved for Back (vesen:session:v1); session-restore.ts
│   │                             # rebuilds it, loaded only after Back
│   ├── storage-keys.ts           # Every browser storage key, in one registry
│   ├── qr-actions.ts             # Save, Share and Copy for a QR code, black on white, inside the tap
│   ├── weather/                  # Weather's sources (forecast, geocoding, IP location), place resolution,
│   │                             # units and WMO codes, the view model a weather card draws, and the
│   │                             # service the weather command reaches them through (loaded on first use)
│   └── market/                   # stock's data: contract.ts (the Worker's wire format) and normalise.ts
│                                 # (Yahoo's chart as a quote), both shared with the Worker; client.ts
│                                 # (budgets, retry, memory, saved copies); interim.ts (the public proxy
│                                 # until the Worker is deployed); port.ts (how the command reaches it)
├── stores/                       # Svelte stores, pure state: screen (the transcript), term, theme, cathode,
│                                 # prefs (the key bar setting), viewport (the visible height)
├── ui/
│   ├── prompt/                   # The prompt: promptController.svelte.ts (the line, its keys, Tab,
│   │                             # history, search, type-ahead, ^C, reads and secrets), LineEditor.svelte
│   │                             # (a real input; with a mouse, over a mirror with a block cursor and
│   │                             # the ghost) and PromptLine.svelte (PS1, the running line, the status)
│   ├── CompletionRow.svelte      # The chips under the prompt, and Tab's list
│   ├── dock/                     # The phone dock: Dock.svelte (its layouts), ChipRow.svelte, KeyBar.svelte
│   │                             # (keys.ts says what each key does), HistorySheet.svelte, press.ts (tap,
│   │                             # hold, long press and repeat, never taking focus from the prompt)
│   ├── Transcript.svelte         # Each entry: the prompt it was typed at, the line, its output
│   ├── AppHost.svelte            # A command's full-screen app over the terminal: apps/Shutdown.svelte and
│   │                             # apps/QrPresenter.svelte (qr's Present mode)
│   ├── links.ts                  # Where links open and how Copy copies, for the cards and spans
│   ├── Prompt.svelte             # guest@vesen:~/documents$, live under the transcript and as each entry's snapshot
│   ├── OutputView.svelte         # Draws output blocks with text interpolation only
│   ├── SpanView.svelte           # One styled span: link, trusted action button, live theme or CRT marker,
│   │                             # or theme swatches
│   ├── legacy-html.ts            # use:legacyHtml, which rebuilds legacy HTML from the allowlist
│   ├── span-style.ts             # Colour tokens to CSS, with role fallbacks
│   ├── actions/                  # stickToBottom (the one scroll owner, with the new-output pill) and
│   │                             # focusPolicy (when a click, tap or key puts the caret in the prompt)
│   └── components/               # LinkCard.svelte (the card block: the link, Copy, the in-app escape);
│                                 # registry.ts, the rich cards a component block may name, each loaded on
│                                 # first use: WeatherCard.svelte (compact and wide layouts by its own
│                                 # width), QrCard.svelte, and QuoteCard, QuoteTable and Sparkline, stock's
│                                 # cards
├── testing/                      # Test setup
└── utils/
    ├── legacyShell.ts            # Migration only: the legacy tree's hooks into the VFS, for tests; every
    │                             # command is a spec now, so the app no longer loads it
    ├── virtualFileSystem.ts      # The shim over the VFS that the legacy commands walked
    └── beep.ts                   # The terminal bell
public/                           # 404.html; fonts/ (Vesen Mono
                                  # and its licence, OFL.txt); icons/ and og.png (generated, see scripts/);
                                  # manifest.webmanifest; probe/ (device capability probe, not linked from the app)
assets-src/fonts/                 # The source font Vesen Mono is built from (not served)
themes.json                       # The ten colour themes: each palette, and any role colours a theme sets itself
worker/stock/                     # vesen-stock, the Cloudflare Worker that serves stock quotes (its own README)
tests/                            # Golden snapshots and their parity check, XSS tests, network fixtures, hosting checks, helpers
e2e/                              # Playwright end-to-end tests
scripts/                          # Checks: module boundaries, bundle budget, theme contrast (and its baseline);
                                  # vite-plugin-boot.ts (emits /boot.js, which paints the saved theme before
                                  # the app loads); icons.mjs and og.mjs (regenerate public/icons and
                                  # public/og.png with `node scripts/icons.mjs` or `node scripts/og.mjs`);
                                  # theme-screenshots.mjs (regenerates docs/themes/screenshots after
                                  # `npm run build`);
                                  # fonts/build-vesen-mono.py (rebuilds public/fonts/VesenMono.woff2; needs
                                  # `pip install fonttools brotli`)
docs/
├── adr/                          # Architecture decision records; 0001 fixes the shared contracts
├── plan/                         # The improvement plan
└── themes/                       # Theme screenshots, from scripts/theme-screenshots.mjs
```

### Available scripts
```bash
npm run dev               # Start development server on port 3000
npm run build             # Build for production into dist/
npm run preview           # Serve the production build
npm run check             # Svelte and TypeScript checking (svelte-check)
npm run check:strict      # Strict TypeScript: the new browser folders with no Node types, then the
                          # unit tests, test helpers, scripts and config files with Node types
npm run check:boundaries  # Keep the DOM-free folders free of browser globals, Svelte and imports that reach them
npm run check:bundle      # Initial JS budget (60 kB gzip); run after build
npm run check:contrast    # WCAG contrast of every theme: the role colours as applied (4.5:1 for
                          # text, 3:1 for ghost text and the cursor, 7:1 for QR codes) and the palette
                          # slots legacy output uses, which must be no worse than
                          # scripts/contrast-baseline.json; add -- --strict, as CI does, to fail on
                          # any role below its minimum
npm test                  # Unit tests (Vitest)
npm run test:e2e          # End-to-end tests (Playwright: desktop Chrome, iPhone Instagram, Pixel 7)
npm run test:smoke        # The @smoke end-to-end tests on all three projects, as CI runs them
```

Install the Playwright browsers once with `npx playwright install chromium webkit`.

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues.

### Development setup
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Make your changes
4. Run the checks: `npm run check && npm test` (CI runs the checks, tests, build and smoke tests on each pull request)
5. Commit your changes: `git commit -m 'Add new feature'`
6. Push to the branch: `git push origin feature/new-feature`
7. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

The terminal font, Vesen Mono (`public/fonts/VesenMono.woff2`), is a modified subset of a font released under the SIL Open Font License 1.1, and is distributed under that licence: see [public/fonts/OFL.txt](public/fonts/OFL.txt).

## Author

**Has Salvesen**
- [Website](https://www.vesen.app)
- [Github](https://github.com/hsalvesen)
- [LinkedIn](https://www.linkedin.com/in/harrysalvesen/)

---