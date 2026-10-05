# Audit of vesen

This audit covers `main` at commit 23758b9 (the build live on www.vesen.app on 5 October 2026). It was produced by ten parallel auditors, each with one lens, whose 259 raw findings were merged into 97. Every high and medium finding that asserts a checkable fact was then given to three independent verifiers who tried to refute it: one read the code, one reasoned about browser and Svelte runtime behaviour, and one tried to reproduce it. A finding survives only if most verifiers fail to refute it. The verifiers also corrected severities, and those corrected severities are what this document uses.

Nothing in this audit was tested on a physical phone or inside the Instagram app. Phone behaviour was checked in an emulated 375 px viewport and reasoned from WebKit and Chromium documentation. [04-phone-and-instagram.md](04-phone-and-instagram.md) begins with a device probe for exactly this reason.

## Results at a glance

| Severity | Confirmed | Not verified | Design judgement | Refuted |
|---|---|---|---|---|
| high | 2 | 0 | 3 | 0 |
| medium | 25 | 23 | 6 | 0 |
| low | 20 | 16 | 1 | 1 |

No finding remained critical after verification. Two remain high, and both are about the network commands: the stock and curl proxies are dead or unreliable, and nothing ever times out, so a phone visitor can be stuck behind a spinner with no way to cancel.

## Checked by hand on the live site

These were reproduced directly on www.vesen.app before the agents ran, so they do not depend on any agent's reasoning.

| What was typed | What happened | Finding |
|---|---|---|
| `ls /home` | Lists `user/ projects/ desktop/ … bin/ src/ scripts/ config/`. The home folder's contents are siblings of `user` instead of inside it. | F003 |
| `ls -a` (in `~`) | Shows only `README.md history.txt documents/`. No dotfiles, because `.bashrc` and friends are in `/home`. | F003 |
| `cat /home/src/main.c` | Prints `#include ` with `<stdio.h>` missing. The browser parsed it as an HTML tag. | F004 |
| `echo <b>bold-via-echo</b> plain` | Prints `echo: cannot create 'bold-via-echo'`. The `>` inside the tag was treated as a redirect. | F004, F040 |
| `cd /etc` then `pwd` | `pwd` prints `/etc`, but the prompt still reads `guest@www.vesen.app:~$`. | F023 |
| `rm -rf hosts` | Prints `rm: cannot remove '-rf'`. Clustered flags are read as a file name. | F017 |
| `echo "a" "b"` | Prints `a" "b`. | F040 |
| `stock AAPL` | Took more than 10 seconds behind a disabled input before the card appeared. | F038, F047 |
| Typing `wea` at 375 px | Shows `Suggestions: weather` as plain text that cannot be tapped. | F067 |

## Findings by area

Each entry gives the corrected severity, the verified description (for confirmed findings this is the verifiers' own restatement, which is more precise than the original claim), the fix, and the roadmap phase that resolves it. Phases are defined in [README.md](README.md#roadmap).

### Security

**F004 · medium · confirmed · phase 1.** User-typed text reaches {@html} unescaped: self-XSS via echo, cat, ls, history, suggestions and error messages. `src/components/History.svelte:20`

- Verified: All command output and the suggestion row are rendered with {@html} and nothing but curl/speedtest escapes, so user-typed text reaches the DOM raw: shipped VFS files render wrong (`cat main.c` drops `<stdio.h>`, `cat index.html` renders as a heading), echo truncates on any `<x`, and a user can self-XSS via `history`, via echo-redirect plus `echo > >> f` then `cat f`, or via an unknown-command error (`<img/src/onerror=...>`); the direct `echo <img onerror>` vector does not fire because `>` is parsed as a redirect. Self-XSS only (no URL-driven input, no persistence, no credentials): severity medium, driven by the correctness defect rather than security impact.
- Fix: One escapeHtml in src/utils/html.ts applied by default; move to a {kind:'text'|'html'} output model where only owner-authored markup is 'html'; flag the three public files as html; add a test feeding `<img src=x onerror>` through echo/cat/ls/history.

**F005 · medium · confirmed · phase 1.** Third-party response text (wttr.in, Yahoo via proxy, ipify, WebGL renderer) injected into {@html} unescaped. `src/utils/commands/network.ts:85`

- Verified: weather (network.ts:50-98), stock (network.ts:256-258, 366-369, 391/411 volume, 445 JSON.parse error echo) and fastfetch's ipify IP (system.ts:447-452, 569-571) interpolate third-party response strings unescaped into HTML rendered via {@html} (History.svelte:20) with no CSP, unlike curl and speedtest which already escapeHtml; a compromised wttr.in/allorigins/ipify can run script in the vesen.app origin for the visitor who ran the command, but the origin has no credentials, cookies or persisted history to steal, and the WebGL renderer string is local, not remotely controlled, so severity is medium.
- Fix: escapeHtml the body immediately after .text() before any regex; escape and length-cap symbol/companyName/ip; build fastfetch rows from escaped values.

**F006 · medium · confirmed · phase 0 (report-only) + 1.** No Content-Security-Policy or any security header is served. `firebase.json:2`

- Verified: firebase.json:1-16 has no `headers` block and httpd.conf:1 cannot add any, so apart from Firebase's default HSTS no CSP, frame-ancestors/X-Frame-Options, X-Content-Type-Options or Referrer-Policy is served; this matters because History.svelte:20 renders all output via {@html} and weather/stock/fastfetch interpolate unescaped third-party strings (network.ts:50-96, 367-369; system.ts:452-556), making a `script-src 'self'` CSP (verified to run the built app with no violations) a cheap backstop — a medium hardening gap, not high, given the static, unauthenticated, URL-input-free site.
- Fix: Add a headers block with CSP (script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src listing the API hosts; frame-ancestors 'none'), X-Content-Type-Options, Referrer-Policy, Permissions-Policy; mirror CSP as a meta for Docker; trial report-only first.

**F049 · medium · not verified · phase 3.** sudo turns the prompt into a real password field, buffers keystrokes into dead state, opens YouTube with no output, and poweroff needs no root. `src/components/Input.svelte:660`

- Fix: Keep type=text masked with CSS, realistic sudo flow (three attempts, sudoers message or rickroll as a printed link), intercept paste, add enterkeyhint=go, root-gate poweroff.

**F050 · medium · not verified · phase 4.** fastfetch sends every visitor to api.ipify.org and prints their public IP under the label 'Local IP'. `src/utils/commands/system.ts:448`

- Fix: Drop the row or gate behind `--net`, label 'Public IP', mask the last octet, memoise one timed trace call.

**F052 · medium · not verified · phase 0 (decision).** Analytics (when enabled) sends every command's full arguments to a third-party umami host, undocumented and with an env-controlled script tag. `src/utils/tracking.ts:11`

- Fix: Track only the command name and outcome; honour GPC/DNT; document the host and collection in README and .env.example; pin the script with integrity.

**F055 · low · confirmed · phase 0.** Release workflow uses an archived Node 12 action by mutable `@latest` tag with write permissions and overwrites a single 'latest' release. `.github/workflows/release.yml:21`

- Verified: Restated: release.yml:21 uses the archived, node12 marvinpinto/action-automatic-releases through the movable `@latest` tag with `automatic_release_tag: "latest"` (line 25). Each v* tag therefore deletes and replaces the single release on tag `latest`, which already lost the "Release v1.1.0" page (the git tags v1.0.0, v1.1.0 and v1.2.0 survive) and force-moves the `latest` tag. `packages: write` (line 14) is unneeded. This is mainly a release-history and maintenance defect with a small supply-chain-hygiene part, because the archived repo cannot be moved without being unarchived. Fix: use `gh release create "$GITHUB_REF_NAME" --generate-notes`, or a SHA-pinned softprops/action-gh-release; drop `packages: write`; delete the `latest` tag.
- Fix: `gh release create $GITHUB_REF_NAME --generate-notes` or softprops/action-gh-release pinned by SHA; delete the mutable latest tag; drop packages: write; add a CHANGELOG.

**F091 · low · not verified · phase 0.** themes.json and package.json live outside src/ and are imported relatively; the whole package.json (devDependency versions, author email) ships in the bundle. `src/utils/commands/system.ts:1`

- Fix: vite define __APP_VERSION__ from package.json; move themes to src/data/themes.ts `as const satisfies Theme[]`; generate docs/themes and test favicon presence.

### Network commands

**F038 · high · confirmed · phase 0 (hotfix) + 4.** curl and stock are dead end-to-end: every public CORS proxy in the cascade fails, so each call burns ~20 s then errors, and the proxies see every URL. `src/utils/commands/network.ts:134`

- Verified: curl and stock are currently non-functional end-to-end: every proxy in the cascade at network.ts:134-139 fails (allorigins 522 after ~19.5 s, corsproxy 403 keyless, cors-anywhere 403 opt-in, thingproxy no DNS), stock depends on allorigins alone (network.ts:236), and no fetch has a timeout, so each run locks the input for ~20 s before printing an error; the proxies also receive the full target URL, client IP and Referer. Severity high, not critical.
- Fix: Replace with one owned edge proxy (allowlist http(s), block private ranges, 8-10 s upstream timeout, body cap, strip cookies, rate limit) or Firebase rewrite to a function; delete the four URLs and proxy-specific branching.

**F047 · high · confirmed · phase 0 (hotfix) + 3.** No request ever times out; with the input disabled and no tappable cancel, one hung proxy locks the terminal permanently on phones. `src/utils/commands/network.ts:237`

- Verified: No fetch in weather/curl/stock/speedtest/fastfetch has a timeout (network.ts:47,143,237,466,521,544; system.ts:448) and abort() is only reachable via keyboard Ctrl+C (Input.svelte:194-215); with the input disabled (Input.svelte:305,667-668) and no tappable control, a stalled proxy locks the terminal on touch devices for as long as the proxy or the browser's own network timeout takes (tens of seconds to minutes, browser-dependent) or until a reload, which clears history (history.ts:5-7) — not literally permanent, and desktop is unaffected.
- Fix: fetchWithTimeout combining the user signal with AbortSignal.timeout (budgets 4-15 s), a tappable 44 px Stop chip and Escape alias, elapsed time in the spinner.

**F028 · medium · confirmed · phase 4.** speedtest transfers ~40 MiB down and ~1.3 MiB up per run with no warning, data-saver check or time bound, buffering each sample in memory. `src/utils/commands/network.ts:562`

- Verified: The opt-in speedtest always downloads fixed 5+10+25 MiB samples (network.ts:562), each buffered with res.blob() (:467), and uploads 1.3 MiB (:572). It has no time limit, no saveData or connection check, no note in the help text about data use, and no cancel on touch devices (Ctrl+C only, Input.svelte:194; input disabled at :676). On a slow link it can run for minutes, and the result is biased low by an unweighted mean (:568) that includes TTFB. This is medium (UX and accuracy), not high, because the data use is what a user would expect after typing 'speedtest' and the test is never offered unprompted.
- Fix: Time-bounded progressive sizes read via getReader(), light profile on saveData/2g-3g/coarse pointer with `speedtest --full`, print the budget before starting.

**F035 · medium · confirmed · phase 4.** stock trusts the proxy envelope blindly: no http_code check, JSON.parse on error bodies, `previousClose || 0` fakes a -100 % change, raw TypeErrors shown. `src/utils/commands/network.ts:243`

- Verified: stock (network.ts:237-243,444) never checks response.ok or allorigins status.http_code and has no timeout or retry. Proxy or Yahoo failures (429 text, null contents, a 522 without CORS headers) therefore reach the user as raw "SyntaxError: Unexpected token..." or "TypeError: Failed to fetch" text after about 20 s. The -100 % and missing-indicators claims are wrong: previousClose and indicators are present, and line 262 guards the zero case. The real missing-field bug is that Yahoo meta has no regularMarketOpen, so line 266 makes "From Open" always $0.00.
- Fix: Check response.ok and data.status.http_code, validate numbers with Number.isFinite, use chartPreviousClose fallback, map 429 to a friendly message, validate ticker regex.

**F065 · medium · design · phase 2 (net service) + 4.** No application-level caching or request de-duplication for any network command. `src/utils/commands/network.ts:236`

- Fix: memo(key, ttl, fn) with an in-flight promise map: weather 10 min, stock 60 s, IP per session, geocode 24 h; 30 s failure cool-down; 'as of' annotation.

### Bugs

**F001 · medium · confirmed · phase 1.** Unguarded localStorage access at module scope blanks the page when storage is blocked. `src/stores/theme.ts:86`

- Verified: theme.ts:85-87, history.ts:6-7 and cathode.ts:55-58 touch localStorage at module scope with no try/catch or validation; because main.ts:5 mounts only after its static import graph evaluates, a SecurityError (storage blocked) or an unparseable/wrong-shaped 'colorscheme' value throws before mount() and leaves #app empty with no message (reproduced against the built bundle). Fix must guard inside the stores; wrapping mount() alone cannot catch import-time failures.
- Fix: Add src/utils/storage.ts with try/catch-wrapped safeGet/safeSet/safeRemove and an in-memory fallback; parse inside the try, validate, fall back to defaults; wrap mount() to show a boot-error message.

**F017 · medium · confirmed · phase 2.** rm understands only a bare `-r` as the first argument, yet the suggestion row offers `rm -f <directory>` which always fails. `src/utils/commands/fileSystem.ts:247`

- Verified: rm only recognises `-r`/`--recursive` as args[0] and only ever removes one operand (fileSystem.ts:244-253). Any other flag (-f, -rf) is used as the path and fails with "cannot remove '-f'". A trailing `-r` (`rm x -r`) is silently ignored. The suggestion row offers `rm -f` after `rm -` (commandSuggestions.ts:148) and then lists only directories as `rm -f <dir>` (lines 151-159), which always fails. `rm -r ` gets no suggestions (line 162). Medium severity: visible UX bug, no data loss, and the default `rm` suggestions correctly offer `rm -r <dir>`.
- Fix: Shared getopt-style parseArgs with r/R, f, v, i and multiple operands, GNU messages, silent success; drive suggestions and Tab from the same spec.

**F051 · medium · not verified · phase 3.** whoami/repo/email/sudo rely on window.open without noopener, return-value checks or a tappable link, and any navigation away destroys the session. `src/utils/commands.ts:274`

- Fix: openExternal() with 'noopener,noreferrer' and null check; always print a real `<a target=_blank rel=noopener>`; location.href for mailto; `whoami` prints guest; linkify output.

**F057 · medium · not verified · phase 0.** docker-compose healthcheck execs curl against port 80 inside a FROM scratch image that has no curl and listens on 3000. `docker-compose.yml:9`

- Fix: Remove the healthcheck, or switch to an image with wget and probe http://127.0.0.1:3000/ with sane intervals; fix the image name.

**F069 · medium · not verified · phase 3.** History navigation: draft lost on Up, sudo lines never recorded, `history` omits itself and ignores arguments, no !!/!n/Ctrl+R. `src/components/Input.svelte:366`

- Fix: Push to history on Enter before execution with ignoredups, keep a draft slot, implement history N/-c/-d, event designators and reverse-i-search, persist as ~/.bash_history.

**F070 · medium · not verified · phase 0 (quick fix).** Echoed commands in the scrollback are truncated with an ellipsis instead of wrapping (about 22 chars on a 375 px phone). `src/components/History.svelte:41`

- Fix: `white-space: pre-wrap; overflow-wrap: anywhere`, drop the vw-based max-widths, two-line prompt on narrow screens.

**F002 · low · confirmed · phase 1.** Theme persisted as a full colour-object snapshot and never revalidated. `src/stores/theme.ts:99`

- Verified: src/stores/theme.ts:85-87,99-100 saves the whole Theme object, including the default, on every load and reads it back without matching it against themes.json. Returning visitors keep pre-edit colours after themes.json changes (several in git history), and a renamed theme (e.g. pinkRobin->petroica) gives a 404 favicon and no `theme ls` highlight. The fix is to save only the name and look it up on load, falling back to swamphen. The missing-field case has not happened, because the Theme key set has never changed.
- Fix: Persist only the theme name, resolve it against themes.json on load, fall back to the default when unknown.

**F020 · low · confirmed · phase 2.** `rm -r .`, `..`, `~` or `/` delete the cwd or an ancestor and leave currentPath dangling. `src/utils/commands/fileSystem.ts:255`

- Verified: `rm -r .` (or `./`) and `rm -r ..` delete the current directory or its parent without the refusal GNU rm gives, because resolvePath returns the cwd itself and fileSystem.ts:255-282 never compares the target with currentPath. Afterwards pwd shows a path that no longer exists, ls says "cannot access '.'", and the rm and cat suggestions are empty, until the user runs `cd /`, `reset` or reloads. `rm -r /` prints "No such file or directory" (fileName is undefined) instead of the preserve-root message. `rm -r ~` deleting home matches real GNU behaviour and is not a defect. The file system is an in-memory sandbox that is easy to recover, so this is low severity, not medium.
- Fix: Refuse '.'/'..' and '/' with GNU messages; mark cwd dangling when an ancestor is removed; make cwd a store so mutations validate in one place.

**F021 · low · confirmed · phase 2.** resolvePath only normalises `.`/`..` for relative paths; `cd /home/../etc` and `cat ~/../x` fail, and the walk loop is copied nine times. `src/utils/virtualFileSystem.ts:497`

- Verified: resolvePath (virtualFileSystem.ts:492-499) only handles `.` and `..` for relative paths, so `cd /home/../etc`, `cat ~/./README.md` and `ls ~/..` fail, and `mkdir ~/..` creates a directory literally named '..'. Tab completion (Input.svelte:71-87) has the same gap. The child-lookup walk is duplicated nine times (virtualFileSystem.ts:478, fileSystem.ts:85/160/211/262/299/341/428, Input.svelte:86), each with its own error handling. Severity is low: common relative navigation works.
- Fix: Pick a base ([] / HOME / cwd), run one normalising reducer for all cases, export getNode/getParentAndName and use them everywhere.

**F026 · low · confirmed · phase 4.** Weather colouriser regex chain never colours temperatures, double-wraps wind speeds, misses conditions and uses astral emoji without the `u` flag. `src/utils/commands/network.ts:86`

- Verified: Weather colouring in network.ts:85-95 is cosmetically wrong: temperatures are never coloured (wttr prints `15 °C` with a space); all 13 wind speeds are double-wrapped by the later km rule (line 90), so they show green with only `/h` blue; most real conditions (rain, mist, fog, snow) are missed; the NSEW rule never hits wind directions (wttr uses arrows) and only misfires on text like 'NSW' in the location line; and the emoji class without `u` would split surrogate pairs, though it never matches the ASCII-art (`T`) output. Severity: low.
- Fix: Escape first, then one tokenising pass with a single alternation and the u flag; better, render structured Open-Meteo fields.

**F027 · low · confirmed · phase 4.** speedtest measurements are not validated: Mbps from requested bytes without res.ok, AbortError swallowed into a sendBeacon fallback that reports fictitious upload speed. `src/utils/commands/network.ts:529`

- Verified: speedtest's upload measurement is unvalidated. The bare catch at network.ts:529 swallows AbortError and every other fetch error and falls back to measureUploadBeacon (:474-493), which only times queueing and so can print a made-up upload Mbps when the no-cors POST (:521-528, status hidden) fails while download and latency succeed. On Ctrl+C it sends a few beacons after the user cancelled, but cancellation still completes at :544/:602. The "unavailable" branch (:588-590) is effectively unreachable. Download (:466-470) uses the requested size and skips res.ok, but that is latent only: the sizes requested always return 200, and the 403 lacks CORS headers, so the browser rejects the fetch instead of reporting 2600 Mbps.
- Fix: Rethrow AbortError, delete the beacon fallback, use plain CORS fetch with res.ok and streamed byte counting, report 'unavailable' on failure.

**F031 · low · confirmed · phase 2.** Command table and VFS children are plain objects, so `constructor`, `toString`, `__proto__` behave as existing commands/files (prototype pollution of the directory map). `src/utils/commands.ts:341`

- Verified: The command table and VFS `children` maps are plain objects, so inherited names pass the truthiness checks (commands.ts:341; fileSystem.ts:85/160/211/262/299/312/354/428). As a result, `constructor` runs `Object()` and prints an empty line, `touch __proto__` says "timestamp updated" without creating anything, and `rm constructor` falsely says "removed". `mkdir __proto__` only reports "File exists" (:354); it is `echo x > __proto__` (:440, :451) that replaces one directory map's prototype, leaving a file hidden from `ls`, with no global `Object.prototype` pollution. Fix with `Object.create(null)` or a `Map` plus `Object.hasOwn`. Severity: low.
- Fix: Use Map or Object.create(null) plus Object.hasOwn; validateName() rejecting '', '.', '..', '/'.

**F036 · low · confirmed · phase 4.** stock hard-codes `$`, ignores meta.currency, mixes font sizes and draws a label column as the 'OHLC chart'. `src/utils/commands/network.ts:372`

- Verified: stock ignores meta.currency and prints a literal "$" with 2 decimals for every ticker (network.ts:372, 384-389, 396-397, 412-417, 424-425), so non-dollar tickers such as 7203.T (JPY) and BTC-GBP are mislabelled (AUD's "$" is only ambiguous). The price span uses a stray 1.1em size (372), which is inconsistent but alone on its line. The desktop info column is fixed at 380 px (410). The "OHLC Chart" is a single column of labels and "│" characters (331-359), and the fetched `quote` series (254) is unused. These are cosmetic display issues in a command whose proxy usually times out anyway.
- Fix: Intl.NumberFormat with meta.currency, one font size, grid layout, a real sparkline from closes.

**F040 · low · confirmed · phase 2.** echo mishandles quotes, escapes and flags: `echo "a" "b"` prints `a" "b`, -n/-e unsupported, bare echo prints help. `src/utils/commands/fileSystem.ts:374`

- Verified: echo (fileSystem.ts:374-477) is not shell-accurate. Quotes are removed only around the whole joined string (465-468), so `echo "a" "b"` prints `a" "b` and repeated spaces inside quotes collapse. -n/-e/-E are not parsed. Escape sequences are always processed (415-418, 471-474). A bare echo prints help (375-377). A `>` inside quotes is treated as redirection (387-405), so `echo "5 > 3"` writes `"5` to a file named `3"`. These are low-severity bugs: the documented examples work and the filesystem is in-memory.
- Fix: After the tokenizer exists: parse -n/-e/-E, join words, escapes only under -e, return plain text; redirection handled by the executor.

**F008 · low · not verified · phase 2.** README.md/history.txt/linux.txt are fetched at runtime via dead fallbacks and accept the SPA fallback as file content. `src/utils/commands/fileSystem.ts:24`

- Fix: Import the three documents at build time (`?raw`) into the VFS seed; if fetching stays, check content-type and throw so cat prints a proper I/O error.

**F029 · low · not verified · phase 3.** poweroff's DOM selector matches nothing, the input is re-enabled by Input's finally, window.close() is a no-op and body.innerHTML is replaced with no recovery. `src/utils/commands/fileSystem.ts:515`

- Fix: Model shutdown as a powerState store rendered by App with a 'press any key to reboot' screen; remove DOM surgery and window.close().

**F033 · low · not verified · phase 0.** Two `reset` implementations: the fileSystem one is dead by spread order, and reset seeds commandHistory with 'banner' and wipes files unlike real reset. `src/utils/commands.ts:116`

- Fix: Delete the dead copy; make reset only clear and redraw; move destructive reset behind an explicit command; never seed 'banner'.

**F054 · low · not verified · phase 4.** User input is spliced into upstream URL paths without encoding (wttr.in city, Yahoo ticker, cors-anywhere URL) and errors are detected by substring. `src/utils/commands/network.ts:47`

- Fix: Build URLs with new URL()/searchParams and encodeURIComponent per segment, validate tickers, keep the user's original string for messages.

**F090 · low · not verified · phase 0.** Version is hand-duplicated: /etc/os-release says v1.0.0 while banner and fastfetch read 1.2.0. `src/utils/virtualFileSystem.ts:43`

- Fix: Interpolate a single __APP_VERSION__ define everywhere and assert agreement in a test.

### Phone experience

**F012 · medium · confirmed · phase 1 + 3.** Input is disabled while processing: keystrokes dropped, iOS keyboard closes after every command, dead displayValue and invalid :readonly rule. `src/components/Input.svelte:305`

- Verified: Input.svelte:305/667-668 disables the focused input while a command runs. For the commands that wait on a fetch or async work (cat, weather, curl, stock, fastfetch, speedtest), the field loses focus (seen in Chromium) and keys typed meanwhile are lost. The re-focus at 355 runs after the await, so on iOS the keyboard probably stays closed until the user taps (inferred, not device-tested). Synchronous commands (help, ls, theme, etc.) are not affected. Separately, displayValue (39-48) is dead code and `input:readonly` (701) is an invalid selector that ships but is ignored by the browser. Severity: medium.
- Fix: Never set disabled; keep readonly/aria-busy (keys are already ignored at 238-240); delete displayValue; use a class or :read-only.

**F016 · medium · confirmed · phase 1 + 3.** Layout is frozen into output HTML from window.innerWidth at execution time; desktop output never wraps and nothing reflows on resize or rotation. `src/components/History.svelte:19`

- Verified: Layout is fixed from window.innerWidth when each command runs (History.svelte:19, textWrap.ts:135-146, mobile.ts:13, network.ts:69/304, system.ts:573, commands.ts:28) and never recalculated. Rotating a phone after load leaves 280-311 px wrappers inside a 16px-font terminal, which breaks up the banner (measured: 8 lines became 20). Rotating from landscape to portrait clips desktop-path output with no way to scroll to it. A landscape phone wider than 768 px takes the white-space: pre path. The 125-column wttr.in table makes main scroll sideways below roughly 1260 px wide (iPads, landscape phones, narrow windows) but not at 1280 px or wider. Desktop text never wraps except curl output (network.ts:199).
- Fix: Use `white-space: pre-wrap; overflow-wrap: anywhere` on .command-output at all widths, an `.art` class with its own overflow-x:auto for tabular blocks, container queries/`(pointer: coarse)` instead of JS width checks; delete textWrap.ts/mobile.ts.

**F067 · medium · confirmed · phase 3.** Suggestion row is inert {@html} text: not tappable, not arrowable, not announced, appears on the first keystroke and reflows the page; every power feature is keyboard-only on phones. `src/components/CommandSuggestionsRow.svelte:62`

- Verified: The suggestion row (CommandSuggestionsRow.svelte:55-62) is a non-interactive {@html} block of newline-joined text. It has no buttons, ARIA or live region, and it cannot write a choice back because App.svelte:85 passes a one-way {command} prop. It appears on the first keystroke and makes the scroll jump to the bottom and back (App.svelte:19-37). History recall (Input.svelte:366-380), Tab completion (381-613) and aborting a running command (Ctrl+C, 194-228, the only abort path) exist only as keydown branches. Phone visitors therefore cannot tap a suggestion, recall a command, complete one or cancel a slow command, though `clear` covers Ctrl+L. This is a medium mobile-UX gap, not a high-severity defect.
- Fix: Chip bar of `<button role=option>` (min 44 px, horizontally scrollable) above the prompt fed by the completion engine, pointerdown preventDefault to keep the keyboard, history chips when empty, a Stop chip while processing; aria-controls/aria-activedescendant on the input; fish-style ghost text on desktop.

**F076 · medium · confirmed · phase 1.** App is sized with 100vh, no visualViewport/keyboard handling, no safe-area insets: prompt and suggestions sit under mobile toolbars and the soft keyboard. `index.html:13`

- Verified: #app uses 100vh (index.html:13) with no dvh, visualViewport or interactive-widget handling. On mobile with the toolbars showing, the bottom of the terminal can slip below the visible area (partly offset by the mount-time scrollIntoView at Input.svelte:170), the page double-scrolls with main, and the suggestion row placed after the input (App.svelte:85) is hidden under the soft keyboard. The loading line is not affected, because the input is disabled while processing (Input.svelte:305/667), which closes the keyboard. Toolbars can still collapse, and landscape letterboxing is the safe default, not a bug. The body font rules (app.css:46-77) are dead code, a cleanup item only. Fix: use h-dvh with a vh fallback, or a visualViewport-driven height, and add overscroll-behavior: contain.
- Fix: h-dvh with vh fallback, interactive-widget=resizes-content and viewport-fit=cover, visualViewport resize/scroll listener setting #app height, chips and loading line above the prompt, env(safe-area-inset-*) padding, overscroll-behavior: contain; delete dead body font rules.

**F048 · medium · not verified · phase 4.** QR is theme-coloured half-blocks with no quiet zone; the mobile `pre { white-space: pre-wrap !important }` rule wraps rows and corrupts codes wider than ~43 modules. `src/utils/commands/qr.ts:97`

- Fix: Render the matrix as inline SVG, always black-on-white with a 4-module quiet zone, `--ascii` option exempt from the pre rule; delete the blanket pre rule.

**F011 · low · confirmed · phase 1.** Window-wide click handler refocuses the input, scrolling to the bottom and re-summoning the phone keyboard on every tap. `src/components/Input.svelte:649`

- Verified: Input.svelte:645-651 calls input.focus() without {preventScroll:true} on any window click that leaves no selection. If the input was blurred (keyboard dismissed, or a click on scrollback text), a tap or click in the scrollback jumps main (App.svelte:70-72) back to the prompt and, on phones, brings the keyboard back. Verified live: scrollTop went 200 -> 1250. The keyboard can still be dismissed and output read by scrolling, since scrolling fires no click. It does not happen when the input already has focus, or while a command is running and the input is disabled.
- Fix: focus({preventScroll:true}) only for pointerType 'mouse' or clicks inside the prompt row; let taps on the scrollback blur on touch.

### Desktop experience

**F010 · medium · confirmed · phase 1.** Four competing auto-scroll paths: 10 Hz spinner effect pins the view to the bottom and suggestion show/hide restores stale scrollTop. `src/App.svelte:50`

- Verified: While a slow command runs, the App.svelte:50-56 effect follows the spinner's loadingText, which Input.svelte:622-628 rewrites every 100 ms, so it forces scrollTop to the bottom 10 times a second and the user cannot scroll back. Separately, the save/restore in App.svelte:19-37 and the smooth scroll on history change in Input.svelte:175-189 cause a small up-then-down jump, about one suggestion row tall, on Enter or Ctrl+C. This happens only when the suggestion row is still visible: commands with arguments like `weather Oslo`, `curl explainshell.com` and `cat README.md`, or bare theme/weather/cd/cat. The finding is wrong that this happens on every Enter or keystroke. The effect at Input.svelte:159-172 runs only once at mount. createEventDispatcher is deprecated but works. Fix: one scroll-to-bottom helper that only scrolls when the view is already near the bottom, and no loadingText dependency.
- Fix: One scrollToBottom helper in App keyed on history length/isProcessing, instant (reduced-motion aware), only when already within ~40 px of the bottom; delete save/restore logic and the loadingText dependency; use callback props.

**F014 · medium · confirmed · phase 0 (quick fix) + 3.** Ctrl+C always preventDefaults, so selected text cannot be copied on Windows/Linux. `src/components/Input.svelte:194`

- Verified: Input.svelte:194-195: the window-level keydown handler (bound at :652) calls preventDefault on every Ctrl+C without checking window.getSelection(). On Windows/Linux this blocks keyboard copying of selected terminal output or input text, and it adds a blank or echoed prompt line to history instead (:217-226). Right-click Copy and Ctrl+Insert still work, and macOS Cmd+C is unaffected. Fix: return early without preventDefault when a selection exists.
- Fix: Return early (no preventDefault) when window.getSelection()?.toString() is non-empty; add Ctrl+Shift+C/V; print ^C instead of a blank entry.

**F022 · medium · confirmed · phase 3.** Tab completion is a 230-line per-command ladder that cannot complete ~/ or ../, skips ls/mkdir/echo, completes a non-existent `nano`, and is silent on ambiguity. `src/components/Input.svelte:389`

- Verified: Tab completion (Input.svelte:381-614) is a per-command ladder with eight copies of the common-prefix reduce. Its path completer (Input.svelte:51-110) bypasses resolvePath, so `~/` and `../` never complete. Path completion is limited to cd/cat/rm/touch plus a dead `nano` entry, so ls/mkdir/echo get none. cd is offered files, a unique match gets no trailing space, and there is no Tab-Tab listing, cycling or bell. The live suggestion row (commandSuggestions.ts) partly covers ambiguity at the current-directory level, but it uses a different vocabulary (directories only for cd, its own qr examples, an unsupported `rm -f`). This is a medium-severity UX and maintainability issue, not high.
- Fix: One complete(line, cursor) engine in src/shell/completion.ts driven by per-command specs and the normalised resolvePath, returning {replacement, candidates}; Tab-Tab lists, Shift+Tab cycles, bell on zero; the suggestion row and mobile chips render the same candidates.

**F046 · medium · confirmed · phase 3.** Readline basics are missing: Ctrl+R reloads and wipes the session, Ctrl+U/K/A/E/D/W go to the browser, no ^C echo, draft lost on Up. `src/components/Input.svelte:231`

- Verified: Only Ctrl+C and Ctrl+L are handled (Input.svelte:194, :231). On Windows/Linux, Ctrl+R reloads and wipes the session, which is cleared deliberately at history.ts:6-7. Ctrl+D, Ctrl+U and Ctrl+K trigger browser actions, Ctrl+A selects the input, and Ctrl+W closes the tab; a page cannot intercept Ctrl+W. macOS already has native Ctrl+A/E/K/D line editing. Ctrl+C prints no ^C, so an interrupted line looks like it ran (:219-220). The draft line is lost on ArrowUp/Down (:366-378). Fix: intercept Ctrl+R/U/K/A/E/D, plus optional Ctrl+W/Y and Alt+B/F, Escape and reverse-i-search. Append ^C to interrupted lines and save the draft at historyIndex -1. Persist history only if the author wants to reverse the 'fresh start' design.
- Fix: Keymap with Ctrl+A/E/U/K/W/Y, Alt+B/F, Ctrl+R reverse-i-search, Ctrl+D exit, Escape clear, Shift+PageUp/Down; print `^C`; persist command history.

**F013 · medium · design · phase 2 + 3.** Loading state is a generic 'Processing...' line with no context or cancel hint; failures print raw JS error objects; the typed line is not committed on Enter. `src/components/Input.svelte:626`

- Fix: Push the entry on Enter with a pending spinner in its output slot, a generic progress store with per-command labels and elapsed time, a describeError() mapper and one notice() helper.

**F074 · medium · not verified · phase 3.** Banner does not say whose terminal it is or teach Tab/Up/help; the version wraps onto its own line at 375 px. `src/utils/commands/system.ts:596`

- Fix: `.art` block for the logo, a meta line 'vesen v1.2.0 - Has Salvesen's portfolio terminal', a keys line, `type help` placeholder, narrower logo under 480 px.

**F015 · low · confirmed · phase 3.** help/ls/history column maths assume 8 px per character, so help overflows horizontally on 770-1170 px windows. `src/utils/commands.ts:26`

- Verified: help (commands.ts:26-36,48), ls (fileSystem.ts:113-132) and history (commands.ts:60-66, capped at 100 and wrap-only) size their text assuming 8 px per character and innerWidth − 40. Above 768 px the output is 16 px monospace (≈9.6 px per character, History.svelte:69-73) inside a content box of innerWidth − 68 (index.html:13, App.svelte:72). As a result, the `white-space: pre` help grid overflows from about 769 to 1156 px (113 characters ≈ 1088 px at 1024 px), and `ls /` overflows from 769 to 915 px. main's overflow-auto then shows a horizontal scrollbar, and the last column is pushed past the right edge until you scroll. Fix it by laying help/ls out with CSS grid using ch units, or by measuring one ch against main.clientWidth.
- Fix: Render help/ls as CSS grid (repeat(auto-fill, minmax(12ch,1fr))) or measure one 'ch' once and derive columns from main.clientWidth.

**F042 · low · confirmed · phase 2.** `help` is a bare name grid: commandDescriptions is imported but never used, `help <unknown>` silently prints the grid, no man. `src/utils/commands.ts:18`

- Verified: `help` (commands.ts:18-48) prints a flat alphabetical grid of 26 bare names, although helpText.help (helpTexts.ts:3) promises categories and `commandDescriptions` (helpTexts.ts:83-110) is imported at commands.ts:12 but never used. `help <unknown>` silently falls through to the grid (commands.ts:22) instead of reporting an error. Per-command help exists through `help <cmd>` and `<cmd> --help` (commands.ts:22-23, 336-337), but neither the grid nor the banner (system.ts:597) mentions it, and the names in the grid cannot be tapped (History.svelte:20).
- Fix: Grouped `name  description` rows from the command specs, 'no help topics match' error, `man <cmd>`, tappable names on touch.

**F075 · low · design · phase 2.** `theme ls` is a comma list with an off-site link instead of inline palette swatches. `src/utils/commands.ts:161`

- Fix: One row per theme with eight swatch spans and a background chip, `theme preview <name>`, chips in the suggestion row.

### Accessibility

**F068 · medium · confirmed · phase 1.** Theme palettes fail WCAG contrast for core UI roles: cockatoo body text 2.46:1, suggestions 1.6-2.8:1 on 7 of 10 themes, errors and prompt segments below 3:1; swamphen's yellow/blue are red/orange. `themes.json:33`

- Verified: Several opt-in palettes fail WCAG contrast for UI roles that reuse ANSI slots. On cockatoo, the `white` role is 2.46:1 and is used for the input, banner, ls names, fastfetch values and help text, while main foreground output is fine at 8.41:1. Suggestion items (brightBlack) are 1.6 to 2.8:1 on 7 of 10 themes, and red errors fall below 3:1 on kangaroo, treefrog and wombat. The default swamphen theme passes apart from red at 3.75:1, but its yellow and blue slots are red and orange, so prompt, headings, weather and errors all share one red. cursorColor is never used.
- Fix: Semantic role tokens per theme (fg, fg-strong, muted, accent, error, warn, ok, link, cursor) exported by updateCSSVariables and used everywhere instead of ANSI names; a scripts/check-contrast CI gate at 4.5:1; fix the failing hex values.

**F077 · medium · confirmed · phase 1.** Viewport disables pinch zoom to mask 11-12 px phone text (WCAG 1.4.4 failure on WKWebView/Android). `index.html:6`

- Verified: index.html:6 sets maximum-scale=1.0 and user-scalable=no only to stop iOS from zooming in on focus of the 12 px input (Input.svelte:674; commit de82b03). This blocks pinch zoom on Android Chrome and in in-app WebViews, so it fails WCAG 1.4.4 under the ACT rule, while every output renders at 11.2 px on screens 480 px and narrower (History.svelte:92-95 via textWrap.ts:29) and the prompt and input are 12 px. That is two sizes, not three. Fix: remove the zoom lock and make the input at least 16 px on coarse-pointer devices.
- Fix: Remove the zoom lock; one --term-fs clamp(14px,3.8vw,16px) token on main; input >= 16 px under (pointer: coarse); touch-action: manipulation.

**F094 · medium · confirmed · phase 1 + 3.** Accessibility: the input has no accessible name, output has no live region, every prompt is an <h1>, and ASCII art/QR/swatches have no text alternative. `src/components/Input.svelte:655`

- Verified: Confirmed: the command `<input>` has no accessible name (Input.svelte:655-669, placeholder always ""). History output and `<main>` have no live region or role (History.svelte:8-24, App.svelte:70-74), so results are not announced. Every prompt, live and in history, renders as an identical `<h1>` (Ps1.svelte:10/14, History.svelte:11), so the h1 count grows with history. The banner, fastfetch swatches/logo and QR `<pre>` art are not aria-hidden and have no description (system.ts:530-534, 563-565, 591-596; qr.ts:97), though the QR does show its URL as text (qr.ts:96). Medium severity rather than high.
- Fix: aria-label/aria-describedby and enterkeyhint on the input, role=log aria-live=polite on history, aria-busy on main, Ps1 as span (label for the live row) with one visually-hidden h1, `<pre aria-hidden>` plus sr-only descriptions via an art(html, alt) helper.

**F095 · medium · not verified · phase 3.** Tab and Ctrl+L are trapped at window level with no keyboard route out of the page. `src/components/Input.svelte:382`

- Fix: Move keydown onto the input, preventDefault Tab only when a completion applied, let Ctrl+L through, restrict click-to-focus to main.

### Visual design

**F009 · medium · confirmed · phase 1.** ls, history, curl, speedtest, whoami, repo, echo and poweroff bake theme hex values inline, so old output does not re-theme. `src/utils/commands/fileSystem.ts:107`

- Verified: ls, history, curl, speedtest, whoami, repo, echo-redirect and poweroff interpolate get(theme) hex into 22 inline color styles (18 lines across fileSystem.ts, commands.ts, network.ts, system.ts) while the rest of the codebase uses var(--theme-*); because History.svelte:20 re-renders stored strings via {@html}, those outputs keep the previous theme's colours after `theme set`, e.g. swamphen's #ffffff file names become near-invisible on cockatoo's #e8ddd0 background. Cosmetic, scrollback-only, fixed by replacing currentTheme.<x> with var(--theme-<x>).
- Fix: Replace every currentTheme.<x> in command output with var(--theme-<x>) or semantic classes; ban get(theme) in renderers; delete updateThemeListHighlight/updateFastfetchThemeName in favour of reactive state.

**F061 · medium · not verified · phase 1.** Output font is the generic `monospace` keyword (Courier on iOS) while the bundled 648 kB Cascadia Code is never loaded; prompt, input and output use three stacks. `src/components/History.svelte:28`

- Fix: Subset to WOFF2 (~80-120 kB) with @font-face/preload or delete it; one --font-mono variable on main; remove every inline font-family.

**F064 · medium · not verified · phase 1.** No Open Graph/Twitter tags, theme-color, canonical or page background: shared links get a blank card, the gutter shows the browser canvas, apex and www both serve 200. `index.html:7`

- Fix: Add og:/twitter: tags with a 1200x630 image, theme-color updated from theme.ts, canonical, manifest; set body background and colorScheme from the theme's luminance; redirect apex to www.

**F073 · medium · not verified · phase 3.** No designed cursor or focus state: native caret with outline-none, theme cursorColor never exported, invisible first-run prompt on touch. `src/components/Input.svelte:658`

- Fix: Mirror the value into a span with a blinking block `.cursor` from --theme-cursor (hollow when unfocused, no blink under reduced-motion), caret-color transparent, main:focus-within outline; drop the phone gutter/frame and give the prompt row min-height 44 px with a 'tap to type' hint.

**F096 · medium · not verified · phase 1.** Seven different line-heights across prompt, input, outputs and suggestions; block-art rows show seams at desktop. `src/App.svelte:73`

- Fix: One --term-lh on main, `.art{line-height:1}` for logos/blocks/QR/charts, remove per-component overrides.

**F078 · low · not verified · phase 1.** ::-webkit-scrollbar styling forces a fixed light-grey 20 px/8 px bar that ignores the theme and has no Firefox equivalent. `src/app.css:6`

- Fix: `scrollbar-width: thin; scrollbar-color: var(--t-muted) transparent` on main; drop webkit rules on (pointer: coarse).

### Linux fidelity

**F003 · medium · confirmed · phase 0 (quick fix) + 2.** Virtual home is mis-nested: dotfiles, projects, bin, src live in /home instead of /home/user. `src/utils/virtualFileSystem.ts:205`

- Verified: Finding stands as written: the 'user' literal closes at virtualFileSystem.ts:205, so projects, desktop, downloads, pictures, music, videos, public, templates, bin, src, scripts, config and all six dotfiles (lines 206-435) are children of /home rather than /home/user; cat ~/.bashrc returns 'No such file or directory' and ls -a ~ shows no dotfiles. Fix: move the two closing braces at lines 204-205 to just before line 436 (adding a comma after the 'documents' entry at line 203) so the block is inside user.children; severity medium (fidelity/content defect, no crash or data loss).
- Fix: Move the closing braces so lines 206-435 sit inside user.children, or build the tree from a declarative path list with a mkpath helper.

**F018 · medium · confirmed · phase 2.** ls ignores -l, -la, -1, -F and extra operands, is unsorted, forces a `/` suffix and errors on a file operand. `src/utils/commands/fileSystem.ts:72`

- Verified: ls (fileSystem.ts:67-148) has no option parser. It recognises only the exact tokens -a/--all (:72) and silently drops every other flag (:75), including clustered -la/-al. It uses only the first operand (:80), rejects a file operand with "Not a directory" (:94-96), lists entries in insertion order (:104) and always adds '/' to directories (:108). Help only promises `ls [directory]` (helpTexts.ts:10). The -la effect only shows outside ~, because the dotfiles sit in /home rather than /home/user (virtualFileSystem.ts:383-435). Severity: medium, not high.
- Fix: Clustered short flags via shared getopt; -a -A -l -h -1 -F -r -t; localeCompare sort; multiple operands with headers; suffix only under -F/-p.

**F023 · medium · confirmed · phase 2.** Prompt always shows `~`: Ps1's currentDir is a constant, cwd is a mutable array, and history entries do not record their cwd. `src/components/Ps1.svelte:4`

- Verified: Confirmed, but medium rather than high. The prompt always shows `~` because Ps1.svelte:4 hard-codes `currentDir = '~'` and never reads the mutable non-store `currentPath` (virtualFileSystem.ts:472, changed in place by cd at fileSystem.ts:233-234). History entries (command.ts:1-4) store no cwd and History.svelte:11 renders `<Ps1 />` with no props, so pwd and the prompt disagree after any cd. Separately, the full `www.vesen.app` hostname takes about half of a 375 px line, where real bash `\h` would show only `www`.
- Fix: Make cwd a writable store, derive `~`/`~/x` in Ps1, add cwd to each history entry and pass it per row; use a short static host and collapse the prompt on narrow screens.

**F039 · medium · confirmed · phase 2.** No shell grammar: input is split on whitespace in two different ways, with no quoting, pipes, lists, redirection (outside echo), variables or globs. `src/utils/commands.ts:319`

- Verified: Input.svelte:262 splits on a single space without trimming, while processCommand (commands.ts:319) trims and splits on any whitespace, so the two disagree about the command name. With a leading space, sudo skips the fake password prompt (:269) and goes straight to commands.ts:105-113. A leading space also means curl/weather/stock/speedtest get no AbortController (:294-301), so Ctrl+C can't cancel them while the input stays disabled. Nothing parses quotes, so `mkdir "my dir"` creates `"my`. Echo's redirection is a plain string search (fileSystem.ts:380-411), so `echo "x > y" > f` writes `"x` into a file named `y"`. The features-grep pattern argument has the same problem. Fix: one shared tokenizer that handles quotes and trims, used by both Input and processCommand. Pipes, globs and variables are missing features, not defects, and no repo roadmap depends on them.
- Fix: src/shell/{tokenize,parse,expand,exec}.ts: POSIX-ish lexer, pipelines with redirects, env/alias/tilde/glob expansion, exit codes and &&/||; Input submits the raw line.

**F072 · medium · design · phase 5.** Missing command catalogue: no exit/man/alias/which/date and the first words a shell user types beep; .bashrc declares ll/la aliases that do not work; prioritised tiers 1-5. `src/utils/commands.ts:458`

- Fix: src/commands/{shell,text,files,sysinfo,net,crypto,fun,vesen}.ts exporting CommandSpec arrays with a group tag; source ~/.bashrc for aliases/env at start; FullScreenApp component for pagers/editors/top.

**F071 · medium · not verified · phase 2.** Command-not-found text and 'Did you mean' heuristic are un-Linux: `c` suggests cat, `lsblk` suggests ls, `exit` gets nothing, no exit 127. `src/utils/commands.ts:300`

- Fix: `bash: foo: command not found` in error colour with exit 127; Damerau-Levenshtein <= 2 over names and aliases, only for inputs >= 3 chars.

**F092 · medium · not verified · phase 5.** features-grep branch merges cleanly but adds a tenth VFS walk and a third escapeHtml, rejects clustered flags (-rn), always prefixes paths, uses JS regex instead of BRE/ERE. `src/utils/commands/fileSystem.ts:229`

- Fix: Rebase, port to CommandSpec with shared getopt and fs.walk, GNU prefix rules, BRE translation with -E/-F, colour, exit 0/1/2, stdin when pipes exist.

**F019 · low · confirmed · phase 2.** mkdir/touch/cat/rm take one operand, treat flags as names (`mkdir -p` creates '-p'), lack -p/-n, and print chatty success messages coreutils never print. `src/utils/commands/fileSystem.ts:334`

- Verified: Confirmed. In fileSystem.ts, cat, touch and mkdir use only args[0] (:155, :292, :334), and rm uses only args[0] or args[1] (:244-252). So flags such as -p, -f, -rf and -n are treated as file names: `mkdir -p foo` creates '-p', and `rm -rf x` looks for a file named '-rf'. Extra operands are silently dropped. Touching a directory gives an error (:313-314). With no operands the commands print help instead of "missing operand". Success messages that coreutils never prints by default appear at :284, :316, :326, :365 and :460. Fix: add a small flag parser (none exists yet; there is no parseArgs in the repo), loop over every operand, support mkdir -p, rm -f/-rf and cat -n, and stay silent on success. Severity is low, not medium: these only affect Linux realism in an in-memory demo, with no crash and no data loss.
- Fix: Route through parseArgs, iterate operands, implement mkdir -p, cat -n, touch on dirs, silent success with -v opt-in and GNU error wording.

**F024 · low · confirmed · phase 2.** Machine identity is inconsistent across prompt, home dir, passwd, fastfetch, /proc and whoami. `src/components/Ps1.svelte:15`

- Verified: Low (cosmetic, linux-fidelity): the machine identity contradicts itself. The prompt and /etc/config.conf say guest (Ps1.svelte:15, virtualFileSystem.ts:460), but the shell's home is /home/user (virtualFileSystem.ts:472,491). passwd lists both user (/home/user) and guest (/home/guest, a directory that does not exist) (virtualFileSystem.ts:49). fastfetch prints user@ and the visitor's own kernel (system.ts:525,540), while /proc/version claims Linux 5.15.0-vesen (virtualFileSystem.ts:41). whoami opens LinkedIn instead of printing a name (system.ts:10). Fix: share one identity constant across all of these and move LinkedIn to an about/linkedin command. Adding id or $HOME would be a new feature.
- Fix: Single identity module (guest, uid 1000, /home/guest, host vesen) read by prompt, passwd, $HOME, fastfetch and id; move LinkedIn to a `linkedin`/`about` command.

**F032 · low · not verified · phase 2.** `-h`/`--help` anywhere in the argument list hijacks the command (`echo say -h`, `qr -h`). `src/utils/commands.ts:321`

- Fix: Only intercept --help as first argument when the command's spec opts in; let -h keep per-command meaning.

**F041 · low · not verified · phase 2.** /proc files are generated once with Math.random (MemAvailable can exceed MemTotal), cpuinfo prints MacIntel, generateSystemContent runs seven times. `src/utils/virtualFileSystem.ts:39`

- Fix: Add a generator field for procfs nodes computed per read from a shared sysinfo module; populate /usr/bin from the registry; remove the dead copy.

### Code arrangement

**F037 · high · design · phase 1 (Worker) + 4.** Stock data-source plan: Yahoo-via-free-proxy cannot be made reliable; use an owned Worker with a keyed provider and cached fallback. `src/utils/commands/network.ts:236`

- Fix: Cloudflare Worker `/quote?symbol=` with origin check, 60 s edge cache, Finnhub primary and Yahoo fallback returning normalised JSON; client fetch with 8 s timeout and honest asOf/source.

**F060 · high · design · phase 4.** In-house weather design: Open-Meteo for data, alias table plus geocoder cascade for Gadigal/Aotearoa, structured rendering that stops truncating phones to 7 lines. `src/utils/commands/network.ts:47`

- Fix: src/commands/weather/{geocode,openMeteo,render,wmo}: curated aliases -> Open-Meteo search -> throttled Nominatim fallback; fetch current+3-day with timezone=auto; compact (<=40 col) and wide cards chosen by container width, `-f` to force; 10 min cache; 8 s timeouts.

**F081 · high · design · phase 5.** No module boundaries: dispatcher, command bodies, help, VFS, DOM effects and UI logic interleave in a utils/ grab-bag; target layout and migration order. `src/utils/commands.ts:1`

- Fix: src/shell (tokenize/parse/expand/registry/exec/complete/session), src/vfs, src/commands/<name>.ts, src/lib/api, src/render, src/ui, src/stores pure; migrate in eight shippable steps: tooling, VFS+cwd, render model, CommandSpec, completion, parser/exec, API providers, Input split.

**F034 · medium · confirmed · phase 2.** Registry is an untyped object spread with no metadata, so the UI special-cases commands by name and duplicates are silent. `src/utils/commands.ts:458`

- Verified: The registry (commands.ts:458) is typed only as a function signature and carries no metadata. As a result, the interruptible list is copied three times (commands.ts:343, Input.svelte:207, :295), path-argument commands are a hand-kept list that has already drifted (Input.svelte:389 lists the non-existent nano and omits ls), suggestions branch on command names (commandSuggestions.ts), and duplicate keys are silently shadowed: `reset` exists in both fileSystem.ts:479 and commands.ts:116. A plain command needs only 2 files, but an interruptible or path-taking command needs 3 to 5 edits, and features-grep shows the result: grep landed without path completion.
- Fix: Typed CommandSpec {name, synopsis, flags, args, interruptible, complete, run, man, load} registered with a duplicate-name check and a test; derive help, completion, abort and lazy loading from it.

**F080 · medium · confirmed · phase 1 + 5.** Command output model is raw HTML strings rendered with {@html}; `Command` interface is really a history entry with a single-element outputs array. `src/interfaces/command.ts:2`

- Verified: Command output is untyped HTML strings rendered through {@html} (History.svelte:20, CommandSuggestionsRow.svelte:62), with about 280 inline style= snippets across the command and help modules. Theme and cathode stores patch past output with querySelectorAll (theme.ts:36, 51; cathode.ts:44). `Command` is really a transcript entry whose outputs array almost always has 0 or 1 element (Input.svelte:122-126 is the one exception). The design couples output to the browser DOM, makes testing and future piping harder (there is no test runner yet), and lets unescaped user input reach {@html} (commands.ts:355, 360). It is a medium maintainability debt, not a high-severity defect.
- Fix: Small OutputNode AST (text/line/block/table/columns/pre/link/themeName with a temporary html adapter) rendered by Output.svelte with CSS-class colours; rename to TranscriptEntry {id, line, cwd, output, exit}.

**F045 · medium · design · phase 2.** Cancellability depends on a command-name allowlist duplicated in three places and a single shared AbortController; no job model. `src/components/Input.svelte:207`

- Fix: Always create one AbortController per executed command in runCommand(), pass a CommandContext {args, signal, cwd}, delete the arrays; a jobs store for future `&`.

**F066 · medium · design · phase 2.** Network commands use the Promise-constructor anti-pattern and resolve errors as HTML strings, so there is no exit status, stderr channel or uniform bell policy. `src/utils/commands/network.ts:43`

- Fix: Plain async run(ctx) returning an ExitCode and writing to ctx.stdout/stderr; typed errors (TimeoutError, ProviderError) formatted once by exec.ts, which records $? and rings the bell.

**F084 · medium · design · phase 0.** TypeScript is effectively off: strict and every strictness flag disabled, @tsconfig/svelte installed but not extended, moduleResolution node, a *.svelte shim hiding prop types. `tsconfig.json:15`

- Fix: extends @tsconfig/svelte, delete the shim, beep.js -> .ts, enable strict then noUnusedLocals/noImplicitReturns/noUncheckedIndexedAccess in stages, run svelte-check in CI.

**F043 · medium · not verified · phase 2.** Help content is stored as HTML and re-parsed with regexes, duplicated in four places, rendered in two visual systems, and references an undefined --theme-magenta. `src/utils/commands.ts:367`

- Fix: Structured {summary, usage, options, examples, tips} per CommandSpec rendered by one renderHelp used by help/--help/man/usage errors; fix the token to purple.

**F044 · medium · not verified · phase 3.** Input.svelte is a 705-line god component with dead state (displayValue, passwordInput, pendingSudoCommand), a mount-only $effect and scattered session state. `src/components/Input.svelte:1`

- Fix: src/shell/session.ts holding line/mode/job/history/cwd, src/ui/keymap.ts and scroll.ts; InputLine becomes a thin view; enable noUnusedLocals and delete what it flags.

**F093 · medium · not verified · phase 2.** Seeded documents (README.md, history.txt, linux.txt) are HTML, so every future text tool (grep/wc/head) sees tags instead of prose. `public/history.txt:1`

- Fix: Plain text/Markdown or a minimal ANSI SGR subset with one ansiToHtml() and stripAnsi for text tools.

**F030 · low · confirmed · phase 2.** Stores and commands reach into the DOM and UI state directly instead of returning effects, forcing name-based special cases in Input.svelte. `src/stores/theme.ts:33`

- Verified: This stands as an architecture finding but should be low severity, since no user-visible bug follows from it. The theme and cathode stores run DOM side effects twice when imported (theme.ts:90-105, cathode.ts:60-73). They patch earlier output through class selectors (theme.ts:36,51; cathode.ts:44). Commands mutate stores and the DOM directly: clear and reset (commands.ts:116-141, which calls history.set twice at 126 and 137), and poweroff (fileSystem.ts:515-538). That forces Input.svelte to special-case sudo, clear and reset by name (269-285, 316-331). The coupling has already left a shadowed, conflicting duplicate reset at fileSystem.ts:479-501.
- Fix: Pure stores with one App-level $effect for CSS variables/favicon; commands emit typed effects (clearScreen, resetSession, setTheme, openUrl, poweroff) applied by the executor.

**F082 · low · confirmed · phase 2.** Virtual file system is a mutable module-level tree with no API: no mode/owner/mtime/size, no permission checks (guest can `echo > /etc/passwd`, `rm -r /bin`). `src/utils/virtualFileSystem.ts:469`

- Verified: Low-severity maintainability finding. The VFS is a mutable module-level tree, and currentPath (virtualFileSystem.ts:469, 472) is a non-reactive global changed in place from fileSystem.ts and commands.ts. The only shared helpers are resolvePath and getCurrentDirectory, so every command re-implements the tree walk (fileSystem.ts:83-92, 157-175, 208-226, 260-268, 297-305, 339-347, 426-433; Input.svelte:84-90). Because the cwd is not reactive, Ps1.svelte:4 hard-codes '~'. VirtualFile (virtualFileSystem.ts:2-8) has no metadata, so touch's "timestamp updated" (fileSystem.ts:316) is fiction. There are no permission checks, so `echo x > /etc/passwd` and `rm -r /bin` succeed, but the tree is a per-tab in-memory toy that reset or a reload restores, so this is a realism gap, not a security issue.
- Fix: src/vfs/fs.ts with resolve/stat/read/write/mkdir/rm/list/walk returning ENOENT/ENOTDIR/EISDIR/EACCES; mode/uid/gid/mtime fields, checkAccess, /etc/shadow unreadable; seed as data.

**F087 · low · not verified · phase 5.** UI fragments are copy-pasted (cancel notice x6, escapeHtml x2, fuzzy match x2, width heuristics x5) and errors have five visual treatments. `src/utils/commands/network.ts:101`

- Fix: fail(cmd,msg,hint) and callout(kind) helpers with CSS classes bound to role tokens; one suggestSimilar(); these vanish with the output model.

### Performance

**F086 · medium · not verified · phase 1 (QR engine swap).** Single eager bundle: qrcode (+dijkstrajs) is ~23 kB (16 %) of the 143 kB JS and every command module loads before first paint. `src/utils/commands/qr.ts:4`

- Fix: CommandSpec.load lazy import; in-house byte-mode QR encoder (versions 1-10, EC M, GF(256) RS, 8 masks, ~250 lines) kept lazy; drop qrcode packages.

**F007 · low · confirmed · phase 0.** firebase.json: hashed assets cached only 1 h and the ** rewrite turns every missing file into a 200 HTML soft-404. `firebase.json:9`

- Verified: firebase.json:1-16 has no headers block, so the hashed /assets/* bundle gets Firebase's default max-age=3600 instead of immutable caching. After an hour it is only revalidated (304, 0 bytes), not re-downloaded. The '**' rewrite (lines 9-14) is unnecessary because there is no client routing, and it turns every missing path (robots.txt, favicon.ico, manifest.json, which nothing references) into a 200 text/html soft-404. It would also make `cat` show index.html if a public file went missing (fileSystem.ts:23-25). Fix: add a 1-year immutable header for /assets/** and no-cache for /index.html, and drop or narrow the rewrite. The favicons are in /favicons and should not be marked immutable.
- Fix: Add immutable 1-year caching for /assets/**, no-cache for index.html; drop the catch-all rewrite (no client routes) or restrict it to extensionless paths; add robots.txt.

**F025 · low · confirmed · phase 0.** Display history is serialised to localStorage on every change, deleted on the next load and never read; nothing else persists. `src/stores/history.ts:22`

- Verified: The two subscribers at history.ts:22-28 are dead code left over from commit 69b328b: they write history and commandHistory to localStorage on every change, and nothing ever reads either key. They cost a negligible stringify per command and carry a very unlikely QuotaExceeded failure that would freeze every store. Fix: delete the subscribers along with the now-pointless removeItem calls at lines 6-7. Do not frame the intended reset-on-reload as a defect, and do not move banner() back into onMount, because commit 45fb6da moved it out to fix a rendering delay.
- Fix: Delete both subscribers and the removeItem calls; persist only a capped commandHistory (as ~/.bash_history) and a VFS overlay through the safe storage helper; move banner() into mount.

**F079 · low · confirmed · phase 1.** CRT scanlines, 45 % vignette and an infinite compositor sweep are on by default for every visitor including phones; flicker modulates at ~23 Hz; reduced-motion only covers two layers. `src/stores/cathode.ts:53`

- Verified: The default 'scanlines' mode (cathode.ts:53) has no gate for coarse pointer, saveData or prefers-contrast. Every first-time visitor, phones included, gets a static scanline overlay (28% black on half of each 3 px), a vignette reaching 45% at the corners, and a sweep band that animates forever with `will-change: transform` (app.css:156-164, 183-195, 206-212, 225-227). That costs a little compositor work and battery for a nearly invisible effect, which is a low-severity design issue. Flicker, text-shadow and filter are opt-in only (phosphor and vintage modes). The flicker's luminance change of about 3% is far below the WCAG 2.3.1 flash threshold. Reduced-motion already disables both animated layers.
- Fix: Default off on coarse pointer/saveData/reduced-motion/prefers-contrast; disable sweep/flicker on touch; pause animations on visibilitychange/idle; move glow/filter off the scroller; slow the flicker; add contrast/forced-colors and reduced-motion overrides.

**F058 · low · not verified · phase 0 (quick fix) + 3.** playBeep creates a new AudioContext per error and never closes it; fastfetch leaks a WebGL context; the beep is the only error cue. `src/utils/beep.js:4`

- Fix: One lazily created context resumed on first gesture, `bell off` setting (default off on touch), red `cmd: message` errors, bell on zero completions, lose the WebGL context after reading.

**F063 · low · not verified · phase 1.** Favicons are ten 134 kB single-size 180x180 bitmaps injected at runtime with a cache-buster; no static icon, apple-touch-icon, SVG or manifest. `src/stores/theme.ts:63`

- Fix: Static favicon.svg/32px PNG/180px apple-touch-icon and manifest in index.html; per-theme SVG swap without ?v=; CSS variables per html[data-theme].

**F097 · low · not verified · phase 3.** History.svelte runs in legacy mode with an unkeyed each, so every append re-runs every row's effects and instantiates a Ps1 per row. `src/components/History.svelte:8`

- Fix: Add an id to entries, runes mode, `{#each $history as entry (entry.id)}`, static prompt string per row.

### Tooling and deployment

**F053 · medium · not verified · phase 0.** Dependency hygiene: 8 npm-audit advisories (1 critical), svelte pinned below a DOM-clobbering XSS fix, toolchain 2-3 majors behind, qrcode mis-declared, no Dependabot. `package.json:30`

- Fix: npm audit fix, bump svelte/vite/plugin/svelte-check together, move qrcode to dependencies (or drop it with the in-house encoder), add dependabot.yml for npm/actions/docker, run audit in CI.

**F083 · medium · not verified · phase 0.** Nothing can be unit-tested (window/document/localStorage touched at import) and no test runner, linter or formatter exists. `src/stores/theme.ts:85`

- Fix: Explicit init() functions called from main.ts; add vitest+jsdom+testing-library, ESLint flat config with eslint-plugin-svelte, Prettier; first tests: tokenizer, resolvePath, completion, textWrap, QR matrix, formatters with mocked fetch.

**F085 · low · confirmed · phase 0.** Production deploys and the GHCR image run with no quality gate; `npm run check` is never invoked and currently exits 1. `.github/workflows/firebase-hosting-merge.yml:14`

- Verified: CI hygiene. No workflow runs `npm run check` (firebase-hosting-merge.yml:14, firebase-hosting-pull-request.yml:16, Dockerfile:10 run build only), and there is no concurrency group. `npm run check`, which README.md:127 calls the test step, currently exits 1 on two type-only errors at theme.ts:71,78 (`link.sizes = 'any'` works at runtime via PutForwards). Fix with setAttribute('sizes','any') and add a check step before deploy. There is no production impact today.
- Fix: Fix with setAttribute('sizes','any'); one ci.yml with check/lint/test/build and artifact, deploy/docker/preview jobs `needs: check`, concurrency group, branch protection.

**F056 · low · not verified · phase 0.** Docker/CI pinning gaps: checkout@v3, 2023-era action SHAs, unpinned cosign-installer, floating base images, no .dockerignore, Node version unpinned everywhere. `Dockerfile:8`

- Fix: Add .dockerignore and .nvmrc (22), pin images by digest, bump and SHA-pin actions with Dependabot, add setup-node with cache, platforms amd64+arm64, delete dead if: lines.

**F062 · low · not verified · phase 0.** Dead configuration: tailwind.config.js ignored by Tailwind 4, redundant autoprefixer (source of the caniuse warning), unused html class="dark", committed .vercel link, dynamic import of a static module. `tailwind.config.js:1`

- Fix: Delete tailwind.config.js/postcss.config.js, use @tailwindcss/vite, drop the dark class, git rm .vercel and ignore it, static import of speedtestPhase, trim vite.config and add sourcemap/target/host.

### Documentation

**F089 · medium · not verified · phase 0.** README documents a Docker image that does not exist (ghcr.io/hsavlesen/vesen) and calls GHCR 'docker hub'. `README.md:25`

- Fix: Correct to ghcr.io/hsalvesen/vesen, rename the heading, document tags and `cosign verify`; CI smoke-run the pushed image.

**F088 · low · not verified · phase 0 + 6.** Docs are stale or missing: README structure omits half the tree, 'Run tests' points at a failing type-check, Node 18, no CHANGELOG/CONTRIBUTING/SECURITY/PR template, boilerplate issue forms. `README.md:96`

- Fix: Regenerate the tree after the re-layout; add command-authoring, configuration, deployment and scripts sections; CHANGELOG (Keep a Changelog), CONTRIBUTING, SECURITY, PR template, YAML issue forms.

### Refuted

**F059.** weather detects failure by substring-matching prose and never checks HTTP status, so real wttr.in errors render as a bright-green report header. All three verifiers refuted the mechanism: wttr.in's not-found reply has no CORS header, so the browser rejects it and the user sees a red `TypeError: Failed to fetch` instead of a green report. The real, smaller problem is an unhelpful error message, which the in-house weather command fixes anyway.

## Measurements

| Measurement | Value |
|---|---|
| `svelte-check` | 2 errors, both `link.sizes` assignments in `src/stores/theme.ts:71,78`. Harmless at runtime, but `npm run check` exits 1. |
| Production JS | 142.85 kB, 48.7 kB gzipped, one chunk. The `qrcode` package is about 23 kB of it. |
| Production CSS | 12.5 kB |
| `npm audit` | 8 advisories: 1 critical (tar), 5 high (browserslist, nanoid, postcss, rollup, vite), 2 moderate (esbuild, svelte). All are build-time tooling except the Svelte ones, which affect server-side rendering that vesen does not use. |
| Installed versions | svelte 5.36.7, vite 5.4.20, @sveltejs/vite-plugin-svelte 4.0.0, TypeScript 5.5.4. All several releases behind. |
| Favicons | Ten `.ico` files of 134 kB each, one per theme, re-fetched on every theme switch. |
| Font | `public/fonts/CascadiaCode.ttf`, 649 kB, shipped but never referenced. The page renders in the browser's default monospace (Courier on iOS). |
| Tailwind config | `tailwind.config.js` is a v3 config. Tailwind 4 ignores it because `src/app.css` has no `@config`. |

### Contrast of each theme against its background

WCAG AA needs 4.5:1 for normal text. Values under 4.5 are bold. `brightBlack` is the colour of the suggestion row; `white` is used as body text by the input, banner, `ls` and help.

| Theme | Background | foreground | white | brightBlack | cyan | yellow | green | red |
|---|---|---|---|---|---|---|---|---|
| cassowary | `#1D1E20` | 14.6 | 14.6 | **2.8** | 13.0 | **4.0** | 13.0 | **4.2** |
| cockatoo | `#e8ddd0` | 8.4 | **2.5** | **1.6** | **2.1** | **1.6** | **3.0** | 4.8 |
| crocodile | `#292520` | 9.5 | 9.4 | **2.4** | **4.2** | 8.0 | 7.0 | **3.1** |
| kangaroo | `#262626` | 10.2 | 10.0 | **2.0** | 6.7 | 6.9 | 5.9 | **2.8** |
| kookaburra | `#222222` | 6.3 | 7.6 | **2.2** | 5.6 | 9.4 | 9.0 | 8.0 |
| petroica | `#2A2A2E` | 10.0 | 14.3 | 5.6 | 7.6 | 5.2 | 6.4 | 5.7 |
| swamphen | `#222235` | 15.6 | 15.6 | 5.9 | 5.5 | 4.7 | 7.3 | **3.7** |
| treefrog | `#0a4020` | 5.0 | 5.0 | 6.0 | 5.0 | 6.0 | 4.6 | **1.8** |
| wallaby | `#323232` | 12.8 | 11.0 | **1.7** | 6.4 | 8.3 | 6.4 | **3.1** |
| wombat | `#1c1814` | 13.2 | 10.6 | **1.9** | 5.0 | 8.9 | **2.7** | **2.5** |

Cockatoo is the only light theme, and its `white`, `cyan` and `yellow` are all below 2.5:1. The default theme, swamphen, passes for body text, but its `yellow` slot is a red (`#ff4757`), so the prompt user, errors and several labels share one hue.

## Branches

| Branch | State |
|---|---|
| features-grep | 1 commit ahead of `main` (5158f3f, a `grep` command), 7 behind. `git merge-tree` shows it merges cleanly; the change touches only `fileSystem.ts` and `helpTexts.ts`. |
| GUI | Identical to `main`. |
| UI, demo, refactor | Fully merged (0 commits ahead). Safe to delete. |

## Font licence

Cascadia Code is licensed under the SIL Open Font License 1.1 with the Reserved Font Name "Cascadia Code". A subsetted copy is a modified version, so it must ship under a different name (for example "Vesen Mono") with the OFL text alongside it.

## Appendix A. Every finding

| ID | Severity | Status | Phase | Area | Finding | Where |
|---|---|---|---|---|---|---|
| F038 | high | Confirmed | 0 (hotfix) + 4 | Network commands | curl and stock are dead end-to-end: every public CORS proxy in the cascade fails, so each call burns ~20 s then errors, and the proxies see every URL | `src/utils/commands/network.ts:134` |
| F047 | high | Confirmed | 0 (hotfix) + 3 | Network commands | No request ever times out; with the input disabled and no tappable cancel, one hung proxy locks the terminal permanently on phones | `src/utils/commands/network.ts:237` |
| F037 | high | Design | 1 (Worker) + 4 | Code arrangement | Stock data-source plan: Yahoo-via-free-proxy cannot be made reliable; use an owned Worker with a keyed provider and cached fallback | `src/utils/commands/network.ts:236` |
| F060 | high | Design | 4 | Code arrangement | In-house weather design: Open-Meteo for data, alias table plus geocoder cascade for Gadigal/Aotearoa, structured rendering that stops truncating phones to 7 lines | `src/utils/commands/network.ts:47` |
| F081 | high | Design | 5 | Code arrangement | No module boundaries: dispatcher, command bodies, help, VFS, DOM effects and UI logic interleave in a utils/ grab-bag; target layout and migration order | `src/utils/commands.ts:1` |
| F001 | medium | Confirmed | 1 | Bugs | Unguarded localStorage access at module scope blanks the page when storage is blocked | `src/stores/theme.ts:86` |
| F003 | medium | Confirmed | 0 (quick fix) + 2 | Linux fidelity | Virtual home is mis-nested: dotfiles, projects, bin, src live in /home instead of /home/user | `src/utils/virtualFileSystem.ts:205` |
| F004 | medium | Confirmed | 1 | Security | User-typed text reaches {@html} unescaped: self-XSS via echo, cat, ls, history, suggestions and error messages | `src/components/History.svelte:20` |
| F005 | medium | Confirmed | 1 | Security | Third-party response text (wttr.in, Yahoo via proxy, ipify, WebGL renderer) injected into {@html} unescaped | `src/utils/commands/network.ts:85` |
| F006 | medium | Confirmed | 0 (report-only) + 1 | Security | No Content-Security-Policy or any security header is served | `firebase.json:2` |
| F009 | medium | Confirmed | 1 | Visual design | ls, history, curl, speedtest, whoami, repo, echo and poweroff bake theme hex values inline, so old output does not re-theme | `src/utils/commands/fileSystem.ts:107` |
| F010 | medium | Confirmed | 1 | Desktop experience | Four competing auto-scroll paths: 10 Hz spinner effect pins the view to the bottom and suggestion show/hide restores stale scrollTop | `src/App.svelte:50` |
| F012 | medium | Confirmed | 1 + 3 | Phone experience | Input is disabled while processing: keystrokes dropped, iOS keyboard closes after every command, dead displayValue and invalid :readonly rule | `src/components/Input.svelte:305` |
| F014 | medium | Confirmed | 0 (quick fix) + 3 | Desktop experience | Ctrl+C always preventDefaults, so selected text cannot be copied on Windows/Linux | `src/components/Input.svelte:194` |
| F016 | medium | Confirmed | 1 + 3 | Phone experience | Layout is frozen into output HTML from window.innerWidth at execution time; desktop output never wraps and nothing reflows on resize or rotation | `src/components/History.svelte:19` |
| F017 | medium | Confirmed | 2 | Bugs | rm understands only a bare `-r` as the first argument, yet the suggestion row offers `rm -f <directory>` which always fails | `src/utils/commands/fileSystem.ts:247` |
| F018 | medium | Confirmed | 2 | Linux fidelity | ls ignores -l, -la, -1, -F and extra operands, is unsorted, forces a `/` suffix and errors on a file operand | `src/utils/commands/fileSystem.ts:72` |
| F022 | medium | Confirmed | 3 | Desktop experience | Tab completion is a 230-line per-command ladder that cannot complete ~/ or ../, skips ls/mkdir/echo, completes a non-existent `nano`, and is silent on ambiguity | `src/components/Input.svelte:389` |
| F023 | medium | Confirmed | 2 | Linux fidelity | Prompt always shows `~`: Ps1's currentDir is a constant, cwd is a mutable array, and history entries do not record their cwd | `src/components/Ps1.svelte:4` |
| F028 | medium | Confirmed | 4 | Network commands | speedtest transfers ~40 MiB down and ~1.3 MiB up per run with no warning, data-saver check or time bound, buffering each sample in memory | `src/utils/commands/network.ts:562` |
| F034 | medium | Confirmed | 2 | Code arrangement | Registry is an untyped object spread with no metadata, so the UI special-cases commands by name and duplicates are silent | `src/utils/commands.ts:458` |
| F035 | medium | Confirmed | 4 | Network commands | stock trusts the proxy envelope blindly: no http_code check, JSON.parse on error bodies, `previousClose \|\| 0` fakes a -100 % change, raw TypeErrors shown | `src/utils/commands/network.ts:243` |
| F039 | medium | Confirmed | 2 | Linux fidelity | No shell grammar: input is split on whitespace in two different ways, with no quoting, pipes, lists, redirection (outside echo), variables or globs | `src/utils/commands.ts:319` |
| F046 | medium | Confirmed | 3 | Desktop experience | Readline basics are missing: Ctrl+R reloads and wipes the session, Ctrl+U/K/A/E/D/W go to the browser, no ^C echo, draft lost on Up | `src/components/Input.svelte:231` |
| F067 | medium | Confirmed | 3 | Phone experience | Suggestion row is inert {@html} text: not tappable, not arrowable, not announced, appears on the first keystroke and reflows the page; every power feature is keyboard-only on phones | `src/components/CommandSuggestionsRow.svelte:62` |
| F068 | medium | Confirmed | 1 | Accessibility | Theme palettes fail WCAG contrast for core UI roles: cockatoo body text 2.46:1, suggestions 1.6-2.8:1 on 7 of 10 themes, errors and prompt segments below 3:1; swamphen's yellow/blue are red/orange | `themes.json:33` |
| F076 | medium | Confirmed | 1 | Phone experience | App is sized with 100vh, no visualViewport/keyboard handling, no safe-area insets: prompt and suggestions sit under mobile toolbars and the soft keyboard | `index.html:13` |
| F077 | medium | Confirmed | 1 | Accessibility | Viewport disables pinch zoom to mask 11-12 px phone text (WCAG 1.4.4 failure on WKWebView/Android) | `index.html:6` |
| F080 | medium | Confirmed | 1 + 5 | Code arrangement | Command output model is raw HTML strings rendered with {@html}; `Command` interface is really a history entry with a single-element outputs array | `src/interfaces/command.ts:2` |
| F094 | medium | Confirmed | 1 + 3 | Accessibility | Accessibility: the input has no accessible name, output has no live region, every prompt is an <h1>, and ASCII art/QR/swatches have no text alternative | `src/components/Input.svelte:655` |
| F013 | medium | Design | 2 + 3 | Desktop experience | Loading state is a generic 'Processing...' line with no context or cancel hint; failures print raw JS error objects; the typed line is not committed on Enter | `src/components/Input.svelte:626` |
| F045 | medium | Design | 2 | Code arrangement | Cancellability depends on a command-name allowlist duplicated in three places and a single shared AbortController; no job model | `src/components/Input.svelte:207` |
| F065 | medium | Design | 2 (net service) + 4 | Network commands | No application-level caching or request de-duplication for any network command | `src/utils/commands/network.ts:236` |
| F066 | medium | Design | 2 | Code arrangement | Network commands use the Promise-constructor anti-pattern and resolve errors as HTML strings, so there is no exit status, stderr channel or uniform bell policy | `src/utils/commands/network.ts:43` |
| F072 | medium | Design | 5 | Linux fidelity | Missing command catalogue: no exit/man/alias/which/date and the first words a shell user types beep; .bashrc declares ll/la aliases that do not work; prioritised tiers 1-5 | `src/utils/commands.ts:458` |
| F084 | medium | Design | 0 | Code arrangement | TypeScript is effectively off: strict and every strictness flag disabled, @tsconfig/svelte installed but not extended, moduleResolution node, a *.svelte shim hiding prop types | `tsconfig.json:15` |
| F043 | medium | Not verified | 2 | Code arrangement | Help content is stored as HTML and re-parsed with regexes, duplicated in four places, rendered in two visual systems, and references an undefined --theme-magenta | `src/utils/commands.ts:367` |
| F044 | medium | Not verified | 3 | Code arrangement | Input.svelte is a 705-line god component with dead state (displayValue, passwordInput, pendingSudoCommand), a mount-only $effect and scattered session state | `src/components/Input.svelte:1` |
| F048 | medium | Not verified | 4 | Phone experience | QR is theme-coloured half-blocks with no quiet zone; the mobile `pre { white-space: pre-wrap !important }` rule wraps rows and corrupts codes wider than ~43 modules | `src/utils/commands/qr.ts:97` |
| F049 | medium | Not verified | 3 | Security | sudo turns the prompt into a real password field, buffers keystrokes into dead state, opens YouTube with no output, and poweroff needs no root | `src/components/Input.svelte:660` |
| F050 | medium | Not verified | 4 | Security | fastfetch sends every visitor to api.ipify.org and prints their public IP under the label 'Local IP' | `src/utils/commands/system.ts:448` |
| F051 | medium | Not verified | 3 | Bugs | whoami/repo/email/sudo rely on window.open without noopener, return-value checks or a tappable link, and any navigation away destroys the session | `src/utils/commands.ts:274` |
| F052 | medium | Not verified | 0 (decision) | Security | Analytics (when enabled) sends every command's full arguments to a third-party umami host, undocumented and with an env-controlled script tag | `src/utils/tracking.ts:11` |
| F053 | medium | Not verified | 0 | Tooling and deployment | Dependency hygiene: 8 npm-audit advisories (1 critical), svelte pinned below a DOM-clobbering XSS fix, toolchain 2-3 majors behind, qrcode mis-declared, no Dependabot | `package.json:30` |
| F057 | medium | Not verified | 0 | Bugs | docker-compose healthcheck execs curl against port 80 inside a FROM scratch image that has no curl and listens on 3000 | `docker-compose.yml:9` |
| F061 | medium | Not verified | 1 | Visual design | Output font is the generic `monospace` keyword (Courier on iOS) while the bundled 648 kB Cascadia Code is never loaded; prompt, input and output use three stacks | `src/components/History.svelte:28` |
| F064 | medium | Not verified | 1 | Visual design | No Open Graph/Twitter tags, theme-color, canonical or page background: shared links get a blank card, the gutter shows the browser canvas, apex and www both serve 200 | `index.html:7` |
| F069 | medium | Not verified | 3 | Bugs | History navigation: draft lost on Up, sudo lines never recorded, `history` omits itself and ignores arguments, no !!/!n/Ctrl+R | `src/components/Input.svelte:366` |
| F070 | medium | Not verified | 0 (quick fix) | Bugs | Echoed commands in the scrollback are truncated with an ellipsis instead of wrapping (about 22 chars on a 375 px phone) | `src/components/History.svelte:41` |
| F071 | medium | Not verified | 2 | Linux fidelity | Command-not-found text and 'Did you mean' heuristic are un-Linux: `c` suggests cat, `lsblk` suggests ls, `exit` gets nothing, no exit 127 | `src/utils/commands.ts:300` |
| F073 | medium | Not verified | 3 | Visual design | No designed cursor or focus state: native caret with outline-none, theme cursorColor never exported, invisible first-run prompt on touch | `src/components/Input.svelte:658` |
| F074 | medium | Not verified | 3 | Desktop experience | Banner does not say whose terminal it is or teach Tab/Up/help; the version wraps onto its own line at 375 px | `src/utils/commands/system.ts:596` |
| F083 | medium | Not verified | 0 | Tooling and deployment | Nothing can be unit-tested (window/document/localStorage touched at import) and no test runner, linter or formatter exists | `src/stores/theme.ts:85` |
| F086 | medium | Not verified | 1 (QR engine swap) | Performance | Single eager bundle: qrcode (+dijkstrajs) is ~23 kB (16 %) of the 143 kB JS and every command module loads before first paint | `src/utils/commands/qr.ts:4` |
| F089 | medium | Not verified | 0 | Documentation | README documents a Docker image that does not exist (ghcr.io/hsavlesen/vesen) and calls GHCR 'docker hub' | `README.md:25` |
| F092 | medium | Not verified | 5 | Linux fidelity | features-grep branch merges cleanly but adds a tenth VFS walk and a third escapeHtml, rejects clustered flags (-rn), always prefixes paths, uses JS regex instead of BRE/ERE | `src/utils/commands/fileSystem.ts:229` |
| F093 | medium | Not verified | 2 | Code arrangement | Seeded documents (README.md, history.txt, linux.txt) are HTML, so every future text tool (grep/wc/head) sees tags instead of prose | `public/history.txt:1` |
| F095 | medium | Not verified | 3 | Accessibility | Tab and Ctrl+L are trapped at window level with no keyboard route out of the page | `src/components/Input.svelte:382` |
| F096 | medium | Not verified | 1 | Visual design | Seven different line-heights across prompt, input, outputs and suggestions; block-art rows show seams at desktop | `src/App.svelte:73` |
| F002 | low | Confirmed | 1 | Bugs | Theme persisted as a full colour-object snapshot and never revalidated | `src/stores/theme.ts:99` |
| F007 | low | Confirmed | 0 | Performance | firebase.json: hashed assets cached only 1 h and the ** rewrite turns every missing file into a 200 HTML soft-404 | `firebase.json:9` |
| F011 | low | Confirmed | 1 | Phone experience | Window-wide click handler refocuses the input, scrolling to the bottom and re-summoning the phone keyboard on every tap | `src/components/Input.svelte:649` |
| F015 | low | Confirmed | 3 | Desktop experience | help/ls/history column maths assume 8 px per character, so help overflows horizontally on 770-1170 px windows | `src/utils/commands.ts:26` |
| F019 | low | Confirmed | 2 | Linux fidelity | mkdir/touch/cat/rm take one operand, treat flags as names (`mkdir -p` creates '-p'), lack -p/-n, and print chatty success messages coreutils never print | `src/utils/commands/fileSystem.ts:334` |
| F020 | low | Confirmed | 2 | Bugs | `rm -r .`, `..`, `~` or `/` delete the cwd or an ancestor and leave currentPath dangling | `src/utils/commands/fileSystem.ts:255` |
| F021 | low | Confirmed | 2 | Bugs | resolvePath only normalises `.`/`..` for relative paths; `cd /home/../etc` and `cat ~/../x` fail, and the walk loop is copied nine times | `src/utils/virtualFileSystem.ts:497` |
| F024 | low | Confirmed | 2 | Linux fidelity | Machine identity is inconsistent across prompt, home dir, passwd, fastfetch, /proc and whoami | `src/components/Ps1.svelte:15` |
| F025 | low | Confirmed | 0 | Performance | Display history is serialised to localStorage on every change, deleted on the next load and never read; nothing else persists | `src/stores/history.ts:22` |
| F026 | low | Confirmed | 4 | Bugs | Weather colouriser regex chain never colours temperatures, double-wraps wind speeds, misses conditions and uses astral emoji without the `u` flag | `src/utils/commands/network.ts:86` |
| F027 | low | Confirmed | 4 | Bugs | speedtest measurements are not validated: Mbps from requested bytes without res.ok, AbortError swallowed into a sendBeacon fallback that reports fictitious upload speed | `src/utils/commands/network.ts:529` |
| F030 | low | Confirmed | 2 | Code arrangement | Stores and commands reach into the DOM and UI state directly instead of returning effects, forcing name-based special cases in Input.svelte | `src/stores/theme.ts:33` |
| F031 | low | Confirmed | 2 | Bugs | Command table and VFS children are plain objects, so `constructor`, `toString`, `__proto__` behave as existing commands/files (prototype pollution of the directory map) | `src/utils/commands.ts:341` |
| F036 | low | Confirmed | 4 | Bugs | stock hard-codes `$`, ignores meta.currency, mixes font sizes and draws a label column as the 'OHLC chart' | `src/utils/commands/network.ts:372` |
| F040 | low | Confirmed | 2 | Bugs | echo mishandles quotes, escapes and flags: `echo "a" "b"` prints `a" "b`, -n/-e unsupported, bare echo prints help | `src/utils/commands/fileSystem.ts:374` |
| F042 | low | Confirmed | 2 | Desktop experience | `help` is a bare name grid: commandDescriptions is imported but never used, `help <unknown>` silently prints the grid, no man | `src/utils/commands.ts:18` |
| F055 | low | Confirmed | 0 | Security | Release workflow uses an archived Node 12 action by mutable `@latest` tag with write permissions and overwrites a single 'latest' release | `.github/workflows/release.yml:21` |
| F079 | low | Confirmed | 1 | Performance | CRT scanlines, 45 % vignette and an infinite compositor sweep are on by default for every visitor including phones; flicker modulates at ~23 Hz; reduced-motion only covers two layers | `src/stores/cathode.ts:53` |
| F082 | low | Confirmed | 2 | Code arrangement | Virtual file system is a mutable module-level tree with no API: no mode/owner/mtime/size, no permission checks (guest can `echo > /etc/passwd`, `rm -r /bin`) | `src/utils/virtualFileSystem.ts:469` |
| F085 | low | Confirmed | 0 | Tooling and deployment | Production deploys and the GHCR image run with no quality gate; `npm run check` is never invoked and currently exits 1 | `.github/workflows/firebase-hosting-merge.yml:14` |
| F075 | low | Design | 2 | Desktop experience | `theme ls` is a comma list with an off-site link instead of inline palette swatches | `src/utils/commands.ts:161` |
| F008 | low | Not verified | 2 | Bugs | README.md/history.txt/linux.txt are fetched at runtime via dead fallbacks and accept the SPA fallback as file content | `src/utils/commands/fileSystem.ts:24` |
| F029 | low | Not verified | 3 | Bugs | poweroff's DOM selector matches nothing, the input is re-enabled by Input's finally, window.close() is a no-op and body.innerHTML is replaced with no recovery | `src/utils/commands/fileSystem.ts:515` |
| F032 | low | Not verified | 2 | Linux fidelity | `-h`/`--help` anywhere in the argument list hijacks the command (`echo say -h`, `qr -h`) | `src/utils/commands.ts:321` |
| F033 | low | Not verified | 0 | Bugs | Two `reset` implementations: the fileSystem one is dead by spread order, and reset seeds commandHistory with 'banner' and wipes files unlike real reset | `src/utils/commands.ts:116` |
| F041 | low | Not verified | 2 | Linux fidelity | /proc files are generated once with Math.random (MemAvailable can exceed MemTotal), cpuinfo prints MacIntel, generateSystemContent runs seven times | `src/utils/virtualFileSystem.ts:39` |
| F054 | low | Not verified | 4 | Bugs | User input is spliced into upstream URL paths without encoding (wttr.in city, Yahoo ticker, cors-anywhere URL) and errors are detected by substring | `src/utils/commands/network.ts:47` |
| F056 | low | Not verified | 0 | Tooling and deployment | Docker/CI pinning gaps: checkout@v3, 2023-era action SHAs, unpinned cosign-installer, floating base images, no .dockerignore, Node version unpinned everywhere | `Dockerfile:8` |
| F058 | low | Not verified | 0 (quick fix) + 3 | Performance | playBeep creates a new AudioContext per error and never closes it; fastfetch leaks a WebGL context; the beep is the only error cue | `src/utils/beep.js:4` |
| F062 | low | Not verified | 0 | Tooling and deployment | Dead configuration: tailwind.config.js ignored by Tailwind 4, redundant autoprefixer (source of the caniuse warning), unused html class="dark", committed .vercel link, dynamic import of a static module | `tailwind.config.js:1` |
| F063 | low | Not verified | 1 | Performance | Favicons are ten 134 kB single-size 180x180 bitmaps injected at runtime with a cache-buster; no static icon, apple-touch-icon, SVG or manifest | `src/stores/theme.ts:63` |
| F078 | low | Not verified | 1 | Visual design | ::-webkit-scrollbar styling forces a fixed light-grey 20 px/8 px bar that ignores the theme and has no Firefox equivalent | `src/app.css:6` |
| F087 | low | Not verified | 5 | Code arrangement | UI fragments are copy-pasted (cancel notice x6, escapeHtml x2, fuzzy match x2, width heuristics x5) and errors have five visual treatments | `src/utils/commands/network.ts:101` |
| F088 | low | Not verified | 0 + 6 | Documentation | Docs are stale or missing: README structure omits half the tree, 'Run tests' points at a failing type-check, Node 18, no CHANGELOG/CONTRIBUTING/SECURITY/PR template, boilerplate issue forms | `README.md:96` |
| F090 | low | Not verified | 0 | Bugs | Version is hand-duplicated: /etc/os-release says v1.0.0 while banner and fastfetch read 1.2.0 | `src/utils/virtualFileSystem.ts:43` |
| F091 | low | Not verified | 0 | Security | themes.json and package.json live outside src/ and are imported relatively; the whole package.json (devDependency versions, author email) ships in the bundle | `src/utils/commands/system.ts:1` |
| F097 | low | Not verified | 3 | Performance | History.svelte runs in legacy mode with an unkeyed each, so every append re-runs every row's effects and instantiates a Ps1 per row | `src/components/History.svelte:8` |
| F059 | low | Refuted | 4 | Bugs | weather detects failure by substring-matching prose and never checks HTTP status, so real wttr.in errors render as a bright-green report header | `src/utils/commands/network.ts:53` |
