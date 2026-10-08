# Contributing to vesen

Thanks for helping. vesen is a small portfolio project, so the bar is simple: every change keeps the gates green, works on a phone inside Instagram as well as on a desktop, and fits the architecture in [ADR 0001](docs/adr/0001-architecture.md). Please read [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) first, and report security problems privately as [SECURITY.md](SECURITY.md) describes, never in a public issue.

## Setup

```bash
git clone https://github.com/hsalvesen/vesen.git
cd vesen
nvm use                                   # Node from .nvmrc (22.12 or later)
npm ci                                    # exactly what package-lock.json names
npx playwright install chromium webkit    # once, for the end-to-end tests
npm run dev                               # http://localhost:3000
```

The build reads two optional variables, `VITE_STOCK_API` and `VITE_FETCH_PROXY`: copy `.env.example` to `.env.local` to set them. Without them `stock` uses its interim source and `curl --via-proxy` says there is no proxy, which is fine for development.

## Where things go

- A new command: [docs/ADDING_COMMANDS.md](docs/ADDING_COMMANDS.md). New commands go in the catalogue (`src/commands/more/<category>/`), with the body and long help in a `.run.ts`.
- The shell's grammar and its known gaps: [docs/SHELL.md](docs/SHELL.md).
- A change to a shared contract (`src/shell/types.ts`, `src/output/model.ts`, `src/services/types.ts` and the others in the ADR's table) is also an amendment to [ADR 0001](docs/adr/0001-architecture.md), in the same pull request.

House rules, which the gates enforce where they can:

- `src/shell`, `src/output`, `src/vfs`, `src/lib` and `src/commands` stay free of the DOM, browser storage and Svelte; only `src/services` and `src/platform` touch browser APIs.
- No HTML output and no `{@html}`. Commands write text and blocks; tap actions come only from the `out` builders.
- Avoid `AbortSignal.any`, `AbortSignal.timeout`, `Array.prototype.at`, `Object.hasOwn`, `Object.groupBy` and `Promise.withResolvers`: Instagram's browser on older iPhones lacks them.
- Every regular expression a visitor types goes through `src/commands/lib/regex.ts`.
- Linux behaviour: GNU's wording and exit codes, and coreutils silent on success with `-v` to confirm.
- Content (cows, fortunes, fonts, art) is written for vesen, not copied from elsewhere.
- No new dependencies without discussing it in an issue first.
- Tests never touch the network: record responses under `tests/fixtures/` and serve them through a fake.

## The gates

CI runs these on every pull request; run them before you push.

```bash
npm run check                         # svelte-check, 0 errors
npm run check:strict                  # strict TypeScript
npm run check:boundaries              # DOM-free folders, no {@html}, the catalogue kept out of the kernel
npm test                              # Vitest
npm run build
npm run check:bundle                  # initial JS 60 kB, kernel 75 kB in at most 4 files, catalogue 40 kB, stock's first quote 19 kB (gzip)
npm run check:contrast -- --strict    # every theme's text roles at 4.5:1 or better
npm run test:smoke                    # Playwright @smoke on desktop Chrome, iPhone in Instagram and Pixel 7
```

`npm run test:e2e` runs every end-to-end test; run it when you touch the prompt, the dock, the viewport, links or a full-screen app. Set `PW_PORT` if port 4173 is busy. A transcript in `tests/transcripts/` that changed on purpose is refreshed with `npx vitest run tests/transcripts -u`; read the diff before committing it.

## Commits

- One topic per commit, and the gates pass at every commit.
- The subject is short and in the imperative, in plain words: "Add the phone dock's history sheet", "Keep the kernel within its budget". No prefixes such as `feat:`.
- The body, when there is one, says why, and anything a reviewer would not see from the diff.

## Pull requests

1. Branch from `main` and open a pull request against it. The template asks for a summary, how you tested, and the phone checklist.
2. CI runs the gates. For a branch in this repository it then deploys the build it tested to a **Firebase preview channel** and comments the URL on the pull request. Pull requests from forks and from Dependabot get the checks but no preview.
3. Open the preview on a phone, ideally from an Instagram DM to yourself, and work through the checklist below.
4. After review, the pull request is merged to `main`, and CI deploys the same tested build to www.vesen.app.

### Phone checklist

On iOS Safari, iOS Instagram, Android Chrome and Android Instagram, as far as you can:

- [ ] No white flash. The banner fits at 320, 375 and 414 px, and the page never scrolls sideways.
- [ ] Tapping the prompt does not zoom, and pinch zoom works.
- [ ] The keyboard stays open across three commands, and the prompt stays above it.
- [ ] Chips run and insert without closing the keyboard, and the Stop chip cancels a slow command.
- [ ] Rotation reflows `help`, `ls` and `fastfetch` without running them again.
- [ ] `whoami`, `email` and `repo` show cards; tapping a link and pressing Back restores the terminal.
- [ ] `qr vesen.app` opens Present mode on a tap, and the image can be saved or screenshotted.
- [ ] Reduced motion stops the CRT animation and the cursor blink.

## Releases

The owner releases from `main`: bump the version with `npm version X.Y.Z --no-git-tag-version` (the banner and `/etc/os-release` read it), move the `Unreleased` notes in [CHANGELOG.md](CHANGELOG.md) under the new version, merge, then push a `vX.Y.Z` tag. `.github/workflows/release.yml` creates the GitHub release from the tag.
