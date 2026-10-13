# Changelog

All notable changes to vesen are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- On a phone the terminal's frame shows on every side, 4px in from the edges, so it shows in Instagram's browser too; full-screen apps are framed the same way.
- The banner's version is drawn in the muted colour of the line under the logo.
- `help` leads each category with the commands that have the most to show (`fastfetch`, `cal`, `weather`, `cmatrix` and the like), in that order.
- `weather` shows seven days unless `-d` asks for fewer, so the `[7 days]` chip is gone.
- On a phone `sudo`'s show has no Close button: "Tap to exit" says how, and a tap leaves (the first one starts the sound where the browser held it back).
- `sudo` ends with `guest is not in the sudoers file.` alone, in the theme's error colour.
- On a phone `fastfetch` lists its details first and its logo under them.
- `sudo`'s show plays the owner's video, traced to ASCII: 3,189 frames of 120 columns by 45 rows in `public/audio/incident-report.frames`, made by the new `scripts/ascii-video.py` straight from the video (OpenCV and numpy, no PNGs between, tones stretched per frame and eased so cuts land and steady shots do not flicker). Fifteen frames a second of the video, written at the rate that makes one loop the track's 194.56 s (`--fit`), so the picture runs a little faster and loops with the music; while it plays, the frames are set to where the track is every couple of seconds, so the two never part. The drawn dancer is gone. The screen shows the picture and one line, "Ctrl+C, q or Esc to exit" (a Close button on a phone), and nothing else; m still mutes. On a screen taller than wide (a phone held upright) a portrait cut plays instead, `public/audio/incident-report.portrait.frames`: the middle of the picture traced at 72 columns by 56 rows (`--aspect 0.64`), frame for frame with the whole one, which covers the screen edge to edge, cropped evenly at the sides about its centre; elsewhere the whole picture is as large as the window allows. The picture plays under reduced motion too, as a video does; it had stood still there, which is why a phone with Reduce Motion on showed one frame. The frames file's cap is 32 MB, and `/audio/**` is cached a day. A black last frame is written as a space, so it is read as a frame and the loop keeps the track's length.
- The show's files are warmed once the page is idle after boot (`src/services/warm-show.ts`, not on Data Saver or mobile data): the track into an audio element kept out of the page and never played until `sudo`, the frames the screen will play (the portrait cut on a phone held upright) into the browser's cache. A first `sudo` then starts its music and its picture at once instead of after their downloads. `sudo --help` still fetches nothing.
- `sudo` asks `Password:` and nothing more, as a Unix terminal does: no dim line above it and, on a keyboard, no Cancel chip under it (^C and Esc cancel; a phone's dock keeps its Cancel chip). Each key shows as `*`, as sudo's pwfeedback shows it, and the asterisks stay on the line once it is answered. `read -s` stays silent.
- `help` shows eight commands of each category, the everyday ones, with `...` under a category that has more. `help files` (or any category: vesen, text, shell, system, network, fun, editor) lists all of its commands, and `-v` says what each does: `help -v files`, or `help -v` for every category, as `help --all` does.
- Every full-screen app (`sudo`'s show, `sl`, `cmatrix`, the pager of `man` and `less`, `nano`) opens inside the terminal's frame: the same gutter and green border, the cathode overlay, and the text glow of the phosphor and vintage modes. The QR presenter alone stays a plain white sheet, to be scanned.
- The weather card's pictograms are wttr.in's again, as the site drew them before 2.0: the icon table of wego 2.1 (the program wttr.in renders with; ISC licence), row for row, each run in the role of the colour wego gives it. Open-Meteo's codes map to wego's icons as wttr.in groups the like conditions, and the sun shines at night as it does there. The okina of the rain drops joins the terminal font; the figure dash, the Greek psili and the lightning come from a fallback font and are pinned to one cell each, so the grid holds. `weather --legend` lists wego's names.
- The weather card's `°F`, `7 days` and `my location` chips are words in brackets in the text, `[°F] [7 days] [my location]`, underlined under the pointer, not boxes.
- The tab's title is just "Vesen". The link preview's title is "Vesen: Has Salvesen's portfolio as a working terminal", its image keeps "a terminal in your browser" under the new logo, and the search description and the app manifest say the same.
- The banner's logo is a new wordmark: VESEN in figlet's Roman style (`o` serifs, `888` stems), drawn narrower than the font draws it, five rows of 46 columns, with the version after its last row. It is the same on every screen, scaled down to fit a phone rather than swapped for a smaller logo, and the link preview (`public/og.png`) is drawn from it. `scripts/art/wordmark.py`, which drew the old logo's shadow, is gone.
- `fastfetch`'s OS logos are vesen 1.0's again: the apple, the bugdroid, the four panes and Tux, as they were.
- Colour swatches are blocks again (`██`), as before 2.0's ASCII pass: fastfetch's palette and `theme ls`.
- The CRT effect starts in phosphor mode for anyone who has not chosen one, and a phone shows the same phosphor glow as a desktop (the lite tier still drops the sweep and flicker). A `scanlines` saved by the old store, which saved its default on every load, is still dropped, so those visitors get phosphor too.
- `tree` draws box-drawing lines again, as one art block with the rows touching so the lines join, scrolling sideways on a narrow screen. `--charset ascii` draws the ASCII set as ordinary lines.
- The banner says what this is, "A virtual Linux terminal, with its own file system to explore.", and how to start: type help and press Enter, on every device (a phone's keyboard may label that key go, send, return or an arrow, so the banner names none of them). The Tab and arrow-key line and the owner's byline are gone.
- The theme chips, and the Tab list on a keyboard, mark each theme with a small circle in place of a coloured swatch: hollow (`◦`), or filled (`•`) for the theme in use, whose name is bold in the theme's accent (on a phone the whole chip is filled with it). The mark moves the moment the theme changes.
- Tab, the ghost and a chip complete a word without a space after it. A second Tab on a finished word lists what can follow it, and the chips offer the next word as before.
- On a phone or tablet `sudo`'s show covers the whole screen, edge to edge, upright or on its side: no frame or gutter around it, and under the notch and the home indicator too. It turns with the screen: the other cut takes over from where the picture had got to. The "Tap to exit" line is gone (a tap still leaves, and a screen reader still hears how).
- On a keyboard `sudo`'s show says "Press q or Esc to exit" once it has played for three seconds, and nothing before that.
- `sudo`'s track starts without a tap in Safari, on an iPhone or iPad, and in Instagram's and other apps' browsers: the key press that answers the password readies it (they let a page start sound only inside a tap or key press, and the show opens after one).
- The banner has a blank line between the logo and "A virtual Linux terminal, with its own file system to explore."
- Scrolling up while output arrives keeps the view where it was put, with the new output pill, even where the browser reports the scroll late (a slow screen).
- galah wears its bird's colours: its green is a rose pink and its yellow a soft grey, so the frame, the prompt, and fastfetch's logo and title are pink and grey. Success, gains and executables are aqua there, so they never look like its pink errors, and warnings and the weather's sun stay gold.

## [2.0.0] - 2026-10-08

A rewrite of the whole app, built from the audit and plan in [docs/plan](docs/plan). [docs/plan/STATUS.md](docs/plan/STATUS.md) records what was built in each phase and where it differs from the plan; [ADR 0001](docs/adr/0001-architecture.md) records the shared contracts.

### Safety

- Output is never HTML. Commands write text and typed blocks, `OutputView` draws them with text interpolation only, and no `{@html}` is left anywhere. Typed, fetched or file text can no longer run script in the page.
- Tap actions (run, insert, open, copy, share) come only from trusted builders, never from text, escapes or attributes.
- A Content-Security-Policy and the other security headers are enforced from `firebase.json`; `index.html` is never cached and hashed assets are immutable; a terminal-styled 404 page replaces the catch-all rewrite.
- The page boots when storage is blocked, and a stale chunk after a deploy reloads once with a notice.
- Every request has a deadline, every command a budget, and ^C, Escape, the dock's ^C key or the Stop chip ends anything.
- Every regular expression a visitor types passes one guard, so no pattern can freeze the page; long loops (`sed`, `bc`, `yes`) let the page breathe.
- No command holds more than 16 MB of standard input at once, and `$( )` keeps at most 16 MB of output: past that the command says `input too large` and the pipe closes, so `seq 1e9 | sort` fails in a moment instead of filling the memory. Drawings (`figlet`, `cowsay`) count against the screen's caps like text, their message is capped at 4096 characters, and width options such as `figlet -w` are bounded.
- `ping` refuses loopback, private and reserved addresses in every form, IPv4 written inside IPv6 (`::ffff:192.168.1.1`, NAT64, 6to4) and plain numbers (`2130706433`) included, before sending anything.
- The sudo joke's password field is masked, ignored by password managers, and never stored anywhere.
- `sudo` no longer opens or links the YouTube video. Its password prompt reads like sudo's own, with a dim "Ctrl+C or Esc to cancel" (on touch, "Tap Cancel or press Esc to cancel") and `--help` and `man sudo` that describe sudo, nothing more; what is typed is still masked and never kept or sent, as `privacy` says. After the password it puts on a show over the terminal: an ASCII dancer to the owner's own track, played from `/audio/incident-report.mp3` through an audio element made only when the show opens (nothing is fetched at boot or for `--help`), looping at a modest volume, with "Never Logging Out", an 8-bit chiptune written for vesen, as the fallback when the file cannot load or play. Esc, ^C, q, Back and a Close button end it; m or Mute silences it; reduced motion shows one still frame. An optional frames file, `/audio/incident-report.frames`, plays in the dancer's place when the owner provides one (`scripts/ascii-frames.mjs` makes it from PNG frames). A pipe gets the sudoers message alone.

### Shell

- A real shell kernel: one lexer, a parser, quoting, `$'…'`, variables, `${X:-word}` and friends, brace, tilde and pathname expansion, `$( )`, `$(( ))`, field splitting, history expansion, aliases, `&&`, `||`, `!`, pipelines that stream, redirections (`<`, `>`, `>>`, `>|`, `2>`, `&>`, `2>&1`, `<<<`), exit statuses and bash's error wording. See [docs/SHELL.md](docs/SHELL.md).
- A virtual file system with permissions, symlinks, `/proc`, `/dev`, a 512 KB quota, a prompt that follows `cd`, and your changes under `~` and your history kept across visits.
- `/etc/profile` and `~/.bashrc` are read at login; scripts with a shell `#!` line run from `$PATH`.

### Commands

- Every command is one spec that drives running, options, `--help`, `man`, `whatis`, `apropos`, Tab completion, the phone's chips, its `/usr/bin` stub and its man page; every command that is not a builtin answers `--version`.
- About 160 commands. New: the text tools (`grep`, `sed`, `sort`, `uniq`, `cut`, `tr`, `head`, `tail`, `wc`, `nl`, `diff`, `xargs`, `column`, `bc`, `expr`, `base64`, the checksums and more), the file tools (`find`, `tree`, `chmod`, `chown`, `du`, `df`, `realpath`, `file` and more), the system tools (`ps`, `top`, `kill`, `uname`, `free`, `cal`, `id`, `uptime` and more), job builtins (`read`, `time`, `timeout`, `watch`), network tools over HTTPS (`dig`, `host`, `nslookup`, `ping`, `ip`, `ifconfig`, `whois`, `wget`, `git log`), the pager and editor (`less`, `more`, `man` in the pager, `nano`), and fun (`cowsay`, `fortune`, `figlet`, `lolcat`, `sl`, `cmatrix`, `factor`) with art written for vesen.
- After the owner's review: `help` lists every command in columns, one per category (Vesen, its own commands, then Files, Text, Shell, System, Network, Fun and Editor), alphabetical, names only, with nothing cut; the columns reflow with the width, so a desktop shows all eight side by side and a phone three or four to a band, and in a pipe there is one line of names per category. What each command does is in `help --all` and `man vesen`. `theme NAME` switches the theme and `theme set` is gone. The `linkedin` command is gone too, as `whoami` shows and, on a desktop, opens the profile: 157 commands, 60 in the core and 97 in the catalogue.
- Coreutils are silent on success with `-v` to confirm, and use GNU's wording and exit codes.
- `less` opens at `+G`, `+F`, `+NUMBER` or `+/text`, and into a pipe copies like `cat`; `date -d` and `--date` read a date as `touch -d` does, days of the week (`monday`, `next friday`, `last tuesday`) and `9am` or `9:30 pm` included, and refuse a day the month lacks (`2024-02-30`) or a time out of range, in GNU's words; `ip route get ADDRESS` shows the route it would take; `timeout`, `nohup` and `xargs` say `No such file or directory` (127) or `Permission denied` (126) for a command they cannot run; `figlet -f` knows its font's names.
- One process table: `ps`, `top`, `kill`, `pgrep`, `$$` and `/proc` agree, each process has a `/proc/PID` folder, `/proc/self` is the command reading it, and `/dev/pts/0`, which `tty` names, exists.
- New commands load in a catalogue after the kernel, so the first paint and the first command do not wait for them.
- `privacy` lists every service a command talks to and what it is sent; `debug report` copies what a bug report needs.

### Weather, stock and QR

- `weather` draws a card from Open-Meteo, with place search, `weather --here`, units by locale and a curated place table (Gadigal, Aotearoa and the Palestinian place names keep working); the wttr.in scrape is gone.
- `stock` reads quotes through vesen's own Cloudflare Worker (`worker/stock`), with a card, a chart, a table for several tickers, search by name, ranges, market phases, saved copies marked STALE, and an honest interim source until the Worker is deployed.
- After the owner's second review, `weather`'s pictograms are hand-drawn ASCII at the terminal's line height (a shaded sun, a crescent, clouds, rain by intensity, sleet, snow, fog, a bolt, and a question mark for a code it does not know); its range bar is text, `-` for the scale, `=` inside the day's range with each `=` shaded from the cold colour to the hot one along the scale, and `|` at the current temperature; the place shown among same-named matches is marked `*`; facts are separated by ` | `, a cut ends in `...` and an approximate place starts `~`.
- `stock`'s chart is a traced ASCII line with a dotted previous close and an `o` at the last point, its range bars are `[--*----]` tracks, the range shown is marked `*`, and changes carry their sign with no arrow.
- `qr` uses an in-house encoder (the `qrcode` dependency is gone), draws a scannable card in the theme's colours and a black-on-white full-screen Present mode, and saves, shares or copies the image.
- `curl` says plainly what CORS allows; `speedtest` asks before spending data on a phone.

### Phone and Instagram

- The shell is sized to the visible screen above the keyboard, with one scroll owner and no sideways scrolling; pinch zoom is back, with a 16 px touch input that never zooms the page.
- A phone dock: starter and follow-up chips, a key bar (tab, ↑, ↓, ^C, clear, symbols, hide keyboard), a history sheet, and `keys on|off|auto`.
- A tap on the prompt row, or on the space below the last entry, always opens the keyboard: both are tap targets of their own, so iOS WebKit's touch adjustment cannot hand the tap to a tappable name just above them.
- Links open only on a tap inside in-app browsers, in the same view, and Back restores the terminal as it was; link cards with Copy everywhere.
- Back (Android's button, iOS's edge swipe) closes `man`, `less`, `nano`, `cmatrix`, `sl`, the Shutdown screen and QR Present mode and stays in vesen, even while the app is still loading on a slow connection; `nano` asks to save changes first, and asks again at each Back until it is answered. A reload or a return with an app open leaves no step behind, so one Back still leaves.
- `nano` keeps unsaved changes in this browser while Back asks about them and whenever the page is put away, so a Back that leaves vesen anyway loses nothing: the next `nano` of that file offers to restore them.
- `nano`'s prompt row on a phone keeps its label (`Write to:`, `Find:`) and buttons on one line, and its shortcut bar offers ^F for Where Is off a Mac, where ^W would close the tab.
- Output reflows on rotation without re-running; wide tables and drawings scroll inside their own block.

### Prompt and completion

- One completion engine for Tab (extend, list, cycle), ghost text and the chips, from the specs. It never offers a flag's value, `--` or `dig`'s `+option` and `@server` words as an operand, and it follows a command's words where they decide what comes next: only `ip route` offers `get`, which offers addresses rather than devices.
- Follow-up chips, the starters and closed lists (a command's subcommands, a value such as a theme name) are never cut short: after `theme ls` every theme is a chip on a phone, `theme ` offers ls and every theme under a desktop prompt too, and `theme l` offers ls and lorikeet. Only open-ended lists (files, command names, history) keep a cap before Tab.
- The prompt no longer flashes its underline when Tab finds nothing to complete, when Enter meets a running command, or when a key hits the "Display all N possibilities?" question; "No completions" is still announced to screen readers, and errors still ring the bell.
- Tab's list never cuts a command name: with more than sixteen candidates it shows names alone in columns, like `ls`, and names the candidate Tab has reached with its description on a line beneath (on phones too, under the prompt); a shorter list keeps the descriptions beside whole names. A cut description ends in `...`, the password mask is `*`, and the touch placeholder reads "Type a command...".
- A first Tab before the catalogue of commands has arrived waits for it rather than ringing the bell.
- A line editor with a block cursor on desktop, readline keys, the kill ring, reverse search, history prefix search and type-ahead while a command runs.
- A status line while a command runs, and each line's output streams into its entry. `^C` shows where it was pressed: at the end of an unfinished line, and above what the command prints on its way out, such as `ping`'s statistics.

### Look

- Role colours (`--role-*`) over each theme's palette, with every theme passing WCAG contrast; cockatoo and swamphen adjusted to pass.
- Vesen Mono, a self-hosted subset of Cascadia Code under the SIL OFL.
- A new VESEN wordmark in the banner, bold and italic in block characters with a drop shadow drawn in colons, with a compact one on phones; the link preview matches. The banner also says this is a virtual file system and points at `tree`. The version sits on the wordmark's last row of letters, and the lines beneath read as a welcome: who made it, then `help`, `tree` and `cat README.md` as first steps, then the keys ("the up arrow brings the last one back") or, on touch, the chips.
- Fifteen themes: five new ones named for Australian animals, galah, lorikeet, magpie, platypus and quokka (the second light theme), with every palette slot readable at 4.5:1.
- Tappable names carry no underline until hovered or focused, and under `cathode phosphor` and `vintage` they glow like the text beside them (browsers give buttons no text shadow of their own).
- Every glyph on the page comes from Vesen Mono, checked by `npm run check:glyphs`: the mail card's and link cards' icons, the dock's keys, the Shutdown screen and the stock card no longer fall back to another font.
- After the owner's second review, everything vesen draws is drawn in ASCII on the character grid, as a text-mode terminal draws it: art, bars, charts, rules, connectors, spinners, markers, bullets and separators, never a CSS strip, an SVG chart or block shading. Box drawing and half blocks stay only where the thing is that by nature (the wordmark's letters and the scannable QR code); prose keeps its typography, and a command that imitates a Linux tool keeps that tool's format.
- `fastfetch`'s Apple, Android, Windows and Linux logos are fine ASCII tracings in letters and punctuation, traced in the terminal's own font from silhouettes drawn for vesen and shown at the normal line height, as `cowsay`'s animals are; the tools that drew them are in `scripts/art/`.
- `tree` prints `|--` and `` `-- `` connectors at the terminal's line height, with `--charset utf-8` for box drawing; `figlet` inks with `#`; the status line spins `| / - \` (a still `...` under reduced motion); `cmatrix` rains ASCII; swatches are `##` cells; `theme ls` and `cathode ls` mark the current entry `*` in the foreground instead of colouring its name.
- Vesen's own text uses ASCII punctuation: `->` on link cards and in the in-app hint (`... -> Open in browser`), `...` on the dock's symbols key, `>` on a chip that runs a line, ` | ` between facts (the QR meta line, the status line's elapsed time), `*` for bullets and markers, on the Shutdown screen, in the pager's hint, `privacy`, `debug`, the stale-chunk notice, the prompt's cut folder name, `help keys` and every status label.
- `weather` names the other matches for an ambiguous place as tappable chips with the chosen one marked `*`, and its header states the units in use.
- CRT tiers: full on desktop, a lighter static effect on phones and in-app browsers, off under reduced motion, more contrast or forced colours.
- Link preview, icons and a web manifest.

### Tooling

- Svelte 5, Vite 8, TypeScript 6, Node 22.12 or later.
- Vitest unit tests (node and happy-dom), command transcripts, an XSS corpus and recorded network fixtures; Playwright on desktop Chrome, iPhone in Instagram (WebKit) and Pixel 7.
- CI gates every pull request and push to `main` on svelte-check, strict types, module boundaries, unit tests, the build, bundle budgets, contrast and the smoke tests, then deploys the tested build to a Firebase preview channel or to live.
- Contributor docs: [CONTRIBUTING.md](CONTRIBUTING.md), [SECURITY.md](SECURITY.md), [docs/ADDING_COMMANDS.md](docs/ADDING_COMMANDS.md), issue forms and a pull request template.

### Also since 1.2.0, before the rewrite

- `cathode`, a CRT effect with scanlines on by default (July 2026).
- `qr`, with colour fixes across themes (February 2026).
- A new speedtest service, suggestions for `cat` and `rm`, and a banner with the prompt (January and February 2026).

### Removed

- The legacy command layer, its HTML output and `src/utils`; the dormant analytics code; the Docker image; `curl`'s chain of public CORS proxies (it now says what CORS allows, and `--via-proxy` uses vesen's own proxy when one is configured).

## [1.2.0] - 2026-01-25

### Added

- Ghost-text suggestions for the command being typed, including weather places.
- `exit` and `poweroff`, dynamic favicons that follow the theme, and a catch for mistyped help flags.

### Changed

- `help` and the suggestion layout redesigned; the guided `demo` command removed; theme colours adjusted, swamphen and wallaby among them.
- `fastfetch` output follows theme changes, and fails softly when a hardened browser blocks an API.
- Firebase Hosting serves the app instead of its default landing page.

### Fixed

- Ctrl+C styling for network commands, banner wrapping on desktop and phones, and `sudo` asking twice for a password.

## [1.1.0] - 2025-09-27

### Added

- `fastfetch`, with User-Agent Client Hints for more accurate system details, replacing the earlier system summary.
- `speedtest`.
- `history` and `ls -a`, with hidden files hidden by default.
- Ctrl+C to interrupt network requests, a sound for unknown commands, and several fallbacks for `curl`.

### Changed

- More accurate place lookup for `weather`; better layout of `weather` and system output on phones.
- Themes renamed, recoloured for contrast and ordered alphabetically, with new screenshots.

### Fixed

- The banner renders at once; history navigation after a failed command; long input truncates instead of overflowing; focus on phones.

## [1.0.0] - 2025-07-20

### Added

- The first release of the vesen terminal: a virtual file system with `ls`, `cd`, `cat`, `mkdir`, `echo` and more, `help` with command descriptions, `weather`, `stock` (Yahoo Finance), `curl`, themes named for Australian animals that recolour earlier output when changed, and deployment to Firebase Hosting from CI.

[Unreleased]: https://github.com/hsalvesen/vesen/compare/v2.0.0...HEAD
[2.0.0]: https://github.com/hsalvesen/vesen/compare/v1.2.0...v2.0.0
[1.2.0]: https://github.com/hsalvesen/vesen/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/hsalvesen/vesen/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/hsalvesen/vesen/releases/tag/v1.0.0
