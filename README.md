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
View all themes: [Vesen themes](/docs/themes)

##  Development

### Project structure
```bash
src/
├── main.ts                       # Sends alias hosts to www.vesen.app, reloads on stale chunks, drops old storage keys, mounts the app
├── App.svelte                    # Layout: scrollback, prompt, suggestions, running-command line
├── app.css                       # Global styles and the CRT (cathode) effect
├── constants.ts                  # Repository URL
├── global.d.ts                   # Build-time globals
├── components/
│   ├── History.svelte            # Scrollback of commands and their output
│   ├── Input.svelte              # The prompt: keys, history, Tab completion, running and cancelling commands
│   ├── Ps1.svelte                # The prompt string
│   ├── CommandSuggestionsRow.svelte  # Suggestions while typing
│   └── Cathode.svelte            # CRT overlay
├── interfaces/                   # TypeScript interfaces (command, theme)
├── shell/                        # Contracts for the DOM-free shell kernel (docs/adr/0001-architecture.md)
│   ├── types.ts                  # CommandSpec, command context, registry, history, TTY, streams, identity
│   └── lexer-types.ts            # The lexer's result and tokens
├── output/                       # DOM-free output
│   ├── model.ts                  # Spans, blocks, actions, the `out` builders and plain()
│   ├── html-to-text.ts           # Plain text of legacy HTML output, for pipes
│   └── escape.ts                 # HTML escaping for command output
├── vfs/types.ts                  # The file system contract
├── platform/                     # Browser-facing helpers: canonical host redirect, stale-chunk reload, legacy keys
├── services/
│   ├── net.ts                    # fetch with timeouts, cancelling, byte caps and typed network errors
│   ├── types.ts                  # Service interfaces: net, storage, bell, opener, clipboard, clock, system info
│   ├── storage-keys.ts           # Every browser storage key, in one registry
│   └── market/contract.ts        # The stock Worker's wire format, shared by the Worker and the app
├── stores/                       # Svelte stores: history, the running job, theme, cathode
├── testing/                      # Test setup
└── utils/
    ├── commands.ts               # Command table and dispatcher
    ├── commands/                 # Commands: file system, network, system, QR
    ├── virtualFileSystem.ts      # The in-memory file system
    ├── helpTexts.ts              # Help for each command
    ├── commandSuggestions.ts     # Suggestions while typing
    ├── notice.ts                 # Shared notices (cancelled commands, errors)
    ├── beep.ts                   # The terminal bell
    └── mobile.ts, textWrap.ts, osLogos.ts
public/                           # README.md, history.txt and linux.txt for cat; favicons; font;
                                  # 404.html; probe/ (device capability probe, not linked from the app)
themes.json                       # The ten colour themes
worker/stock/                     # vesen-stock, the Cloudflare Worker that serves stock quotes (its own README)
tests/                            # Golden snapshots of command output, network fixtures, hosting checks, helpers
e2e/                              # Playwright end-to-end tests
scripts/                          # Checks: module boundaries, bundle budget, theme contrast (and its baseline)
docs/
├── adr/                          # Architecture decision records; 0001 fixes the shared contracts
├── plan/                         # The improvement plan
└── themes/                       # Theme screenshots
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
npm run check:contrast    # WCAG contrast of every theme: fails if any pair is worse than
                          # scripts/contrast-baseline.json (add -- --strict to require 4.5:1 everywhere)
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

## Author

**Has Salvesen**
- [Website](https://www.vesen.app)
- [Github](https://github.com/hsalvesen)
- [LinkedIn](https://www.linkedin.com/in/harrysalvesen/)

---