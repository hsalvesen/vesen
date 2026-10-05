# Tooling, hosting, process and housekeeping

**Goal:** make it safe to change vesen roughly forty times in a row. Every change should be checked before it reaches the live site behind the Instagram link, the live site should behave correctly across deploys, and the repository should describe itself accurately.

Most of this is Phase 0 of the roadmap and should land before any workstream starts.

## 0.1 A review gate (half a day, mostly settings)

Today 153 of 156 commits went straight to `main`, and every push to `main` deploys live to Firebase and publishes a Docker image, with no check in between.

- Protect `main`: require pull requests and require the CI checks below.
- Gate the Docker workflow on the same checks.
- Write the release loop down as a checklist:
  1. Open a PR.
  2. Firebase posts a preview URL.
  3. DM the URL to yourself on Instagram.
  4. Run the phone checklist in [04-phone-and-instagram.md](04-phone-and-instagram.md) on both phones.
  5. Merge.

## 0.2 Hotfix for the live site (half a day)

These ship before any redesign, because the redesigns take weeks.

- Delete the three dead proxies from `curl` (`network.ts:136-138`), so it fails fast with an honest CORS message.
- Wrap every existing fetch (`network.ts:47, 143, 237, 466, 521, 544`; `system.ts:448`) in an `AbortController` with an 8-10 s timeout.
- Make Escape, and a tap on the "Processing…" line, call the existing abort. Phone visitors can then cancel a stuck `stock`.

## 0.3 Quick fixes (about one day, all small and independent)

| Fix | Where | Finding |
|---|---|---|
| Move the two closing braces so the home folder's contents sit inside `/home/user` | `src/utils/virtualFileSystem.ts:204-205` | F003 |
| Let Ctrl+C copy when text is selected | `src/components/Input.svelte:194` | F014 |
| Wrap long echoed commands instead of truncating them with an ellipsis | `src/components/History.svelte:38-44` | F070 |
| Use `setAttribute('sizes', 'any')`, so `svelte-check` reports 0 errors | `src/stores/theme.ts:71,78` | F085 |
| Delete the dead `reset` and the dead history persistence | `fileSystem.ts:479-501`; `history.ts:5-7, 22-28` | F033, F025 |
| Reuse one `AudioContext` for the bell | `src/utils/beep.js:4` | F058 |
| Take the version from one build-time constant, so `/etc/os-release` stops saying v1.0.0 | `virtualFileSystem.ts:43`, `vite.config.ts` | F090, F091 |
| Correct the Docker image name (`hsavlesen` → `hsalvesen`) | `README.md:25,71,87` | F089 |
| Fix or remove the Docker healthcheck, which runs `curl` against port 80 in an image with no `curl` that serves 3000 | `docker-compose.yml:9` | F057 |
| Replace the archived release action with `gh release create "$GITHUB_REF_NAME" --generate-notes`, and stop overwriting one `latest` release | `.github/workflows/release.yml:21-25` | F055 |
| Remove the abandoned Vercel link and ignore it | `.vercel/project.json` | F062 |
| Delete the merged branches `UI`, `demo`, `refactor` and the duplicate `GUI` | remote | |

## 0.4 Toolchain upgrade and test stack (one day)

Upgrade first and add tests second, so the new test runner matches the new Vite.

- **Upgrade together:** `svelte`, `@sveltejs/vite-plugin-svelte`, `vite`, `svelte-check` and `typescript`, all to current releases (check the exact versions on the day). Then run `npm audit fix`. Today `npm audit` reports 8 advisories (1 critical, 5 high, 2 moderate), all in build tooling except the Svelte ones, which affect server-side rendering that vesen does not use.
- **Dependabot:** add `.github/dependabot.yml` for npm, GitHub Actions and Docker, grouped weekly.
- **Tailwind:** decide its fate. It is used for about 15 utility classes, and `tailwind.config.js` is ignored by Tailwind 4. Either keep Tailwind through `@tailwindcss/vite` and delete the dead config, `postcss.config.js` and `autoprefixer`, or drop Tailwind for the token CSS in `src/styles/`. The second option is recommended, because the visual workstream replaces those classes anyway. Note that `src/app.css` now contains `@source not "../docs/plan";`, added with this plan, because Tailwind 4 scans every file in the repository for class names and was adding about 4 kB of unused utilities from these documents. Remove that line if Tailwind is dropped.
- **TypeScript:**
  - `tsconfig.json` extends `@tsconfig/svelte` and uses bundler module resolution.
  - The `*.svelte` shim in `global.d.ts` goes.
  - A `tsconfig.strict.json` covers every new folder from day one.
  - `beep.js` becomes TypeScript.
- **Tests:** add one `vitest` (node environment for core code, `happy-dom` for UI), `@testing-library/svelte`, and Playwright with Desktop Chrome, WebKit iPhone with an Instagram user agent, and Pixel 7 projects.
- **Scripts:** `test`, `test:e2e`, `check:strict`, `check:boundaries`, `check:bundle` and `check:contrast`.
- **Golden snapshots:** record today's output of `banner`, `help`, `ls`, `cat README.md`, `theme ls`, `cathode ls`, `fastfetch` (with a mocked browser), `history`, and the weather and stock fixtures, at 40, 80 and 120 columns. Every later port is compared against them.
- **Node:** pin it with `.nvmrc` (22) and `engines`, and use `actions/setup-node` with an npm cache in CI.

## 0.5 One CI workflow

A single `ci.yml` runs on every pull request and every push to `main`:

1. `npm ci`
2. `svelte-check` (0 errors)
3. `check:strict` and `check:boundaries`
4. `vitest`
5. `vite build`
6. Bundle budget: 60 kB gzip for the initial chunk (48.7 kB today, with `qrcode` removed early)
7. Contrast check
8. Playwright smoke tests

The Firebase preview deploy, the live deploy and the Docker publish each depend on this job, and a concurrency group cancels superseded runs.

## 0.6 Hosting (half a day, plus console settings)

- **Headers:** set the security and cache headers from [02-architecture-and-contracts.md](02-architecture-and-contracts.md#13-security-and-cache-headers), Report-Only first. Today the bundle and `index.html` are both served with a one-hour cache, and no security headers except HSTS.
- **No catch-all rewrite:** replace the `**` rewrite with a terminal-styled `404.html`. Today a missing asset returns `index.html` with HTTP 200, which breaks lazy chunks after a deploy and serves HTML for `robots.txt`.
- **Reload on stale chunks:** add a `vite:preloadError` handler that reloads and restores the session.
- **One origin:** the same build is served at `www.vesen.app`, `vesen.app`, `vesenterminal.web.app` and `vesenterminal.firebaseapp.com`, each with its own storage and its own prompt text.
  - Redirect the apex to `www` in the Firebase console.
  - Add `rel=canonical`.
  - Redirect the two Firebase hostnames to `www` client-side, except preview channels (hostnames containing `--`).
- **Confirm the link:** check which URL the Instagram bio actually links to.

## 0.7 Docker: decide whether it stays

The image's final stage is busybox `httpd`, which cannot send security or cache headers. Pick one:

- **Keep it.** Switch the final stage to nginx or caddy, so headers match Firebase. Add a `.dockerignore`, pin base images by digest, build for amd64 and arm64, and smoke-run the image in CI.
- **Drop it.** Remove the Docker sections from the README, the workflow and `docker-compose.yml`.

## 0.8 Font licence

If the Cascadia subset ships, include `OFL.txt` and rename the font, as [09-visual-and-accessibility.md](09-visual-and-accessibility.md) describes.

## 0.9 Analytics: one decision

Umami tracking is compiled out of production today. No workflow sets `VITE_TRACKING_ENABLED`, and the live bundle contains no `umami` string. When enabled, though, it sends every command's full arguments, including echo text and anything typed at the sudo prompt (F052).

- **Recommended:** delete `src/utils/tracking.ts` and the `<svelte:head>` block. That also removes a CSP exception.
- **Alternative:** enable it deliberately, sending only the command name, exit status and device class, and document that in the README.

## 0.10 Privacy and error visibility

- **Privacy:** add a `privacy` command, linked from `help` and the README. It lists each third party vesen talks to (Open-Meteo, OpenStreetMap, the IP lookup, the stock Worker, Cloudflare speed test, DNS-over-HTTPS, RDAP, GitHub), what is sent, and that IP and location lookups happen only on request.
- **Error visibility:** Instagram's in-app browsers cannot be inspected remotely. Add a `debug report` command that copies the environment, recent errors and the build id for pasting into an issue. Optionally add a sampled, PII-free error beacon to the stock Worker's `/v1/errors` route.

## 0.11 Documentation

| Document | Content |
|---|---|
| `README.md` | Corrected image name and a corrected project tree, an Architecture section, a Configuration section (env vars), a Deployment section (Firebase channels, Worker), credits (Open-Meteo CC BY 4.0, © OpenStreetMap contributors, Cascadia OFL) |
| `docs/SHELL.md` | Supported grammar and known gaps |
| `docs/ADDING_COMMANDS.md` | Copy a command, add examples, run `npm test` |
| `CHANGELOG.md` | Keep a Changelog format, seeded from the tags v1.0.0 to v1.2.0 |
| `CONTRIBUTING.md`, `SECURITY.md`, a PR template, YAML issue forms | The current issue templates still mention "iPhone6 / iOS8.1" |
