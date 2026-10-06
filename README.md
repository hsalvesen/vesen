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
Type `help` in the terminal to see every command by category, `man <command>` for one command's manual (`man vesen` is about the terminal itself), and `help keys` for the keys. Explore the file system with `ls` and `cd`; `exit` ends the session and offers a new one.

At the prompt, Tab completes, ↑ and ↓ step through the history lines that start with what is typed, Ctrl+R searches the history, and grey text offers the rest of a past line (→ takes it). While the prompt has focus, the readline keys edit the line: Ctrl+A, E, U, K, Y, L and D everywhere, Ctrl+W, P, N, F, B and T on a Mac, and Alt+B, F, D, Y, . and Backspace. Ctrl+C copies selected text, and otherwise stops the running command. Escape then Tab leaves the terminal for the rest of the page.

On a phone, a dock rides above the keyboard. Its chips run a starter command in one tap without opening the keyboard, offer what comes next after a command (every theme after `theme ls`), and build a line by tapping: a completion goes on the line as Tab would put it, and one that finishes the line runs it. Holding a chip that runs puts it at the prompt instead. The key bar has tab, ↑, ↓, ^C, clear, ••• for symbols and ⌄ to put the keyboard away; holding ↑ opens a list of past commands. A hardware keyboard hides the key bar; `keys on|off|auto` chooses. Open the page with `?dock=1` to see the dock on a desktop.

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
│                                 # cathode, banner), files/ (ls, cat, cp, mv, rm, rmdir, mkdir, touch, ln,
│                                 # stat, cd, pwd), text/ (echo, printf), shell/ (help, man, whatis,
│                                 # apropos, history, clear, reset, alias, unalias, export, unset, env,
│                                 # printenv, set, source, type, which, command, true, false, test, exit,
│                                 # login, sleep), system/ (date, keys); lib/ is what they share, the banner
│                                 # included; legacy.ts wraps the commands not yet ported
├── lib/                          # colour.ts (luminance, contrast, mixing, nudging a colour until it reads)
│                                 # and roles.ts (each theme's --role-* colours, computed from its palette
│                                 # where themes.json does not set them, and the contrast each must meet);
│                                 # qr/ (the QR encoder: segments, error correction, masks, and text, SVG
│                                 # and raster renderers)
├── platform/                     # Browser-facing helpers: canonical host redirect, stale-chunk reload,
│                                 # head.ts (palette colours, theme-color, favicon), theme-apply.ts (the
│                                 # role colours), perf.ts (the CRT tier: full, lite or off, and why),
│                                 # crt.ts (CRT classes), measure.ts (--input-scale for the 16px touch
│                                 # input), viewport.ts (--app-h, --app-top and --kb-h from visualViewport,
│                                 # and the dock's layout for the visible height)
├── services/
│   ├── net.ts                    # fetch with timeouts, cancelling, byte caps and typed network errors
│   ├── storage.ts                # localStorage and sessionStorage with a memory fallback; one-time migrations
│   ├── types.ts                  # Service interfaces: net, storage, bell, opener, clipboard, clock, system info
│   ├── storage-keys.ts           # Every browser storage key, in one registry
│   ├── weather/                  # Weather's sources (forecast, geocoding, IP location), place resolution,
│   │                             # units and WMO codes, and the view model a weather card draws
│   └── market/contract.ts        # The stock Worker's wire format, shared by the Worker and the app
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
│   ├── Prompt.svelte             # guest@vesen:~/documents$, live under the transcript and as each entry's snapshot
│   ├── OutputView.svelte         # Draws output blocks with text interpolation only
│   ├── SpanView.svelte           # One styled span: link, trusted action button, live theme or CRT marker,
│   │                             # or theme swatches
│   ├── legacy-html.ts            # use:legacyHtml, which rebuilds legacy HTML from the allowlist
│   ├── span-style.ts             # Colour tokens to CSS, with role fallbacks
│   ├── legacy-highlights.ts      # Renames the theme in earlier legacy fastfetch output
│   ├── actions/                  # stickToBottom (the one scroll owner, with the new-output pill) and
│   │                             # focusPolicy (when a click, tap or key puts the caret in the prompt)
│   └── components/registry.ts    # Rich cards a component block may name (none yet)
├── testing/                      # Test setup
└── utils/
    ├── commands.ts               # The legacy command table (repo, email); the network commands
    │                             # load on first use
    ├── commands/                 # Legacy commands not yet ported: network, system, QR, poweroff;
    │                             # fastfetch and the network commands load on first use
    ├── virtualFileSystem.ts      # A shim over the VFS for the legacy commands not yet ported
    ├── helpTexts.ts              # Help for each legacy command not yet ported
    ├── notice.ts                 # The one notice panel and the one error style (cmd: message, then a hint)
    ├── beep.ts                   # The terminal bell
    └── osLogos.ts                # fastfetch's logos, loaded with it
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