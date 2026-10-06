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
Type `help` in the terminal to see all available commands, or explore the file system with `ls` and `cd`.

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
│                                 # CRT overlay) above an empty slot for the phone dock
├── app.css                       # Imports the style sheets below
├── styles/                       # tokens.css (Vesen Mono, --term-font, --term-fs, --term-lh),
│                                 # terminal.css (base type, the .art class for banners, logos and charts),
│                                 # shell.css (the fixed shell sized to the visible viewport; phones
│                                 # edge to edge, the desktop framed), components.css (output in role
│                                 # colours: errors, panels, list markers, swatches, the scrollbar) and
│                                 # crt.css (the CRT effect, by tier)
├── constants.ts                  # Repository URL and the prompt's host
├── global.d.ts                   # Build-time globals
├── components/
│   ├── History.svelte            # Scrollback of commands, each output drawn by ui/OutputView
│   ├── Input.svelte              # The prompt: keys, history, Tab completion, running and cancelling commands
│   ├── Ps1.svelte                # The prompt string
│   ├── CommandSuggestionsRow.svelte  # Suggestions while typing
│   └── Cathode.svelte            # CRT overlay, inside the screen frame
├── interfaces/                   # TypeScript interfaces (command, theme)
├── shell/                        # Contracts for the DOM-free shell kernel (docs/adr/0001-architecture.md)
│   ├── types.ts                  # CommandSpec, command context, registry, history, TTY, streams, identity
│   └── lexer-types.ts            # The lexer's result and tokens
├── output/                       # DOM-free output
│   ├── model.ts                  # Spans, blocks, actions, the `out` builders and plain()
│   ├── html-to-text.ts           # Plain text of legacy HTML output, for pipes
│   ├── legacy-policy.ts          # What the legacy HTML shim keeps: tags, attributes, classes, styles
│   └── escape.ts                 # HTML escaping for command output
├── vfs/types.ts                  # The file system contract
├── lib/                          # colour.ts (luminance, contrast, mixing, nudging a colour until it reads)
│                                 # and roles.ts (each theme's --role-* colours, computed from its palette
│                                 # where themes.json does not set them, and the contrast each must meet);
│                                 # qr/ (the QR encoder: segments, error correction, masks, and text, SVG
│                                 # and raster renderers)
├── platform/                     # Browser-facing helpers: canonical host redirect, stale-chunk reload,
│                                 # head.ts (palette colours, theme-color, favicon), theme-apply.ts (the
│                                 # role colours), perf.ts (the CRT tier: full, lite or off, and why),
│                                 # crt.ts (CRT classes), measure.ts (--input-scale for the 16px touch
│                                 # input), viewport.ts (--app-h, --app-top and --kb-h from visualViewport)
├── services/
│   ├── net.ts                    # fetch with timeouts, cancelling, byte caps and typed network errors
│   ├── storage.ts                # localStorage and sessionStorage with a memory fallback; one-time migrations
│   ├── types.ts                  # Service interfaces: net, storage, bell, opener, clipboard, clock, system info
│   ├── storage-keys.ts           # Every browser storage key, in one registry
│   ├── weather/                  # Weather's sources (forecast, geocoding, IP location), place resolution,
│   │                             # units and WMO codes, and the view model a weather card draws
│   └── market/contract.ts        # The stock Worker's wire format, shared by the Worker and the app
├── stores/                       # Svelte stores, pure state: history, the running job, theme, cathode
├── ui/
│   ├── OutputView.svelte         # Draws output blocks with text interpolation only
│   ├── SpanView.svelte           # One styled span: link, trusted action button or live theme binding
│   ├── legacy-html.ts            # use:legacyHtml, which rebuilds legacy HTML from the allowlist
│   ├── span-style.ts             # Colour tokens to CSS, with role fallbacks
│   ├── legacy-highlights.ts      # Moves the current-theme and CRT markers in earlier legacy listings
│   ├── actions/                  # stickToBottom (the one scroll owner, with the new-output pill) and
│   │                             # focusPolicy (when a click, tap or key puts the caret in the prompt)
│   └── components/registry.ts    # Rich cards a component block may name (none yet)
├── testing/                      # Test setup
└── utils/
    ├── commands.ts               # Command table and dispatcher; the network commands load on first use
    ├── commands/                 # Commands: file system, network, system, QR; fastfetch and the network
    │                             # commands load on first use
    ├── virtualFileSystem.ts      # The in-memory file system
    ├── helpTexts.ts              # Help for each command
    ├── commandSuggestions.ts     # Suggestions while typing
    ├── notice.ts                 # The one notice panel and the one error style (cmd: message, then a hint)
    ├── beep.ts                   # The terminal bell
    └── osLogos.ts                # fastfetch's logos, loaded with it
public/                           # README.md, history.txt and linux.txt for cat; 404.html; fonts/ (Vesen Mono
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