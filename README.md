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
├── main.ts                       # Mounts the app
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
├── output/escape.ts              # HTML escaping for command output
├── services/net.ts               # fetch with timeouts, cancelling and typed network errors
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
public/                           # README.md, history.txt and linux.txt for cat; favicons; font
themes.json                       # The ten colour themes
tests/                            # Golden snapshots of command output, network fixtures, helpers
e2e/                              # Playwright end-to-end tests
scripts/                          # Checks: module boundaries, bundle budget, theme contrast
docs/                             # Theme screenshots and the improvement plan
```

### Available scripts
```bash
npm run dev               # Start development server on port 3000
npm run build             # Build for production into dist/
npm run preview           # Serve the production build
npm run check             # Svelte and TypeScript checking (svelte-check)
npm run check:strict      # Strict TypeScript for the new folders, scripts and tests
npm run check:boundaries  # Keep the DOM-free folders free of browser globals and Svelte
npm run check:bundle      # Initial JS budget (60 kB gzip); run after build
npm run check:contrast    # WCAG contrast of every theme (add -- --strict to enforce)
npm test                  # Unit tests (Vitest)
npm run test:e2e          # End-to-end tests (Playwright: desktop Chrome, iPhone Instagram, Pixel 7)
npm run test:smoke        # The @smoke end-to-end tests on desktop Chrome, as CI runs them
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