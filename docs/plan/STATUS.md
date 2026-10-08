# Status of the overhaul

*Written 8 October 2026 for v2.0.0, on the `overhaul` branch (pull request #3), not yet merged to `main`.*

Every phase of the [roadmap](README.md#roadmap) is built, including all six optional command waves. This page records what landed in each phase and where, every deliberate deviation from the plan, what only the owner can do, and what is left to do. [ADR 0001](../adr/0001-architecture.md) has the full text of each contract change; the [changelog](../../CHANGELOG.md) describes the release for visitors.

## What was built, phase by phase

Commit ranges are inclusive; `git log --oneline FIRST^..LAST` lists one. The phases were built on one branch rather than one pull request each (see Deviations).

| Phase | Commits | What landed |
|---|---|---|
| Plan | `5114b73` | The audit and this plan. |
| **0. Guardrails and hotfix** | `2d3f9bc`..`8346ff8` (7) | Toolchain upgrade (Svelte 5, Vite 8, TypeScript 6), Vitest and Playwright, one CI workflow; golden snapshots of the legacy terminal; the timeout and cancel hotfix and the quick fixes; analytics and Docker dropped; hosting headers, the 404 page, the host redirect and the device probe; the shared contracts and ADR 0001. |
| **1. Safety and first impression** | `a41797f`..`afed6a8` (15) | The safe renderer (`OutputView`, an in-house legacy HTML shim); boot safety, head tags, icons, manifest and link preview; pinch zoom back with a 16 px touch input; Vesen Mono self-hosted; the shell sized to the visible viewport with one scroll owner; role colours, contrast fixes, CRT tiers. In parallel: the in-house QR encoder (the `qrcode` dependency dropped), the weather core, the stock Worker and its contract. |
| **2. Shell kernel** | `fce57e6`..`3846e3a` (6) | Lexer, parser, history, aliases, expansion; every line through the kernel with the legacy commands behind an adapter; the VFS with the cwd prompt and persistence; the core commands ported to specs; help and `man` from the specs. |
| **3. Prompt and phone** | `b9be792`..`f1eda9a` (7) | The completion engine (Tab, ghost, chips); the line editor with readline keys and reverse search; the phone dock; link cards, the in-app link policy, the Shutdown screen and the Back snapshot; streaming output, the status line and reflow. |
| **4. Data commands** | `147bd66`..`5547828` (10) | Room made in the first paint and the kernel; `curl`, `speedtest` and `fastfetch` on specs with one SysInfo; weather on Open-Meteo cards; stock's client, card and table; `qr` with its card and Present mode. |
| **5. Finish the shell** | `f6c2265`..`ec96dee` (17) | 5.1 the legacy layer deleted (`f6c2265`); 5.2 the lazy catalogue (`b02b1d3`); waves F, E, D, C, A2 and A1 built side by side (`30d1818`, `7344b3b`, `f485027`, `d93ec7a`, `8fdeb59`, `d1c9fe0`, `8718c88`) and merged in order (`490e31c`..`775fe87`); the kernel kept in budget (`115ec06`); the review fixes (`ec96dee`). |
| **Release** | the commit after `ec96dee` | Version 2.0.0, this page, the README, `docs/SHELL.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, the pull request template and issue forms, the theme screenshots. |

### Numbers at release

- **Bundles (gzip):** JavaScript before the first paint 56.8 of 60 kB; the kernel 72.2 of 75 kB, in three files (at most four); the catalogue's specs 28.7 of 40 kB; what `stock`'s first quote fetches 18.5 of 19 kB.
- **Tests:** 5,165 unit tests in 223 files; 360 Playwright smoke tests across desktop Chrome, iPhone in Instagram and Pixel 7 (the merge step's full end-to-end run: 378 passed, 168 skipped by design).
- **Commands:** about 160, 61 in the core and 97 in the catalogue.

## Deviations from the plan

Each was deliberate; the ADR amendment named in brackets has the detail.

### How it was built

- **One branch, not a pull request per step.** The plan has every step as its own pull request with a Firebase preview, and a release after each phase (v1.2.1 to v1.6.0). The whole programme was built on `overhaul`, with parallel work in git worktrees merged locally, and ships as one release, v2.0.0. PR #3 carries it, with a Firebase preview channel of its own.
- **No real-device run yet.** The device probe was meant to run on a real iPhone and Android phone before Phase 3. It has not been run (see below), so the phone work was built against the plan's assumptions and checked in Playwright's WebKit with Instagram's user agent and on a Pixel 7 profile. The results may still call for changes to the touch editor, persistence, link handling or QR saving.
- **The review fixes were finished in the release session.** The Phase 5 fix step was cut off before it committed. What it had written passed every gate apart from four test expectations its own changes had made stale (the role count, the `cal` and `ps` transcripts, and `ps`'s procps-style error). Those were brought up to date, every gate was run, and the result was committed as `ec96dee` before the release commit; the findings it had not reached are under Follow-ups.
- **The golden snapshots are gone.** They pinned the legacy terminal during the ports and were deleted with it in Phase 5.1; command transcripts in `tests/transcripts/` at 40, 80 and 120 columns replace them for the new commands. `tests/golden/README.md` says where the snapshots are in history. [Phase 5.1]

### Contracts

- **The command deadline.** `CommandContext.deadline` tells a command when its whole budget runs out, so `stock` plans its lookups against it. Folded into [02](02-architecture-and-contracts.md), section 4. [Phase 4 review fixes]
- **The lazy catalogue.** New commands live in `src/commands/more/` and load in one chunk after the kernel; the registry gains `complete`, `whenComplete()`, `takeFailure()` and `onChange()`, and lookups wait for it. Folded into 02, sections 1 and 11. [Phase 5.2]
- **Long help in lazy bodies.** A command's `description` and `man` may live in its `.run.ts` as `doc: CommandDoc`, read through `withDoc(spec)`; `load()` returns `{ run, doc? }`. [Phase 4.0]
- **Lazy cards.** `src/ui/components/registry.ts` maps each card to a loader; a card's chunk arrives the first time a block names it, and its plain text stands in until then. [Phase 4.0]
- **`NetError` has a seventh kind, `network`**, for a failed same-origin request while online.
- **A link card is the `card` block**; `link-card` is not a component. `tty.open()` prints nothing and every opener prints its own card. `noopener` opens count a `null` return as opened.
- **The market and weather cores are service contracts** that DOM-free code may import; their I/O sits behind ports (`market/port.ts`, the `WeatherService`).
- **Additive kernel contracts from the waves:** `CommandContext.digest` (WebCrypto hashes through a port), the process table (`ShellApi.pid()`, `processes()`, `kill()`, `exec(line, { signal })`, `tty.readLine({ signal })`), `StreamInit.mode: 'no-cors'` for `ping`, a session-storage port for commands, `Frame.foreground` so a pipeline stage at the prompt may open the pager, and `ParsedArgs.version` for `--version`. [Waves A1, C, D, F; Phase 5 review fixes]
- **Six more text roles**, `rainbow-red` to `rainbow-purple`, so `lolcat` reads in every theme; `ROLES` has 28 names. [Phase 5 review fixes]

### Safety

- **An in-house legacy sanitiser instead of DOMPurify.** DOMPurify was not a dependency and would have taken the initial chunk past 60 kB, so the shim rebuilt legacy HTML from an allowlist inside an inert document, with no second parse. It was deleted with the legacy layer in Phase 5.1, as DOMPurify would have been.
- **No `{@html}` from Phase 1**, not only from v2.0.0: the legacy branch rendered through a Svelte action, and `check:boundaries` forbids `{@html` everywhere.
- **The CSP was enforced from the first deploy**, not shipped Report-Only first: with no reporting endpoint a trial would collect nothing. The end-to-end tests run the app, the probe and the 404 page under it, and the probe records violations. The `<meta>` CSP for the Docker image is moot, as Docker was dropped.
- **The stale-chunk reload does not restore the session**; the Back snapshot is restored only on Back or Forward.
- **The snapshot is also saved before a same-view link is followed**, because WebKit drops `sessionStorage` writes made during `pagehide` across sites.
- **One cleaner for upstream text** (`src/lib/upstream-text.ts`) for names from weather and stock sources.
- **One regex guard with a line limit.** `src/commands/lib/regex.ts` refuses nested and ambiguous repeats, weighs bounded choices, and gives each pattern the longest line it may run against. `find -name`, `-path` and `tree -I` use shell wildcards (`fnmatch.ts`), so `find` has no `-regex`. [Wave A1, Wave A2, merge, Phase 5 review fixes]

### Size and loading

- **The kernel kept its 75 kB budget** by moving long help and bodies into lazy `.run.ts` files (ls, stat, cp, rm, mkdir, touch, help, man, sudo, rmdir, type, command and others), moving `plain()` to `output/plain.ts`, loading `$(( ))`'s evaluator on first use, and loading the completion row and system facts after the first paint. The budget was never raised. [Phase 4.0, Phase 4 merged, merge]
- **The kernel comes as one chunk**: `scripts/kernel-chunk.ts` groups what only the kernel imports, and `check:bundle` fails above four files. [Phase 5 review fixes]
- **`stock`'s first quote has a 19 kB budget, not 12 kB,** while the interim source is bundled; it returns to 12 kB when the Worker is deployed and `interim.ts` is deleted. [Phase 4 review fixes]
- **The catalogue has a 40 kB budget of its own**, bodies not counted, and must be exactly one chunk outside the kernel. [Phase 5.2]
- **The idle prefetch respects the connection**: on Data Saver or a slow or cellular connection no bodies or cards are fetched ahead of use; the catalogue's specs always are.

### Commands and help

- **More than the waves asked:** `bc` computes with exact decimals on BigInt (up to 100,000 digits; its math library to a scale of 5,000); `grep -P` takes JavaScript's syntax through the guard; `dig` knows every IANA record type; `factor`, `cowthink`, `ps -o` and `ps` BSD formats, `--version` on every command.
- **Skipped or partial:** `split` and `install` were optional in wave A2 and are not built, nor is `awk`, which the plan never listed; `sed` lacks `e`, `R`, `W` and `v`; `bc` lacks `define`, arrays and `read()`; `diff` cannot compare folders; `env -i` is not possible with the shell API; `nslookup`'s interactive mode is not supported; `less` has no `:n`/`:p` between files.
- **One rule for help's short index.** On a terminal narrower than 80 columns each category's row keeps to one line, elsewhere to two; a long row keeps `helpRank`ed, then `featured`, then core names and ends with `+N more`, which runs `help --all`. Fun is one row like the rest. [merge]
- **Fun commands are quiet in Tab lists** (unless typed in full or nothing else matches) and listed in help under Fun. [Wave E]
- **`vi` and `vim` open `nano`** after a one-line note, and are hidden from help and Tab. [Wave F]
- **Network stand-ins** (`traceroute`, `ssh`, `telnet`, `nc`, `ftp`) are hidden from help and Tab and exit 1 with one line. `ping` refuses loopback and private addresses. `git` shows authors by name only. [Wave D]

### Docs

- `README.md`, `docs/SHELL.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, the pull request template and the YAML issue forms are written; `docs/ADDING_COMMANDS.md` gained the catalogue, `doc`, `--version`, tables and roles.
- **The theme screenshot script waits for each line to finish.** `scripts/theme-screenshots.mjs` typed `ls -a` while `help` could still be waiting for the catalogue, and failed on a different theme each run; it now waits for the transcript's `aria-busy="false"`, as the end-to-end tests do.
- **`docs/themes/themes.gif` was not rebuilt**: ffmpeg is not installed on the machine that made the release. The ten screenshots in `docs/themes/screenshots/` were regenerated from the v2.0.0 build; run `node scripts/theme-screenshots.mjs` after `npm run build` on a machine with ffmpeg to rebuild the GIF.

## What still needs the owner

- [ ] **Run the device probe** from an Instagram DM on an iPhone and an Android phone, and paste the results into [device-probe-results.md](device-probe-results.md), which says how. Then compare them with the assumptions above and file issues for anything that differs.
- [ ] **Remove the probe** once the results are recorded: delete `public/probe/`, its script hash from the CSP and the `/probe/` cache headers in `firebase.json`, and its cases in `tests/hosting/hosting.test.ts` and `e2e/hosting.spec.ts`.
- [ ] **Deploy the stock Worker**, following "Owner setup" in [worker/stock/README.md](../../worker/stock/README.md) (Cloudflare account, the Stage 0 spike, the KV namespace id, the lockfile, the two Cloudflare secrets), record the terms review in its table, and **set the `VITE_STOCK_API` repository variable**. Then delete `src/services/market/interim.ts` and return the stock budget in `scripts/check-bundle.mjs` to 12 kB.
- [ ] **Redirect the apex domain** `vesen.app` (and `vesenterminal.web.app` and `vesenterminal.firebaseapp.com` if you can) to `https://www.vesen.app` in the Firebase console. The page already moves visitors there itself (`src/platform/hosts.ts`), but a server redirect is faster and keeps one origin for storage.
- [ ] **Protect `main`** in GitHub's branch settings and require the CI `check` job to pass before merging.
- [ ] **Edit `/home/has`**, the owner's read-only portfolio files, in `src/vfs/seed.ts` (and `src/content/` for the styled documents), so `ls ~has`, `cat` and `finger has` say what you want.
- [ ] **Review PR #3 on its preview channel** with the phone checklist in [CONTRIBUTING.md](../../CONTRIBUTING.md), merge it, and push the tag `v2.0.0` (`release.yml` creates the GitHub release). The old `latest` tag still points at v1.1.0; delete or move it if it is not used.
- [ ] **Delete the merged remote branches** `UI`, `demo`, `refactor`, `GUI` and `features-grep` if you no longer want them (grep was rebuilt in wave A1, so `features-grep` is not needed).
- [ ] **Turn on private vulnerability reporting** (Settings → Code security), which [SECURITY.md](../../SECURITY.md) points to, or remove that line.
- [ ] **Decisions the waves left open:** whether `git log` and `git show` should print author e-mail addresses (they show names only); whether `ifconfig` should ask Cloudflare for the public address or leave that to `ip addr`; the `helpRank` choices and the one-line Fun row on phones; whether to run a fetch proxy for `curl --via-proxy` (`VITE_FETCH_PROXY`).

## Follow-ups

### Review findings not yet fixed

The Phase 5 review found 33 problems; 18 are fixed, 2 in part, and these 15 remain. Each has a concrete fix in the review's report.

| Severity | Finding | Where | Fix |
|---|---|---|---|
| high | Back while the pager, `nano`, `cmatrix` or `sl` is open leaves vesen, and loses an unsaved `nano` buffer | `src/ui/AppHost.svelte` | Move `QrPresenter`'s history entry into `AppHost` for every app: push an entry on open, close the app (the editor asks to save) on `popstate`, and go back when it closes normally |
| medium | Art blocks (`figlet`, `cowsay`, and through `xargs`) are not counted against the screen caps, so one line can put tens of MB of art in the page | `src/shell/streams.ts` (`TtySink.block`) | Count each block's plain size against the caps, and cap the message `figlet` and `cowsay` accept |
| medium | Whole-input readers (`sort`, the checksums, `base64`, `column`, `diff`, `figlet`, `cowsay`, `bc`, `tail -c`) read standard input with no size cap | `src/commands/lib/text-input.ts` | One capped `readAll` (say 16 MB) that closes the pipe and fails with "input too large", used everywhere `stdin.text()` reads a whole operand |
| medium | `figlet -w` (with `-c` or `-r`) takes any width and can allocate hundreds of MB | `src/commands/more/fun/figlet.ts`, `src/commands/lib/block-font.ts` | Bound it as `nl -w` now is (fixed), and check the other numeric width options |
| medium | Tab and the chips offer flag values as operands (`ping 10`, `host TXT`, `dig 1.1.1.1`) | `src/shell/complete/sources.ts` (`operands`) | Skip the word after a flag that takes a value, and `+`/`@` words for dig |
| low | `less +G`, `+N` and `+/pattern` are read as files, and `less` into a pipe adds `more`'s `::::` banners | `src/commands/more/editor/less.run.ts` | The pager can already open at a position (`PagerView.start`, `pagerStart` in `src/lib/pager.ts`); pass leading `+CMD` words to it, and write banners only for `more` |
| low | `ping` lets IPv4-mapped IPv6 addresses (`::ffff:192.168.1.1`) past the private-address check | `src/commands/lib/dns.ts` (`isPrivateAddress`) | Apply the IPv4 rules to an embedded IPv4 address; add multicast and reserved ranges |
| low | After ^C or Stop, `^C` appears below `ping`'s statistics instead of above | `src/shell/index.ts` | Mark where the output was when the interrupt arrived and put `^C` there |
| low | A first Tab on a catalogue command before the catalogue arrives rings the bell and does nothing | `src/ui/prompt/promptController.svelte.ts` | With nothing to show, wait for the catalogue for the full wait, or press Tab again when it arrives |
| low | `nano`'s touch prompt row squeezes its buttons and wraps its label | `src/ui/apps/Editor.svelte` | `flex: none` on the buttons and label, and a visible field underline |
| low | `nano`'s bar offers ^W, which closes the tab on Windows and Linux | `src/lib/nano.ts`, `Editor.svelte` | Show ^F for Where Is off a Mac |
| low | `ip route get ADDRESS` gives a misleading "is a garbage" error | `src/commands/more/network/ip.run.ts` | Answer with the synthetic route, and use iproute2's "Command is unknown" for other verbs |
| low | `timeout` and `nohup` report a missing command as `command not found` | `src/commands/more/shell/timeout.run.ts`, `nohup.ts` | "failed to run command 'X': No such file or directory", status 127 |
| low | `date` has no `-d` | `src/commands/system/date.ts` | Parse with `parseDate` from `src/commands/lib/datespec.ts`, as `touch -d` does |
| low | `figlet -f FONT` is refused | `src/commands/more/fun/figlet.ts` | Accept the embedded font's name and `standard`; "Unable to open font file" for others |

The review fixes also lack direct regression tests for some of what they changed: `ps` formats and `-o`, `dig ANY`, `--version`, `tree -p -s -h`, `chown -h`, `whois -h`, `wget`'s saved line and `git clone`. Transcripts cover `cal` and the `ps` errors.

### Other follow-ups from the phase reports

- **Kernel headroom** is 2.8 kB. Further kernel growth should move more inline bodies to `.run.ts` (the largest left are `cat`, `theme`, `keys`, `cd`, `echo` and `history`).
- **Registry hints are stale:** `NOT_YET` and `ELSEWHERE` in `src/shell/registry.ts` still say `grep`, `less`, `ps` and others "isn't in vesen yet" and that vesen has no editor. They show only when the catalogue fails to load, but read wrong; trim them to `awk`, `htop` and the like, and point `htop` at `top`.
- **`/proc` and `ps` disagree:** `/proc/1` describes vesh while `ps` shows init as pid 1 and vesh as 4242, and `tty` prints `/dev/pts/0`, which is not in the VFS.
- **Test stand-ins** for `head`, `wc` and `yes` in `src/testing/shell-harness.ts` could go now that the catalogue loads in most tests.
- **`yes` or a huge `seq`** typed alone runs until ^C or the 15 s budget; a terminal-only stop could be friendlier.
- **`find` lists in the VFS's own order**, as GNU find does, which shows some folders in reverse; a sorted listing may read better.
- **One time per file:** the VFS keeps only `mtime`, so `touch -a` changes nothing and `find -atime`/`-ctime` use `mtime`.
- **`date.run.ts` has its own zone logic**; it could reuse `zoneOf` from `src/commands/lib/sysread.ts`.
- **Transcripts for the data commands:** `curl`, `fastfetch`, `weather`, `stock` and `qr` lost their cross-width goldens in Phase 5.1; each has its own tests, but transcripts at 40, 80 and 120 columns would pin their layout.
- **Browser tests for `dig` and `ping`** with `page.route`, to pin DNS over HTTPS and `no-cors` timing in WebKit.
- **Pager and editor polish:** make `man`'s EXAMPLES and SEE ALSO tappable in the pager; `nano`'s cut, paste and tab reset the textarea's undo history.
- **Load-sensitive tests:** a few smoke tests (QR `route.fulfill`, the head and theme reload check on iPhone) and some unit tests have failed once under heavy machine load and passed on a rerun.
