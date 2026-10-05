# Shell architecture: reference design

> **How to read this file.** This is the full design that a three-way design panel produced and a judge synthesised for this workstream. It is the detailed reference: interfaces, file plan, steps and tests. Where it conflicts with the shared decisions in [../02-architecture-and-contracts.md](../02-architecture-and-contracts.md) or with the sequencing in [../08-shell-and-commands.md](../08-shell-and-commands.md), **those documents win**. Line numbers refer to `main` at commit 23758b9 (5 October 2026).

**Chosen approach:** Strangler Shell, phone-first: a DOM-free shell kernel placed in front of the existing commands, with typed CommandSpecs, escaped span/block output, and a pure line editor with tap completion

## How it was chosen

- **Strangler Shell: a thin POSIX-style core placed in front of the existing commands, migrated one deployable PR at a time** scored 8.1. Feasibility 9, UX 7, maintainability 8, effort 9, risk 8; weighted total 8.1.

Strengths:
- Most feasible backbone. Every step ships behind a legacy adapter.
- All current XSS sinks (History.svelte:20, CommandSuggestionsRow.svelte:62) are closed in step 1 with no visual change.
- The new Vfs class wraps the existing literal tree, so unported legacy commands that walk `virtualFileSystem` keep working.
- Its claim that features-grep merges cleanly is correct. I verified it: `git merge-tree --write-tree main features-grep` exits 0, and the three-dot diff touches only fileSystem.ts (+151/-4) and helpTexts.ts (+2).
- Realistic 20 d estimate.
- Strong test plan: executable spec examples, a parity test and an XSS corpus.

Weaknesses:
- It keeps the input disabled while a job runs 'as today'. That contradicts F012: Input.svelte:305 and :667 make iOS drop the keyboard.
- No readline keys, no PS2 continuation and no phone key bar.
- Pipelines are sequential and buffered, so nothing streams through a pipe.
- It keeps a permanent in-house HTML sanitiser just for the owner's styled files.
- It calls window.open after async work, with no path that keeps the user gesture.

- **Ports-and-adapters shell kernel: pure TS core, ANSI-only output, Svelte as thin adapter, legacy shim** scored 7.1. Feasibility 7, UX 7.5, maintainability 9, effort 5, risk 6; weighted total 7.1.

Strengths: the cleanest architecture of the three.
- DOM-free core enforced by a boundary script, plus a strict tsconfig for new folders (F084).
- Pure line-editor reducer.
- Concurrent pipes with backpressure and EPIPE.
- Input never disabled; PS2 continuation; phone key bar.
- `?cmd=` deep link fills the prompt only.
- Typed HttpClient with NetError.
- Playwright with an Instagram UA.

Weaknesses:
- Step 8 swaps the whole UI in one 3-day go.
- ANSI-only output turns the fastfetch and stock layouts into column text and drops the owner's live theme highlight.
- OSC 8 'vesen:run?' links are parsed out of the byte stream, so `cat` or `curl` output could plant tap-to-run commands.
- 36 d estimate.
- One factual error: it says merging features-grep would delete Cathode.svelte and the CRT CSS. That only shows up in a two-dot diff; the actual merge is clean (see design 0).

- **Experience-first shell kernel ("vesh"): typed spec registry, pure-TS kernel, text-only output, built phone-first** scored 7.8. Feasibility 7, UX 9.5, maintainability 8, effort 7, risk 6.5; weighted total 7.8.

Strengths: the best UX thinking for the Instagram visitor.
- A synchronous preflight runs window.open inside the Enter or tap gesture. Today whoami opens synchronously at system.ts:10; an async shell would lose that.
- Link cards with Copy; in-app browser awareness.
- Accessory bar, starter chips and next-step chips.
- 16px, IME-safe input that is never disabled; visual bell on touch.
- Ctrl+C copies when text is selected (F014).
- Rich Blocks with plain() fallbacks for pipes.
- Actions can only be built by trusted code, never parsed from text.
- LiveBinding keeps the theme highlight reactive with no DOM patching.

Weaknesses:
- A desktop mirror editor, which carries IME risk.
- IndexedDB-first persistence with an async boot gate.
- The owner's styled docs are rewritten as plain Markdown, losing their exact colours.
- Many owner-visible changes: the 'vesh' name, host 'vesen', a whoami card, new reset semantics, silent coreutils.
- 24 d estimate.


Ideas grafted from the other candidates:

- From design 2 (experience-first): a synchronous preflight hook, `spec.opens(argv)`, run from the Enter or chip-tap handler before the async job starts, so window.open keeps the user gesture. Instagram, Facebook and TikTok in-app browsers are detected and skip window.open. Every opener also prints a link card with Copy.
- From design 2: a Block layer (grid, table, art, panel, chips, card, columns) with a plain() fallback for pipes and files. Actions (run, insert, open, copy, share) can only be built by trusted builders in command code, never parsed from SGR, OSC 8 or HTML. This closes the hole design 1 leaves with tap-to-run links parsed out of the byte stream.
- From design 2: LiveBinding spans (isCurrentTheme, isCurrentCathode, currentThemeName). The theme/cathode highlight and fastfetch's 'WM Theme' stay reactive, and the DOM patching in src/stores/theme.ts:33-55 and src/stores/cathode.ts:42-49 is deleted.
- From design 2: phone accessory bar ([Tab] [up] [down] [^C] plus completion chips), starter chips on an empty prompt (from spec examples flagged offline), next-step chips, a visual bell on touch, an input that is never disabled with type-ahead, Ctrl+C copying when text is selected, the '$' turning red after a failure, and hints for commands found on other systems (vim -> nano, apt -> explanation, cls -> clear).
- From design 1 (ports-and-adapters): a pure line-editor reducer (Tab state machine, history prefix search, Ctrl+R, kill ring, PS2 continuation), unit-tested in node.
- From designs 1 and 2: concurrent pipeline stages over bounded async pipes (64 KiB high-water mark, EPIPE leads to a silent 141), replacing design 0's sequential buffered pipes.
- From design 1: a DOM-free core (src/shell, src/output, src/vfs, src/commands) enforced by scripts/check-boundaries.mjs and a strict tsconfig for the new folders (F084). The kernel exposes a tiny Readable that follows the Svelte store contract, so the core never imports svelte.
- From design 1: service ports injected through ctx: Net (timeouts, NetError, memo cache), SysInfo (one source), Appearance (over the theme and cathode stores) and Clock. The registry throws on duplicate names or aliases.
- From design 1: the owner's styled files (README.md, history.txt, linux.txt) are converted once to a tiny {cyan,bold}...{/} markup and parsed into plain text plus styled lines. grep, wc and nano see real text, cat on a TTY keeps the exact colours, and no permanent HTML sanitiser is needed.
- From design 1: the ?cmd= deep link fills the prompt but never runs it. The theme is persisted by name under vesen:theme, migrated from 'colorscheme' (fixes stale colours for returning visitors).
- From designs 1 and 2: '-h' means help unless the spec defines an h flag. This replaces design 0's legacy-only rule, so ls -h, df -h and free -h work.
- From designs 1 and 2: persistence as an overlay over the seed (changed paths, whiteouts, seedVersion), so seed updates still reach returning visitors.
- From designs 1 and 2: a read-only /home/has portfolio home (about.md, projects.md, .plan) for `finger has` and exploration.
- From designs 1 and 2: Playwright projects for Desktop Chrome, WebKit iPhone with an Instagram user agent, and Pixel, plus recorded network fixtures (timeout, offline, 429, CORS).
- From design 2: DOMPurify (RETURN_DOM_FRAGMENT, so nothing is re-serialised) with design 0's exact tag, attribute, class and CSS allowlist, for the temporary legacy shim only. It is deleted at cleanup, so the security-critical parser is not hand-written.

## Summary

Start from design 0's strangler migration. A small DOM-free kernel (lexer, parser, history/alias/word expansion, glob, executor, registry, flags, help, completion) sits between the input and today's `commands` record. All 26 existing commands are wrapped unchanged by a legacy adapter, so quotes, pipes, redirection, ; && ||, variables, ~, globs, aliases, !! and $? work for every command from the first core PR.

Output is escaped by default. Commands write text with an SGR subset, styled spans, or trusted layout Blocks; the renderer only creates text nodes. Legacy HTML goes through a temporary DOMPurify fragment shim that is deleted when the last command is ported.

The file system becomes a Vfs class over the existing tree literal, with these fixes and additions:
- re-homed to /home/guest
- permissions, symlinks, /proc, /dev and /etc
- the owner's styled docs converted to a colour markup
- a localStorage overlay for persistence

cwd becomes a store and each transcript entry snapshots its prompt.

From design 2 it grafts the phone layer: synchronous window.open preflight inside the gesture, link cards, accessory bar and chips, an input that is never disabled, and trusted-only actions. From design 1 it grafts the pure editor reducer, concurrent pipes, boundary checks and service ports.

The work is ten shippable PRs plus six command waves, about 26 dev-days. XSS is closed by day 1.5, the shell grammar works for all commands by about day 4.5, the prompt follows cd by about day 6.5, and phone tap-completion lands by about day 12.

## Architecture

0. JUDGE-VERIFIED BASELINE (read from main on 2026-10-06; the design reacts to these)
- Output and XSS:
  - Raw HTML sinks: {@html} at src/components/History.svelte:20 and src/components/CommandSuggestionsRow.svelte:62.
  - The dispatcher splits on /\s+/ (src/utils/commands.ts:319) while Input splits on a single space (src/components/Input.svelte:262).
  - -h/--help anywhere hijacks the line (commands.ts:321).
  - The abortable-command allowlist is at commands.ts:343 and Input.svelte:294-300.
- Input:
  - Disabled during every command (Input.svelte:305 and :667).
  - Phone font size 0.75rem, i.e. 12px, which triggers iOS focus zoom (Input.svelte:674).
  - Global Ctrl+C always handled (Input.svelte:194).
  - Every argument is sent to umami (Input.svelte:265, src/utils/tracking.ts:9-14).
- Prompt and cwd:
  - currentDir is the constant '~' (src/components/Ps1.svelte:4), and History renders <Ps1 /> without props (History.svelte:11).
  - cwd is a mutable exported array (src/utils/virtualFileSystem.ts:472) that legacy cd rewrites in place (src/utils/commands/fileSystem.ts:201-202, 233-234).
- Home directory: /home/user closes at virtualFileSystem.ts:204-205, and 'projects', the dotfiles, etc. start at :206 as its siblings (F003).
- reset is defined twice:
  - commands.ts:116-141 resets to swamphen and also resets cwd, VFS and history.
  - fileSystem.ts:479-501 resets to petroica; it is dead code because of the spread order at commands.ts:458-465.
- Direct DOM and window access from commands:
  - whoami, repo and email call window.open synchronously inside the Enter keydown path (src/utils/commands/system.ts:10, commands.ts:274, :293).
  - poweroff queries stale selectors and rewrites document.body (fileSystem.ts:515-538).
- Stores with side effects at import:
  - history.ts:6-7 wipes storage; :22-28 serialises the transcript.
  - theme.ts:81-82 reads localStorage unguarded; :100 persists the whole theme object; :33-55 patches past output in the DOM.
- Build, CI and deploy:
  - CI runs only `npm ci && npm run build` (.github/workflows/firebase-hosting-merge.yml:13).
  - tsconfig.json has strict:false.
  - The Docker image's final stage is busybox httpd (Dockerfile:12-15), which cannot send custom headers, so CSP needs a <meta> copy as well as the firebase.json header.
- features-grep: `git merge-tree --write-tree main features-grep` exits 0, and the three-dot diff is 2 files, with escapeHtml at features-grep:src/utils/commands/fileSystem.ts:62. It is merged in step 0. Design 1's claim that the merge deletes Cathode.svelte is wrong.

1. LAYERS AND THE DEPENDENCY RULE (scripts/check-boundaries.mjs in CI)
ui/ (Svelte) -> stores/ -> app/bootstrap.ts (the composition root; the only place concrete services are built). Under it:
- commands/ may import shell/, output/, vfs/ types and service interfaces only.
- shell/ may import output/ and vfs/.
- services/ and platform/ are the only code that may touch window, document, navigator, fetch or localStorage.
- shell/, output/, vfs/ and commands/ must not reference window, document, navigator, localStorage or 'svelte'. They compile under tsconfig.strict.json.
- No module has import-time side effects. The banner, theme application and storage wipes move into bootstrap().
- '{@html' is allowed only in ui/OutputView.svelte's legacy branch until cleanup, then nowhere.

2. RUNTIME FLOW FOR ONE LINE
1. Input. The ui/lineEditor.ts reducer emits {t:'submit', line} on Enter, or a chip with action 'run' submits.
2. Preflight, synchronous and still inside the gesture. shell.preflight(line) lexes and parses. If the line is a single simple command whose spec has opens(argv) and we are not in an in-app browser, it calls window.open(url,'_blank','noopener') now and records opened or blocked for the job.
3. shell.start(line, origin) returns a JobHandle:
   a) History expansion on the raw line: !! !n !-n !prefix !$ ^a^b. Not applied inside single quotes. '!' before a blank, '=' or end of line stays literal. If the line changed, the expanded line is what is shown and stored.
   b) lex() and parse() produce List -> AndOr -> Pipeline(!negate) -> SimpleCommand{assigns, words, redirects}.
      - Incomplete input (open quote, trailing | && || or a backslash) gives the editor a PS2 '> ' prompt.
      - A syntax error prints `vesen: syntax error near unexpected token '|'` with status 2.
      - if/for/while/case/function/heredoc print `vesen: for: not supported in vesen` with status 2.
      - A trailing '&' runs in the foreground with a one-line notice.
   c) Alias splicing on the token stream at command-start positions, with a seen-set; the bash trailing-space rule applies.
   d) For each AndOr, run the pipelines with && / || short-circuiting on $?. ';' sequences.
4. Each pipeline starts all its stages concurrently, joined by bounded AsyncPipes (64 KiB high-water mark). A write after the reader closes throws EPIPE and the stage exits 141 silently, which is how `yes | head -3` ends. The status is the last stage's, negated by '!'.
5. Per SimpleCommand, in order:
   - Expansion:
     - tilde: ~ ~/x ~guest ~has ~+ ~-
     - parameters: $X ${X} ${X:-d} ${X:=d} ${X:+d} $? $$ $# $0 $RANDOM $PWD
     - command substitution $( ) and backticks (wave B)
     - arithmetic $(( )) (wave B, in-house parser, no eval)
     - IFS field splitting of unquoted expansions
     - glob * ? [..] [!x] against the VFS: sorted; dotfiles only with a leading '.'; no match keeps the literal
     - quote removal
   - Prefix assignments: `A=1` alone sets a shell variable; `A=1 cmd` scopes it to cmd's env.
   - Redirects, applied left to right: < > >> 2> 2>> &> 2>&1 >&2 <<< (wave B). Targets are VfsWriteStreams that respect noclobber. /dev/null is a sink.
   - Resolution order:
     1. Builtin or registry name/alias.
     2. A word containing '/', or found on $PATH (~/bin, /usr/local/bin), that is an executable '#!' VFS file runs as a script, line by line through the same shell, with $1..$9 and depth limit 16.
     3. Otherwise `vesen: foo: command not found` with status 127, a tappable did-you-mean (case-insensitive match, then prefix, then Damerau-Levenshtein <= 2), and hints for commands that exist elsewhere. The concatenated 'pwd--help' hint from commands.ts:324-334 is kept.
   - Flags are parsed getopt_long-style from spec.flags:
     - combined shorts (-la), -n5 and -n 5, --x=v and --x v, --, '-' as an operand
     - GNU argument permutation, or stop at the first operand when posixArgs is set
     - numeric shortcut: head -5 means head -n 5
     - unknown option: `ls: invalid option -- 'z'` plus `Try 'ls --help' for more information.`, status 2
     - --help is always intercepted
     - -h means help unless the spec defines an h flag
   - run(ctx) inside try/catch:
     - VfsError -> `cat: x: No such file or directory`, status 1
     - UsageError -> status 2
     - AbortError -> '^C', status 130, and the rest of the line is skipped
     - NetError -> the curl-style message, status 1 (curl uses its own codes 6/7/28)
6. Job and ^C. Each submitted job gets one AbortController (replaces the three allowlists). ^C, the [^C] chip or Escape-while-busy aborts it, waits 100 ms, then detaches: later writes are dropped and status becomes 130.
7. Network deadline. A spec with network:true gets ctx.signal combined with a timeout (8 s default, spec-overridable, 15 s cap). A manual signal-combining helper is used because AbortSignal.any needs iOS 17.4.
8. Bell and analytics. At most one bell per job, when the status is 127, a syntax error, or a TTY stderr write. This replaces about 30 scattered playBeep calls. Analytics receive argv[0] (registered names only), the exit status and the device class, never arguments.
9. Rendering. The TTY sink appends Blocks to the job's ScreenEntry, flushed once per requestAnimationFrame. The entry is created at submit, so the typed line is committed immediately (F013). $? and lastStatus are set at the end.

3. OUTPUT MODEL (src/output, DOM-free)
What travels on streams:
- Text, with SGR interpreted only when isTTY:
  - 0 resets; 1/2/3/4/7/9 set bold, dim, italic, underline, inverse, strike; 22-29 turn them off.
  - 30-37 and 90-97 map 1:1 onto the 16 themes.json keys; 39 and 49 restore the defaults; 40-47 and 100-107 set the background.
  - 38;5 and 38;2 are dropped to keep the theme coherent.
  - ESC[2J and ESC c clear the screen.
  - OSC 8 becomes an href, only for http:, https: and mailto:.
  - Everything else is dropped.
- Through pipes and files, the bytes pass literally, as on Linux. ctx.fmt.* emits SGR only when stdout.isTTY, so `ls | cat` is one plain name per line.
- Blocks, written with stdout.block(b), for rich layout: lines, grid, table, art, panel, chips, card, columns. On a non-TTY they degrade to plain(b).

Rules:
- Actions (run, insert, open, copy, share) exist only on Spans and Blocks built in command code. sgr.ts and markup.ts can never produce one, so curl output, a cat'ed file or an echoed string cannot plant a tappable command.
- Colours are tokens:
  - Palette keys render as var(--theme-*).
  - Role keys (muted, accent, ok, warn, error, link, promptUser, promptHost, promptPath) render as var(--role-*). bootstrap defaults these from the palette; the UI workstream tunes them for contrast (F068).
  - Old output therefore re-themes with no DOM patching (F009).
- LiveBinding spans (isCurrentTheme, isCurrentCathode, currentThemeName) derive their class or text from the theme and cathode stores at render time. This keeps the owner's live highlight and deletes the DOM patching at theme.ts:33-55 and cathode.ts:42-49.
- Layout reflows without re-running commands (F015, F016):
  - grid uses CSS repeat(auto-fill, minmax(Nch, 1fr)).
  - table stacks into 'key: value' rows below stackBelowCols.
  - columns stacks below its threshold (fastfetch, stock).
  - art never wraps: it scales its font to fit the measured columns, or scrolls inside itself, and carries alt text (F094).
  - text lines use pre-wrap plus overflow-wrap:anywhere.
  - The global 'pre { white-space: pre-wrap !important }' rule goes.
- ui/OutputView.svelte + SpanView.svelte render with {text} interpolation only:
  - href becomes <a target=_blank rel='noopener noreferrer'>.
  - action becomes a <button> (min 44px tap target on touch) dispatched to the editor or shell.
  - card becomes a real <a> plus a Copy button.
  - panel is today's callout look (4px left border, tint), defined once; the five copy-pasted cancelled panels are deleted.
- legacyHtml blocks (adapter only) render through a `use:legacyHtml` action: DOMPurify.sanitize(html, {RETURN_DOM_FRAGMENT:true, ...}) with this allowlist:
  - tags: span, div, pre, br, b, strong, i, em, u, a, p, code
  - attributes: style, class (only theme-name, cathode-name, current-theme-name, is-current), data-theme-name, data-cathode-name, href (^(https?:|mailto:))
  - a uponSanitizeAttribute hook re-parses style through CSSStyleDeclaration, keeps only design 0's property inventory (color, background*, font-*, text-decoration, white-space, display, flex*, gap, align-items, justify-content, *width, margin*, padding*, border-left, border-radius, position, inset, opacity, line-height, letter-spacing, overflow-x, overflow-wrap, word-wrap, word-break), and drops any value containing url(, expression, javascript: or a backslash.
  On a pipe or file, htmlToText() turns <br> and block ends into newlines and &nbsp; into spaces, so `cat README.md | grep Type` works before cat is ported.

4. LEGACY ADAPTER (src/commands/legacy.ts, deleted in step 7)
legacy(name, fn, meta) creates a CommandSpec:
- meta supplies category, summary (from today's unused commandDescriptions at helpTexts.ts:83-110), args/subcommands for completion, network and legacyHelp (commandHelp HTML).
- run() links an AbortController to ctx.signal (plus the network deadline), awaits fn(ctx.args, ac), and sends the result to ctx.stdout.html().
- It returns 1 if the output contains 'var(--theme-red)' or 'not found', otherwise 0, so && chains mostly stop after legacy failures.
- -h and --help render the legacy help panel.
- After each legacy command, the cwd store is reconciled from the currentPath mirror. Only reset touches it once cd is ported in step 3.

5. VFS (src/vfs, DOM-free)
Structure:
- A Vfs class over the same VirtualFile literal shape:
  - children become Object.create(null) records (F031), so legacy `children[seg]` lookups keep working; validateName rejects '', '.', '..' and names containing '/'.
  - New optional fields, filled with defaults at seed: mode, owner, group, mtime, target (symlink), styled (Line[] from markup, cleared on any write), generate (/proc, never persisted), device (/dev), builtin (/usr/bin stub -> registry name).
- One path module: normalise, resolve(path, cwd, home), dirname/basename, and realpath with ELOOP after 40 hops. It replaces resolvePath (virtualFileSystem.ts:488-517) and the nine copied walk loops (F021).
- Errors are a typed VfsError (ENOENT, ENOTDIR, EISDIR, EEXIST, EACCES, EPERM, ENOTEMPTY, ELOOP, EINVAL, ENOSPC) with Linux strerror text.

Permissions:
- Credentials are guest, uid 1000, groups [1000]. Owner/group/other r, w and x bits are checked.
- A directory needs x to traverse and w to create or delete in it.
- /tmp is 1777, /root 700, /etc/shadow 640 root:shadow, /home/has 755 has:has with read-only files.
- System paths are root-owned, so `touch /etc/x` gives Permission denied (F082).
- rm refuses '.', '..' and '/', using GNU wording. Removing an ancestor of cwd leaves the cwd dangling, and the prompt shows it (F020).

Seed (src/vfs/seed.ts):
- / with bin -> usr/bin
- /boot/vmlinuz-6.6.0-vesen
- /dev: null, zero, random, urandom, tty
- /etc: hostname, hosts, os-release, passwd (root, has:1000? no — has uid 1001, guest uid 1000), group, shadow, shells, motd, profile, timezone
- /home/guest (HOME): today's README.md, history.txt and documents/, plus everything currently misnested under /home: projects, desktop, downloads, bin, src, .bashrc, .ssh (F003). Adds .bash_history.
- /home/has: owner-supplied about.md, projects.md, .plan
- /home/user -> guest compat symlink, so existing examples such as `cd /home/user` still work
- /proc: cpuinfo, meminfo, version, uptime, loadavg, mounts, self -> 1, 1/status
- /root, /tmp, /usr/bin (generated from the registry), /usr/local/bin, /usr/share/man/man1 (generated)
- /var/log/syslog
- Identity is one module: user guest, uid 1000, HOME /home/guest, host from HOSTNAME. It is read by the prompt, passwd, id, whoami-when-piped and fastfetch (F024).

Content:
- public/{README.md, history.txt, linux.txt} are converted once by scripts/convert-content.mjs. Their inline <span style=color:var(--theme-x)> become {x}...{/} markup, stored at src/content/*.vt and imported with ?raw.
- markup.ts produces {text, lines}. The VFS stores the plain text, so grep, wc and nano see the real text, plus the styled lines for cat on a TTY. Any write clears the styled lines.
- This removes the runtime fetch with its 3-path fallback and the index.html soft-404 file (fileSystem.ts:12-36, firebase.json:9-14).

Persistence (src/vfs/persist.ts over services/storage.ts):
- What is saved:
  - Key `vesen:fs:v1` = {v:1, seedVersion, savedAt, overlay: {path: node | {whiteout:true}}}, for /home/guest only.
  - `vesen:history:v1`: HISTSIZE 500, HISTCONTROL=ignoreboth.
- How it is saved:
  - Debounced 300 ms after each mutating job.
  - Capped at 512 KB; beyond that, writes fail with 'No space left on device'.
  - Every access is in try/catch. If storage is unavailable, corrupt or from an unknown version, the shell silently uses memory, with one dim notice per session.
  - When seedVersion changes, the user overlay is replayed onto the new seed; user files win.
- Theme and cathode:
  - The theme is saved by name under `vesen:theme`, migrated from `colorscheme`.
  - The cathode key is unchanged.
  - The old `history` and `commandHistory` keys are removed once.
- IndexedDB can later replace localStorage behind the KV interface without touching callers.
- Boot order: seed, overlay, env defaults, /etc/profile, then source ~/.bashrc with errors suppressed. So ll, la and l work (F072). Aliases and exports typed at the prompt last only for the session, as in bash.

6. STATE
- shell/observable.ts provides readable/writable objects that follow the Svelte store contract without importing svelte.
- Session exposes these as stores:
  - cwd
  - lastStatus
  - job {running, label, name, startedAt}, which replaces speedtestPhase (history.ts:20)
  - termSize {cols, rows}, measured by platform/measure.ts with a hidden 1ch probe and a ResizeObserver on <main>; it feeds $COLUMNS, $LINES and ctx.stdout.columns and replaces the window.innerWidth/8 maths at commands.ts:26-32 and 60-66, fileSystem.ts:113-119 and mobile.ts:38-51
- stores/screen.ts holds ScreenEntry[], capped at 1000 entries and 20k lines with '[output truncated]'. It replaces stores/history.ts and is never persisted (F025).
- Each entry stores its prompt Line snapshot taken at submit (F023).
- ui/Prompt.svelte renders the live PS1 from $cwd and $lastStatus. The default PS1 reproduces today's colours (user yellow, @ white, host green, path blue, $ white) and turns '$' red after a non-zero status. \w is trimmed to '~/.../dir' when cols < 50.
- stores/theme.ts and stores/cathode.ts become pure stores. bootstrap applies CSS variables and the favicon from one subscription, using setAttribute('sizes','any'), which fixes both svelte-check errors at theme.ts:71 and :78.
- Commands reach theme and cathode only through services/appearance.ts (F030).

7. COMPLETION AND LINE EDITOR
shell/complete.ts provides complete(line, cursor, mode:'tab'|'suggest'):
- It lexes in partial mode up to the cursor: open-quote state, the word span, and its index inside the current simple command (after the last | ; && ||, or after a sudo/time/xargs/man/which prefix).
- Candidate sources by position:
  - command position: commands, aliases and builtins
  - after a redirect operator: paths
  - a word starting with '-': spec flags, with descriptions
  - after a flag that takes a value: that value's kind
  - otherwise: subcommands, then the ArgSpec kind (path, file, dir, exec, command, var, alias, theme, cathode, choice, ...) or spec.complete
  - a '$' prefix: variable names
- Paths complete through ~, absolute paths, .., and nested directories. Dotfiles only appear after a leading '.'. Spaces are backslash-escaped. Directories get '/', everything else ' '.
- Matching is case-sensitive first, then case-insensitive.
- It returns {from, to, word, candidates, common, context}. The common prefix is computed once, replacing the 8 copies at Input.svelte:398-607.
- mode 'suggest' adds spec.examples (offline ones) when the operand is empty, and featured commands plus the last 3 history lines when the line is empty.

ui/lineEditor.ts is a pure reducer, (state, action) -> {state, effects}:
- Tab:
  - Tab 1: insert the single match or extend to the common prefix; bell when nothing changes.
  - Tab 2 on an unchanged line: list the candidates under the prompt (desktop columns with descriptions; phone chips). Over 100 candidates: 'Display all N possibilities? (y or n)'.
  - Tab 3 and later: menu-cycle. Shift+Tab goes back, Esc restores the original word, typing accepts.
- Up/Down history, filtered by prefix when the line is not empty; the draft is kept.
- Ctrl+R reverse-i-search.
- Ctrl+A/E/U/K/W/Y, Alt+B/F.
- Ctrl+L clears the screen and keeps the line.
- Ctrl+C: copy if text is selected (F014); otherwise interrupt, or '^C' plus a new prompt when idle.
- Ctrl+D on an empty line prints 'logout' and '[Process completed]'; a tap or key starts a fresh session with the files kept.
- PS2 continuation buffer; secret mode for readLine; type-ahead while a job runs.

ui/LineEditor.svelte:
- One native <input> on every device. The desktop mirror and ghost text are an opt-in polish item in wave F.
- Font size at least 16px under (pointer: coarse).
- Attributes: enterkeyhint=go, autocapitalize=none, autocorrect=off, spellcheck=false, autocomplete=off, aria-label 'Terminal command'.
- The value and selection are read from input/selectionchange events, so IME and Gboard keyCode 229 are safe.
- Never disabled or blurred while busy (F012).
- A single key dispatcher with an explicit focus owner (prompt, readLine or fullscreen) replaces the window-wide handlers at Input.svelte:151 and :645-652.

8. PHONE AND IN-APP LAYER (behaviour owned here; visual tokens owned by the UI workstream)
- platform/env.ts: touch = matchMedia('(pointer: coarse)'); inApp is detected from the UA tokens Instagram, FBAN/FBAV and musical_ly; reducedMotion; online.
- platform/viewport.ts: visualViewport resize/scroll sets --app-h and --kb-inset, so the prompt and accessory bar sit on the keyboard (F076).
- ui/AccessoryBar.svelte replaces CommandSuggestionsRow:
  - Layout: [Tab] [up] [down] [^C] | scrolling chips | [hide keyboard].
  - Chips are completion candidates. On an empty line they are starter chips (help, whoami, ls -la, cat README.md, fastfetch, theme ls, weather Gadigal).
  - While a job runs, a red [Stop] chip shows instead (F047, F067).
  - Buttons are <button role=option>, at least 44px, and use pointerdown + preventDefault so the keyboard stays open. The input carries aria-controls and aria-activedescendant.
- Next-step chips come from spec.next(result), e.g. after `mkdir x` -> [cd x] [ls].
- On touch the bell is visual: a 150 ms border flash in the error role colour. It is audible only with `export BELL_STYLE=audible`. One shared, lazily created AudioContext replaces the per-beep one at src/utils/beep.js:4.
- Openers (whoami/linkedin, repo, email, the sudo gag) always print a card with Copy. On desktop the preflight also opens the URL. Inside an in-app browser nothing navigates without a tap, and a one-time dim hint reads '... -> Open in browser'.
- ?cmd=<line> fills the prompt and never runs it.
- Focus: tapping empty terminal area focuses the input with preventScroll. Taps that dragged more than 10px, hit a link or chip, or have an active selection are ignored (F011).
- Scroll: one stick-to-bottom rule in ui/Terminal.svelte (within 40px of the bottom; otherwise a '↓ new output' pill). This replaces App.svelte:19-56 (F010).
- Accessibility: the transcript has role=log aria-live=polite; aria-busy is set while a job runs; Ps1 becomes a <span>, with one visually hidden <h1> (F094).

9. SERVICES (src/services; injected through ctx; mocked in tests)
- net.ts:
  - text() and json() with timeout plus abort composition.
  - Typed NetError: offline (navigator.onLine fast-fail), timeout, cors (TypeError on a cross-origin request), http(status), parse, abort.
  - memo(key, ttl, fn) with in-flight de-duplication and a 30 s failure cool-down (F065).
  - Optional sessionStorage TTL cache.
- sysinfo.ts: one UA, UA-CH, WebGL, memory, cores, battery and storage probe. It merges the copies at virtualFileSystem.ts:12-29 and system.ts:604-621 and labels the ipify value 'Public IP'.
- appearance.ts: themes(), theme Readable, setTheme(name) (case-insensitive), cathodeModes(), setCathode(), resetDefaults() (swamphen plus today's cathode behaviour).
- opener.ts: openPreflight(url) and card(url, label).
- clipboard.ts: Clipboard API with an execCommand fallback.
- bell.ts.
- analytics.ts: command name, status and device class only.
- storage.ts: a safe KV over localStorage with a memory fallback.
- clock.ts: now, bootTime, random; injectable for deterministic tests.
- Slots for other workstreams: weather (geocode + Open-Meteo), market (owned proxy), qrEncode (in-house), dns (DoH).

10. TARGET MODULE LAYOUT
src/
  main.ts                calls app/bootstrap.ts
  App.svelte             <Terminal/> + <Cathode/> + umami head block
  app.css
  app/bootstrap.ts       composition root
  shell/                 DOM-free kernel
    types, observable, ast, lexer, parser, histexpand, alias, expand, glob,
    arith (wave B), streams, executor, flags, registry, help, complete,
    prompt, session, index (createShell)
  output/                DOM-free
    model (types + builders), sgr, plain, markup, html-to-text (temporary)
  vfs/                   DOM-free
    types, errors, path, vfs, seed, special (proc/dev/usr-bin), persist
  services/              net, sysinfo, appearance, opener, clipboard, bell, analytics, storage, clock
  platform/              env, viewport, measure
  stores/                screen, term, theme, cathode, prefs
  ui/
    Terminal, Transcript, Entry, OutputView, SpanView, Prompt, LineEditor
    (+ lineEditor.ts reducer), AccessoryBar, CompletionList, StatusLine,
    AppHost, apps/{Pager, Editor, Shutdown, Matrix}, Cathode
  commands/              one file per command; `export default defineCommand({...})`,
                         auto-registered by commands/index.ts via import.meta.glob('./*/*.ts', {eager:true});
                         heavy bodies use load: () => import('./impl/x')
    portfolio/   whoami (+linkedin), email, repo, theme, cathode, banner, sudo, qr, about
    files/       ls cd pwd cat touch mkdir rmdir rm cp mv ln find tree stat du df file chmod chown
                 realpath readlink basename dirname mktemp
    text/        echo printf grep head tail wc sort uniq cut tr sed rev tee nl seq yes xargs diff
                 base64 sha256sum column fold
    shell/       help man whatis apropos history alias unalias export unset env printenv set type
                 which command source true false test exit sleep clear reset read time
    system/      fastfetch (+neofetch) uname hostname id groups who w uptime free ps top kill
                 nproc lscpu locale lsb_release date cal dmesg poweroff finger
    network/     curl wget ping dig host nslookup whois ip speedtest weather stock git
    fun/         cowsay fortune figlet lolcat sl cmatrix
    editor/      nano less
    legacy.ts    temporary
  content/       README.vt, history.vt, linux.vt
Deleted by the end of step 7:
  src/utils/** (except beep.js, which becomes services/bell.ts)
  src/components/{Input, History, Ps1, CommandSuggestionsRow}.svelte
  src/stores/history.ts
  src/interfaces/command.ts
  public/{README.md, history.txt, linux.txt}

11. MIGRATION RULES
- One PR per step, each with a Firebase preview.
- Old command names keep working at every step.
- A command's legacy function and helpTexts entry are deleted in the PR that ports it.
- Ports keep the existing colours, and the parity test checks span fg against the old var(--theme-x).
- Spec examples are executed by tests.

## Key interfaces

```ts
// ═══════════ src/output/model.ts  (DOM-free; the ONLY place Actions are created) ═══════════
export type Palette = 'black'|'red'|'green'|'yellow'|'blue'|'purple'|'cyan'|'white'
  |'brightBlack'|'brightRed'|'brightGreen'|'brightYellow'|'brightBlue'|'brightPurple'|'brightCyan'|'brightWhite'
  |'foreground'|'background';                          // == themes.json keys == --theme-* vars
export type Role = 'muted'|'accent'|'ok'|'warn'|'error'|'link'|'promptUser'|'promptHost'|'promptPath'; // --role-* (F068)
export interface SpanStyle { fg?: Palette|Role; bg?: Palette|Role; bold?: boolean; dim?: boolean;
  italic?: boolean; underline?: boolean; inverse?: boolean; strike?: boolean }
export type Action =
  | { kind: 'run'; line: string } | { kind: 'insert'; text: string } | { kind: 'open'; href: string }
  | { kind: 'copy'; text: string; label?: string } | { kind: 'share'; url: string; title?: string };
export type LiveBinding = { kind: 'isCurrentTheme'; theme: string } | { kind: 'isCurrentCathode'; mode: string }
  | { kind: 'currentThemeName' };
export interface Span { text: string; style?: SpanStyle; href?: string /* http(s)|mailto only */;
  action?: Action; live?: LiveBinding }
export type Line = Span[];
export type Block =
  | { type: 'lines'; lines: Line[]; stream: 'stdout' | 'stderr' }
  | { type: 'grid'; items: Span[]; minCh?: number }                       // ls, help, theme ls
  | { type: 'table'; head?: Line; rows: Line[][]; align?: ('l'|'r')[]; stackBelowCols?: number }
  | { type: 'art'; text: string; alt: string; style?: SpanStyle; fit: 'scale' | 'scroll' } // banner, qr, logos
  | { type: 'panel'; tone: Palette | Role; title?: string; body: Line[] }   // --help, notices
  | { type: 'chips'; label?: string; items: { label: string; action: Action }[] }
  | { type: 'card'; title: string; href: string; detail?: string; copy?: string }  // openers
  | { type: 'columns'; left: Block[]; right: Block[]; stackBelowCols: number }    // fastfetch, stock
  | { type: 'legacyHtml'; html: string };                                // migration only, sanitised at render
export declare const out: {
  span(text: string, style?: SpanStyle): Span; run(label: string, line: string, style?: SpanStyle): Span;
  insert(label: string, text: string, style?: SpanStyle): Span; link(label: string, href: string): Span;
  grid(items: Span[], minCh?: number): Block; table(rows: Line[][], o?: Partial<Extract<Block,{type:'table'}>>): Block;
  art(text: string, alt: string, fit?: 'scale'|'scroll'): Block; panel(tone: Palette|Role, body: Line[], title?: string): Block;
  chips(items: { label: string; action: Action }[], label?: string): Block; card(c: Omit<Extract<Block,{type:'card'}>,'type'>): Block;
  columns(left: Block[], right: Block[], stackBelowCols: number): Block };
export declare function plain(b: Block): string;                             // pipe/file fallback
// src/output/sgr.ts — never yields Action
export interface SgrState { style: SpanStyle; href?: string }
export declare function parseSgr(chunk: string, st: SgrState): { done: Line[]; partial: Line; st: SgrState; clear: boolean };
export declare function stripSgr(s: string): string;
// src/output/markup.ts
export declare function parseMarkup(src: string): { text: string; lines: Line[] };   // '{cyan,bold}x{/}'

// ═══════════ src/shell/streams.ts ═══════════
export class BrokenPipe extends Error {}                                       // → silent status 141
export interface OutStream {
  readonly isTTY: boolean; readonly columns: number;                            // measured on TTY; 80 otherwise
  write(text: string): Promise<void>;            // resolves at once under the 64 KiB HWM; rejects BrokenPipe
  line(...parts: (string | Span)[]): Promise<void>;   // Spans → SGR text when piped-to-plain
  block(b: Block): Promise<void>;                // TTY: rich; otherwise plain(b)
  /** @deprecated legacy adapter only */ html(legacy: string): Promise<void>;
}
export interface InStream { readonly isTTY: boolean; text(): Promise<string>; lines(): AsyncIterable<string>; close(): void }

// ═══════════ src/shell/ast.ts ═══════════
export interface Pos { start: number; end: number }
export type WordPart =
  | { t: 'lit'; v: string; q: 0 | 1 | 2 }                                      // unquoted | '…' | "…"
  | { t: 'param'; name: string; op?: ':-'|'-'|':='|':+'; arg?: Word; q: 0 | 2 }
  | { t: 'cmdsub'; list: List; q: 0 | 2 } | { t: 'arith'; expr: string; q: 0 | 2 } | { t: 'tilde'; user?: string };
export interface Word extends Pos { parts: WordPart[]; raw: string }
export type RedirOp = '<'|'>'|'>>'|'2>'|'2>>'|'&>'|'2>&1'|'>&2'|'<<<';
export interface Redirect extends Pos { op: RedirOp; target?: Word }
export interface SimpleCommand extends Pos { type: 'cmd'; assigns: { name: string; value: Word }[]; words: Word[]; redirects: Redirect[] }
export interface Pipeline extends Pos { type: 'pipe'; negate: boolean; cmds: SimpleCommand[] }
export interface AndOr extends Pos { type: 'andor'; first: Pipeline; rest: { op: '&&'|'||'; pipe: Pipeline }[] }
export interface List extends Pos { type: 'list'; items: { node: AndOr; background: boolean }[] }
export type ParseResult = { ok: true; ast: List; tokens: Token[] }
  | { ok: false; incomplete: true; reason: 'quote'|'pipe'|'andor'|'backslash'|'subst'; tokens: Token[] }
  | { ok: false; incomplete: false; message: string; at: Pos; tokens: Token[] };
export interface Token extends Pos { kind: 'word'|'op'|'redir'|'assign'|'comment'; raw: string; word?: Word; unterminated?: boolean }
export declare function lex(src: string, o?: { partial?: boolean }): { tokens: Token[]; openQuote?: '"' | "'" };
export declare function parse(src: string): ParseResult;
export declare function expandHistory(line: string, h: HistoryApi): { line: string; changed: boolean } | { error: string };

// ═══════════ src/shell/types.ts ═══════════
export type ExitCode = number;  // 0 ok · 1 err · 2 usage/syntax · 126 noexec/EACCES · 127 not found · 130 ^C · 141 EPIPE
export type Category = 'portfolio'|'files'|'text'|'shell'|'system'|'network'|'fun'|'editor';
export type ArgKind = 'path'|'file'|'dir'|'exec'|'command'|'var'|'alias'|'theme'|'cathode'|'choice'
  |'url'|'host'|'place'|'ticker'|'user'|'text'|'int';
export interface FlagSpec { short?: string; long?: string; key?: string;      // ctx.opts key = key ?? long ?? short
  value?: { name: string; kind: ArgKind; choices?: readonly string[]; default?: string; optional?: boolean };
  repeatable?: boolean; description: string }
export interface ArgSpec { name: string; kind: ArgKind; optional?: boolean; variadic?: boolean;
  choices?: readonly string[] | (() => readonly string[]); examples?: readonly string[] }
export interface SubcommandSpec { summary: string; args?: ArgSpec[]; flags?: FlagSpec[]; hidden?: boolean }
export interface Example { line: string; note?: string; offline?: boolean }   // offline ⇒ starter chips + CI-executed
export type RunFn = (ctx: CommandContext) => ExitCode | void | Promise<ExitCode | void>;
export interface CommandSpec {
  name: string; aliases?: string[]; category: Category;
  summary: string;                           // ≤ 50 chars
  synopsis?: string[]; description?: string; man?: { heading: string; body: string }[];  // body in {color} markup
  flags?: FlagSpec[]; args?: ArgSpec[]; subcommands?: Record<string, SubcommandSpec>;
  examples?: Example[]; seeAlso?: string[];
  featured?: boolean; hidden?: boolean;
  builtin?: boolean;                         // may mutate session (cd, export, alias, source, exit)
  network?: boolean | { timeoutMs: number }; // offline fast-fail, status line, deadline (8 s default)
  posixArgs?: boolean; numericShortcut?: string; handlesHelp?: boolean;
  opens?(argv: readonly string[]): string | null;        // synchronous preflight URL (user activation)
  next?(r: { status: ExitCode; argv: readonly string[] }): string[];  // follow-up chips
  complete?: Completer;
  run?: RunFn; load?: () => Promise<{ run: RunFn }>;     // exactly one; load() = lazy chunk
  legacyHelp?: string;                                   // migration only
}
export declare function defineCommand(s: CommandSpec): CommandSpec;
export class UsageError extends Error {}

export interface Env { get(k: string): string | undefined; set(k: string, v: string, o?: { export?: boolean }): void;
  unset(k: string): void; isExported(k: string): boolean; entries(exportedOnly?: boolean): [string, string][];
  child(overrides?: Record<string, string>): Env }
export interface HistoryApi { list(): { n: number; line: string }[]; add(line: string): void; get(n: number): string | undefined;
  last(offset?: number): string | undefined; findPrefix(p: string): string | undefined;
  search(q: string, before?: number): { n: number; line: string } | undefined; remove(n: number): void; clear(): void }
export interface Tty {
  readonly interactive: boolean; readonly columns: number; readonly rows: number;
  readonly touch: boolean; readonly inApp: 'instagram'|'facebook'|'tiktok'|null;
  status(text: string | null): void;                                   // spinner label (replaces speedtestPhase)
  readLine(o: { prompt: string; secret?: boolean }): Promise<string | null>;  // null on ^C/^D
  open(url: string, label: string): Promise<'opened'|'blocked'|'card'>; // card always printed; opened if preflight did it
  copy(text: string): Promise<boolean>; share?(d: { url: string; title?: string }): Promise<boolean>;
  bell(): void; clear(): void;
  fullscreen<T = ExitCode>(view: 'pager'|'editor'|'matrix'|'sl'|'shutdown', props: unknown): Promise<T>;
}
export interface NetInit extends RequestInit { timeoutMs?: number; cacheTtlMs?: number }
export type NetErrorKind = 'offline'|'timeout'|'cors'|'http'|'parse'|'abort';
export interface NetError extends Error { kind: NetErrorKind; status?: number; host: string; ms?: number }
export interface Net { text(url: string, i?: NetInit): Promise<{ status: number; headers: Headers; body: string; ms: number }>;
  json<T>(url: string, i?: NetInit): Promise<T>; memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> }
export interface Appearance { themes(): readonly { name: string }[]; current(): string; setTheme(n: string): boolean;
  cathodeModes(): readonly { name: string; summary: string }[]; setCathode(m: string): boolean; resetDefaults(): void }
export interface User { name: string; uid: number; gid: number; groups: number[]; home: string; shell: string }
export interface ShellApi {
  cwd(): string; chdir(path: string): void;                  // sets PWD/OLDPWD; updates the cwd store
  lastStatus(): ExitCode; aliases: Map<string, string>; history: HistoryApi; registry: Registry;
  exec(line: string, io?: Partial<Pick<CommandContext, 'stdin'|'stdout'|'stderr'>>): Promise<ExitCode>; // source, xargs, $( )
  reset(o?: { files?: boolean }): void;
}
export interface CommandContext {
  readonly name: string; readonly argv: readonly string[]; readonly args: readonly string[];  // args = operands
  readonly opts: Record<string, boolean | number | string | string[] | undefined>; readonly sub?: string;
  readonly stdin: InStream; readonly stdout: OutStream; readonly stderr: OutStream;
  readonly fmt: Fmt;                    // SGR helpers; no-ops when !stdout.isTTY
  readonly env: Env; readonly cwd: string; readonly fs: BoundVfs; readonly user: User;
  readonly signal: AbortSignal; readonly tty: Tty; readonly net: Net; readonly sys: SysInfo;
  readonly appearance: Appearance; readonly shell: ShellApi; readonly spec: CommandSpec;
  resolve(p: string): string;
  fail(message: string, status?: ExitCode): Promise<ExitCode>;   // "name: message" → stderr, returns status (1)
  usage(message?: string): Promise<ExitCode>;                     // + "Try 'name --help'…", returns 2
}
export interface Fmt { readonly enabled: boolean; fg(c: Palette|Role, s: string): string; bold(s: string): string;
  dim(s: string): string; underline(s: string): string; link(href: string, text?: string): string }
export interface Registry { register(s: CommandSpec): void /* throws on duplicate name/alias */;
  get(nameOrAlias: string): CommandSpec | undefined; list(o?: { includeHidden?: boolean; category?: Category }): CommandSpec[];
  suggest(name: string): { near: string[]; hint?: string } }

// ═══════════ src/vfs/types.ts ═══════════
export type NodeType = 'file'|'directory'|'symlink'|'device';
export interface VirtualFile {                       // existing literal shape + optional fields
  name: string; type: NodeType; content?: string; children?: Record<string, VirtualFile>; // null-prototype
  target?: string; mode?: number; owner?: string; group?: string; mtime?: number;
  styled?: Line[];                                   // owner markup; cleared on write
  generate?: (c: { sys: SysInfo; now: number; env: Env }) => string;   // /proc; never persisted
  device?: 'null'|'zero'|'random'|'urandom'|'tty'; builtin?: string;   // /usr/bin stub → registry name
}
export interface Stat { path: string; type: NodeType; mode: number; owner: string; group: string; uid: number; gid: number;
  size: number; mtime: number; nlink: number; target?: string }
export type VfsCode = 'ENOENT'|'ENOTDIR'|'EISDIR'|'EEXIST'|'EACCES'|'EPERM'|'ENOTEMPTY'|'ELOOP'|'EINVAL'|'ENOSPC';
export class VfsError extends Error { constructor(public code: VfsCode, public path: string, public syscall = '') { super(code); } }
export interface Vfs {
  resolve(path: string, cwd: string, home: string): string; realpath(path: string): string;
  stat(p: string): Stat; lstat(p: string): Stat; exists(p: string): boolean;
  readdir(p: string, o?: { all?: boolean }): string[];
  readFile(p: string): string; readStyled(p: string): Line[] | null;
  writeFile(p: string, data: string, o?: { append?: boolean; mode?: number; noclobber?: boolean }): void;
  mkdir(p: string, o?: { parents?: boolean; mode?: number }): void; rmdir(p: string): void;
  rm(p: string, o?: { recursive?: boolean; force?: boolean }): void;
  rename(a: string, b: string): void; copy(a: string, b: string, o?: { recursive?: boolean }): void;
  symlink(target: string, p: string): void; readlink(p: string): string;
  chmod(p: string, mode: number): void; chown(p: string, owner: string, group?: string): void; touch(p: string, mtime?: number): void;
  glob(pattern: string, cwd: string): string[]; walk(p: string): Iterable<[string, Stat]>;
  usage(): { used: number; quota: number }; onChange(fn: (paths: string[]) => void): () => void;
}
export interface BoundVfs extends Vfs { readonly uid: number; access(p: string, want: 'r'|'w'|'x'): boolean }
export interface PersistedFs { v: 1; seedVersion: string; savedAt: number;
  overlay: Record<string, { type: NodeType; mode: number; mtime: number; content?: string; target?: string } | { whiteout: true }> }

// ═══════════ src/shell/complete.ts ═══════════
export type CandidateKind = 'command'|'alias'|'builtin'|'subcommand'|'flag'|'dir'|'file'|'exec'|'symlink'|'var'|'value'|'example'|'history';
export interface Candidate { value: string /* already escaped */; display?: string; description?: string; kind: CandidateKind; suffix: '' | ' ' | '/' }
export interface CompletionResult { from: number; to: number; word: string; candidates: Candidate[]; common: string;
  context: 'command'|'flag'|'flagValue'|'subcommand'|'operand'|'redirect'|'variable'|'empty' }
export type Completer = (c: { word: string; argIndex: number; words: readonly string[]; spec: CommandSpec; sub?: string;
  fs: BoundVfs; env: Env; shell: ShellApi }) => Candidate[];
export declare function complete(line: string, cursor: number, mode: 'tab' | 'suggest'): CompletionResult;
export declare function applyCandidate(line: string, r: CompletionResult, c: Candidate): { line: string; cursor: number };

// ═══════════ src/ui/lineEditor.ts (pure) ═══════════
export interface EditorState { buffer: string; cursor: number;
  mode: 'normal'|'listed'|'menu'|'isearch'|'continuation'|'secret';
  busy: boolean; typeahead: string[];  menu?: { result: CompletionResult; index: number; original: string };
  tabCount: number; isearch?: { query: string; n?: number; failed: boolean };
  hist: { index: number | null; draft: string; prefix?: string }; killRing: string[]; pending: string[] /* PS2 */ }
export type EditorAction = { t: 'input'; value: string; cursor: number }
  | { t: 'key'; key: string; ctrl: boolean; alt: boolean; shift: boolean; meta: boolean; hasSelection: boolean }
  | { t: 'chip'; candidate: Candidate } | { t: 'completion'; result: CompletionResult } | { t: 'busy'; busy: boolean };
export type EditorEffect = { t: 'submit'; line: string } | { t: 'requestCompletion' } | { t: 'bell' } | { t: 'clearScreen' }
  | { t: 'interrupt' } | { t: 'eof' } | { t: 'copySelection' } | { t: 'showList' } | { t: 'hideList' };
export declare function reduce(s: EditorState, a: EditorAction, d: { history: HistoryApi;
  complete(line: string, cursor: number): CompletionResult }): { state: EditorState; effects: EditorEffect[] };

// ═══════════ src/shell/index.ts + src/stores/screen.ts ═══════════
export interface ScreenEntry { id: number; prompt: Line | null; line: string; blocks: Block[];
  state: 'running'|'done'|'interrupted'; status?: ExitCode; statusText?: string | null;
  origin: 'keyboard'|'chip'|'link'|'boot'; startedAt: number; endedAt?: number }
export interface JobHandle { readonly id: number; readonly done: Promise<ExitCode>; abort(): void }
export interface Shell {
  readonly cwd: Readable<string>; readonly lastStatus: Readable<ExitCode>;
  readonly job: Readable<{ name: string; label: string | null; startedAt: number } | null>;
  readonly registry: Registry; readonly vfs: Vfs; readonly env: Env; readonly history: HistoryApi;
  preflight(line: string): void;                                       // sync, inside the gesture
  start(line: string, origin: ScreenEntry['origin']): JobHandle;        // appends to the screen store
  complete(line: string, cursor: number, mode: 'tab'|'suggest'): CompletionResult;
  renderPrompt(which?: 'PS1'|'PS2'): Line;
  reset(o?: { files?: boolean }): void;
}
export declare function createShell(d: { storage: KV; net: Net; sys: SysInfo; appearance: Appearance; tty: TtyHost;
  clock: Clock; screen: ScreenSink }): Shell;

// ═══════════ src/commands/legacy.ts (temporary) ═══════════
export type LegacyFn = (args: string[], ac?: AbortController) => string | Promise<string>;
export declare function legacy(name: string, fn: LegacyFn, meta: Pick<CommandSpec, 'category'|'summary'|'args'|'subcommands'|'network'|'aliases'> & { help?: string }): CommandSpec;

// ═══════════ authoring cost example: src/commands/text/head.ts ═══════════
export default defineCommand({
  name: 'head', category: 'text', summary: 'output the first part of files', numericShortcut: 'lines',
  flags: [{ short: 'n', long: 'lines', value: { name: 'NUM', kind: 'int', default: '10' }, description: 'print the first NUM lines' }],
  args: [{ name: 'FILE', kind: 'file', optional: true, variadic: true }],
  examples: [{ line: 'head -n 3 README.md', offline: true }, { line: 'history | head', offline: true }],
  seeAlso: ['tail', 'cat'],
  async run(ctx) {
    const n = Number(ctx.opts.lines ?? 10); const files = ctx.args.length ? ctx.args : ['-']; let status = 0;
    for (const f of files) {
      try {
        const text = f === '-' ? await ctx.stdin.text() : ctx.fs.readFile(ctx.resolve(f));
        if (files.length > 1) await ctx.stdout.write(`==> ${f} <==\n`);
        await ctx.stdout.write(text.split('\n').slice(0, n).join('\n') + '\n');
      } catch (e) { status = await ctx.fail(`cannot open '${f}' for reading: ${vfsMessage(e)}`); }
    }
    return status;
  },
});
```

## What the visitor sees

DAY ONE: SAME LOOK, SAFER
- The banner, colours, all 10 themes, cathode modes, help panels and every command look as they do now.
- `echo '<img src=x onerror=alert(1)>'` prints that text literally. Nothing typed, fetched or cat'ed can run script.

SHELL (desktop and phone, every command, including ones not yet ported via the adapter)
- Syntax that works:
  - quotes: `echo "a  b" 'c$d'`
  - pipes: `cat README.md | grep -i theme | wc -l`
  - redirection: `ls -l > list.txt`, `cat nope 2>/dev/null || echo missing`
  - sequencing: `mkdir x; cd x && pwd`
  - variables: `export NAME=Has; echo "hi $NAME"`, `echo $? ~ $HOME`
  - globs: `ls *.txt`, `cat ~/documents/*`
  - aliases: `ll` from ~/.bashrc works; `alias gs='git log'` lasts for the session
  - history: `!!`, `!3`, `!ec`, `^old^new`; the expanded line is shown
  - an unclosed quote or a trailing `|`/`&&` shows a `> ` continuation prompt
- The prompt follows cd: `guest@www.vesen.app:~/documents$` (host per the open question). Earlier prompts keep the directory they were typed in. The `$` turns red after a failure.
- Errors use Linux wording on stderr, with real exit codes:
  - `cat nope`: `cat: nope: No such file or directory` (1)
  - `ls -z`: `ls: invalid option -- 'z'` / `Try 'ls --help' for more information.` (2)
  - `lss`: `vesen: lss: command not found` plus a tappable `did you mean ls?` (127)
  - `vim`: also suggests nano
  - `touch /etc/x`: Permission denied
  - `for i in…`: `vesen: for: not supported in vesen` (2)
  At most one bell per failing job. It is visual on touch devices.

HELP AND MAN
- `help`: commands grouped by category, Portfolio first, laid out to the measured width. Names are tappable and insert `name `.
- `ls --help` and `help ls`: today's coloured panel, generated from the spec, with examples as run chips. `-h` means help unless the command uses -h itself (`ls -lh`, `df -h`).
- `man ls`: NAME, SYNOPSIS, DESCRIPTION, OPTIONS, EXAMPLES, SEE ALSO. Inline when piped (`man ls | grep all`); in a pager from wave F.
- `whatis`, `apropos weather`, and `man vesen` for the about page.

TAB COMPLETION (desktop)
- Tab completes commands, aliases, subcommands (`theme s` → `theme set `), values (`theme set sw` → `swamphen`), flags (`ls --al` → `--al`, then a list of --all and --almost-all with descriptions), nested paths (`cat doc` → `cat documents/`, then `li` → `linux.txt `), `~` and `..` paths, `$VARS`, and words after `|`, `&&`, `>` and `sudo`.
- Tab 1 inserts the common prefix. Tab 2 lists the choices below the prompt. Further Tabs cycle; Shift+Tab goes back; Esc restores.
- Readline keys: Ctrl+A/E/U/K/W/Y, Alt+B/F. Ctrl+R gives `(reverse-i-search)`. Up after typing a prefix searches history by that prefix.
- Ctrl+C copies when text is selected; otherwise it interrupts and prints `^C`. Ctrl+L clears the screen and keeps the line.

PHONE AND INSTAGRAM IN-APP BROWSER
- The input is 16px, so iOS does not zoom. It is never disabled, so the keyboard stays up across commands. Its height follows visualViewport, so the prompt sits just above the keyboard.
- The accessory bar above the keyboard is `[⇥] [↑] [↓] [^C] | chips | [⌄]`. Chips are live completions:
  - empty line: help, whoami, ls -la, cat README.md, fastfetch, theme ls, weather Gadigal, plus the 3 latest commands
  - after `cd `: directories
  - after `theme set `: theme names
  - after `ls -`: flags with descriptions
  Tapping a chip completes it without closing the keyboard. A directory chip immediately offers the next level.
- Output is tappable:
  - help names, plus `ls` directories and files (insert `cd dir/` or `cat file`)
  - theme names (run `theme set name`)
  - did-you-mean hints
  - follow-up chips after commands (`mkdir x` → [cd x] [ls])
- whoami/linkedin, repo, email and the sudo gag always show a link card with [Copy]. On desktop the link also opens immediately. Inside Instagram nothing navigates without a tap, and a one-time hint explains `••• → Open in browser`.
- No horizontal page scroll at 375 px:
  - ls, help and theme ls are reflowing grids
  - tables stack into `key: value` rows
  - banner, QR and logos scale down instead of wrapping
- `vesen.app/?cmd=weather%20Oslo` pre-fills the prompt and never auto-runs.

LOADING, CANCEL AND ERRORS
- The typed line is committed on Enter. A status line under it shows a per-command label (`⠋ dig: resolving vesen.app…`) and elapsed seconds after 3 s.
- To cancel: on desktop, Ctrl+C (hint `(Ctrl+C to cancel)`); on phones, a red [Stop] chip. Either cancels any command at once: `^C`, status 130, the rest of the line skipped.
- Network commands time out after 8 s by default (the spec can extend this, up to 15 s), with curl-style messages:
  - `curl: (28) Operation timed out after 8000 milliseconds`
  - offline (instant): `curl: (6) Could not resolve host: x (you appear to be offline)`
  - `curl: (7) blocked by CORS: example.com does not allow browser requests`

FILES, PERSISTENCE AND RESET
- `ls -la ~` shows .bashrc, .ssh, projects, documents and the rest. `/home/has` holds the owner's portfolio files, read-only. `cat /etc/shadow` gives Permission denied.
- `/proc/cpuinfo`, `/proc/meminfo` and `/proc/uptime` reflect the visitor's device.
- Files under `~` and command history survive a reload where storage is allowed. History holds 500 lines; lines starting with a space are not kept.
- If storage is blocked, everything works for the session, with one dim notice.
- `reset` keeps today's meaning: banner, swamphen theme, cwd ~, original files and cleared history. `history -c` clears history only. The theme is remembered by name, so theme updates reach returning visitors.
- Coreutils keep today's short confirmations behind `-v`; silent by default is an owner decision. Portfolio commands confirm in one line (`Theme set to wombat.`).

## Files

| Path | Purpose |
|---|---|
| `package.json` | Scripts test, test:e2e, check:strict and check:boundaries. DevDeps: vitest ^3.2 (whose vite range includes ^5, so the existing vite 5.4 is reused), happy-dom ^15, @testing-library/svelte ^5, @playwright/test. Runtime dep: dompurify ^3.4, temporary, removed in step 7. Remove qrcode and @types/qrcode when the in-house encoder lands. |
| `vite.config.ts` | Add a vitest block: node environment for src/shell, src/output, src/vfs and src/commands; happy-dom for src/ui. build.target ['es2020','safari14'] for older Instagram WKWebView builds. |
| `tsconfig.strict.json` | NEW. Extends tsconfig.json with strict:true and noUncheckedIndexedAccess, covering src/shell, src/output, src/vfs, src/services, src/platform and src/commands (F084). The root config stays lax until the cleanup step. |
| `scripts/check-boundaries.mjs` | NEW, zero-dependency. - Fails if src/shell, src/output, src/vfs or src/commands mention window, document, navigator, localStorage or 'svelte'. - Fails on '{@html' outside src/ui/OutputView.svelte, and anywhere after step 7. - Fails on new imports from src/utils or src/commands/legacy.ts. |
| `scripts/convert-content.mjs` | NEW, run once. Converts the <span style=color:var(--theme-x)...> markup in public/README.md, history.txt and linux.txt into {x,bold}...{/} markup in src/content/*.vt. |
| `scripts/check-bundle.mjs` | NEW. Fails CI when the initial JS exceeds 70 kB gzip (48.7 kB today) or when a lazy chunk (qr, nano, cmatrix, fastfetch logos, figlet) appears in the entry chunk. |
| `.github/workflows/firebase-hosting-pull-request.yml` | Change the run step to `npm ci && npm run check && npm run check:strict && npm run check:boundaries && npm test && npm run build && node scripts/check-bundle.mjs`, plus the Playwright smoke project (from step 5). |
| `.github/workflows/firebase-hosting-merge.yml` | Same gate before the live deploy. Today it only runs `npm ci && npm run build` (line 13). |
| `firebase.json` | Add a headers block: - Content-Security-Policy: default-src 'self'; script-src 'self' <umami origin>; style-src 'self' 'unsafe-inline'; connect-src 'self' https:; img-src 'self' data: https:; object-src 'none'; base-uri 'none'; frame-ancestors 'none' (F006). Ship as Report-Only for one deploy first. - X-Content-Type-Options, Referrer-Policy and Permissions-Policy. - Cache-Control immutable for /assets/** and no-cache for index.html (F007). Replace the catch-all rewrite with a 404.html, since there are no client routes and ?cmd= is a query string. |
| `index.html` | Add a CSP <meta> mirroring the header, without frame-ancestors, because the Docker busybox httpd cannot send headers (Dockerfile:12-15). Viewport meta and the 100dvh/--app-h container changes are coordinated with the UI workstream (F076, F077). |
| `src/main.ts` | Calls bootstrap() and mounts App. |
| `src/app/bootstrap.ts` | NEW composition root, in order: 1. Measure the platform. 2. Build the services. 3. Build the Vfs: seed, then overlay. 4. Build the registry from commands/index.ts. 5. createShell. 6. Apply theme and cathode CSS variables and the favicon from one subscription. 7. Print the banner. 8. Read ?cmd= (fill only). 9. Remove the old history and commandHistory keys once. |
| `src/App.svelte` | Thin wrapper: <Terminal/> + <Cathode/> + the umami head block. Delete the scroll juggling (lines 19-56) and the prop plumbing. |
| `src/shell/types.ts` | NEW. Shared types: CommandSpec, FlagSpec, ArgSpec, CommandContext, Tty, ShellApi, Env, HistoryApi, Registry, UsageError, ExitCode. |
| `src/shell/observable.ts` | NEW. A writable/readable pair that follows the Svelte store contract (subscribe, set, update, get), so the kernel never imports svelte. |
| `src/shell/ast.ts, src/shell/lexer.ts, src/shell/parser.ts` | NEW. lexer.ts (~250 lines): token ranges, quote levels, escapes, comments and every operator; partial mode for completion and highlighting. parser.ts (~200 lines): recursive descent producing ok \| incomplete(reason) \| error(message, pos), plus explicit not-supported errors for control flow. ast.ts: the node types. |
| `src/shell/histexpand.ts, src/shell/alias.ts, src/shell/expand.ts, src/shell/glob.ts, src/shell/arith.ts` | NEW. histexpand.ts: !! !n !-n !prefix !$ ^a^b. alias.ts: token-stream splicing with a recursion guard. expand.ts: tilde, parameter, command substitution, IFS split, glob and quote removal, in POSIX order. glob.ts: segment-wise matcher over the Vfs. arith.ts: $(( )) integer arithmetic (wave B). |
| `src/shell/streams.ts` | NEW. AsyncPipe (64 KiB high-water mark, EPIPE), TtySink (parses SGR into Blocks, rAF flush), StringIn, NullSink, VfsWriteStream (> >> noclobber) and the legacy html() bridge. |
| `src/shell/executor.ts` | NEW (~300 lines). Lists, and/or chains and concurrent pipelines; redirects; temporary env; resolution through registry, then PATH scripts, then 127; flag parsing and the --help intercept; error-to-status mapping (1/2/126/127/130/141); network deadlines; per-job AbortController with detach; bell policy; legacy cwd reconcile. |
| `src/shell/flags.ts` | NEW. getopt_long driven by FlagSpec, producing typed opts. Coreutils error wording. The -h policy: help unless the spec defines h. |
| `src/shell/registry.ts` | NEW. A Map-based registry that throws on a duplicate name or alias; list() by category; suggest() returning {near[], hint} using Damerau-Levenshtein <= 2 plus a map of commands that exist elsewhere. |
| `src/shell/help.ts` | NEW. All generated from specs: - help index: grouped by category, a grid of tappable insert spans, the portfolio category first - --help: today's cyan/purple/yellow panel look as a panel Block (Usage, Options, Examples as run chips, See also) - man pages: NAME, SYNOPSIS, DESCRIPTION, OPTIONS, EXAMPLES, SEE ALSO; inline when piped, Pager on a TTY from wave F - whatis and apropos - /usr/share/man stubs Replaces commands.ts:18-49 and :367-455 and helpTexts.ts. |
| `src/shell/complete.ts` | NEW (~280 lines). complete(line, cursor, mode): context detection, providers, quoting and the common prefix, used by Tab, the double-Tab list and the phone chips. Replaces Input.svelte:50-110 and :381-613 and src/utils/commandSuggestions.ts. |
| `src/shell/prompt.ts, src/shell/session.ts, src/shell/index.ts` | NEW. prompt.ts: PS1/PS2 escapes (\u \h \H \w \W \$ \t \d \[ \]) rendered to a Line. session.ts: env with export flags, aliases, history, cwd/oldpwd stores, lastStatus, options (noclobber, bell) and boot sourcing. index.ts: the createShell facade with start, preflight, interrupt, complete, renderPrompt and reset. |
| `src/output/model.ts, src/output/sgr.ts, src/output/plain.ts, src/output/markup.ts, src/output/html-to-text.ts` | NEW. model.ts: Span, Block, Action and LiveBinding types, plus the `out` builders, the only constructors of Action. sgr.ts: a stateful streaming SGR and OSC 8 parser, plus stripSgr. plain.ts: Block-to-text fallbacks. markup.ts: the {color}...{/} parser. html-to-text.ts: legacy pipe fallback, deleted in step 7. |
| `src/vfs/types.ts, src/vfs/errors.ts, src/vfs/path.ts, src/vfs/vfs.ts, src/vfs/seed.ts, src/vfs/special.ts, src/vfs/persist.ts` | NEW. vfs.ts (~450 lines): the class over the literal tree with permissions, symlinks, CRUD, glob, walk, onChange and usage. seed.ts: moves the tree from virtualFileSystem.ts:54-466, re-homed to /home/guest, plus /home/has, /etc, /dev and /proc, and the content from src/content. special.ts: /proc and /dev generators and /usr/bin stubs. persist.ts: the overlay, whiteouts, seedVersion, 512 KB cap and memory fallback. |
| `src/utils/virtualFileSystem.ts` | Step 3: becomes a re-export shim over the new Vfs. It exports virtualFileSystem (the backing literal), currentPath (mirrored from the cwd store) and resolvePath (HOME = /home/guest), so the unported legacy commands keep working. Deleted in step 7. |
| `src/content/README.vt, src/content/history.vt, src/content/linux.vt` | NEW. The converted owner content with exact colours, imported with ?raw. public/README.md, history.txt and linux.txt are deleted in step 3. |
| `src/services/net.ts, src/services/sysinfo.ts, src/services/appearance.ts, src/services/opener.ts, src/services/clipboard.ts, src/services/bell.ts, src/services/analytics.ts, src/services/storage.ts, src/services/clock.ts` | NEW. The side-effecting ports injected through ctx; see architecture section 9. bell.ts replaces src/utils/beep.js; analytics.ts replaces src/utils/tracking.ts and sends argv[0] and the status only. |
| `src/platform/env.ts, src/platform/viewport.ts, src/platform/measure.ts` | NEW. Touch, in-app and reduced-motion detection; visualViewport CSS variables; character-cell measurement into the term store. Replaces src/utils/mobile.ts and textWrap.ts. |
| `src/stores/screen.ts, src/stores/term.ts, src/stores/prefs.ts` | NEW. screen.ts: ScreenEntry[] with streaming blocks, replacing stores/history.ts. term.ts: cols, rows, touch, inApp, keyboardOpen. prefs.ts: bell style and the in-app hint seen flag. |
| `src/stores/theme.ts, src/stores/cathode.ts` | theme.ts: a pure store persisted by name under vesen:theme, migrated from colorscheme, with storage access in try/catch. Fixes theme.ts:71 and :78 with setAttribute('sizes','any') in the bootstrap subscription. Deletes updateThemeListHighlight and updateFastfetchThemeName (lines 33-55). cathode.ts: delete updateCathodeListHighlight (lines 41-49); keep the modes and the storage key. |
| `src/ui/Terminal.svelte, src/ui/Transcript.svelte, src/ui/Entry.svelte, src/ui/StatusLine.svelte` | NEW. Terminal: the scroll container with stick-to-bottom and the '↓ new output' pill, tap-to-focus rules, the visual bell host and role=log. Entry: prompt snapshot, line, '^C' marker and blocks. StatusLine: braille spinner (static under reduced motion), job label, elapsed seconds after 3 s, and a cancel hint or button. |
| `src/ui/OutputView.svelte, src/ui/SpanView.svelte` | NEW. Block and Span rendering through text interpolation only. Live bindings are derived from the stores. The use:legacyHtml action wraps DOMPurify with RETURN_DOM_FRAGMENT and the allowlist, and is the only HTML path. |
| `src/ui/Prompt.svelte` | NEW, replacing components/Ps1.svelte. Renders a prompt Line, live from $cwd for the input row and from a snapshot for past entries. A <span>, not an <h1>. |
| `src/ui/lineEditor.ts, src/ui/LineEditor.svelte, src/ui/keymap.ts` | NEW. A pure reducer with EditorState, EditorAction and EditorEffect, plus a thin component wrapping a native input (16px on coarse pointers, never disabled) and the key map. Replaces components/Input.svelte (705 lines), deleted when step 5 lands. |
| `src/ui/AccessoryBar.svelte, src/ui/CompletionList.svelte` | NEW. AccessoryBar: the phone key bar and chips, replacing CommandSuggestionsRow.svelte. CompletionList: the desktop double-Tab list and menu-select view. |
| `src/ui/AppHost.svelte, src/ui/apps/Shutdown.svelte, src/ui/apps/Pager.svelte, src/ui/apps/Editor.svelte, src/ui/apps/Matrix.svelte` | NEW. The alternate screen for tty.fullscreen(). - Shutdown (step 6) reproduces poweroff without touching document.body. - Pager and Editor arrive in wave F. - Matrix arrives in wave E. |
| `src/commands/index.ts, src/commands/legacy.ts` | NEW. index.ts: import.meta.glob registration; asserts unique names. legacy.ts: the adapter plus the table of not-yet-ported commands with their metadata. Deleted in step 7. |
| `src/commands/{portfolio,files,text,shell,system,network,fun,editor}/*.ts` | NEW. One CommandSpec per file, typically 30-80 lines. Heavy commands use load(). See the steps for the port order and waves. |
| `tests/harness.ts, tests/transcripts/*.txt, tests/fixtures/net/*.json` | NEW. tests/harness.ts provides runLine(line, {cols, tty, seed, net}), returning {stdoutPlain, stderrPlain, blocks, status}. Golden transcripts use '$ cmd' lines, expected output and '? status'. Recorded fixtures cover DoH, ipify, GitHub, Open-Meteo, Nominatim, and the timeout, offline, 429 and CORS variants. |
| `src/**/*.test.ts` | NEW. Colocated unit tests for every shell, output, vfs and ui reducer module, plus one contract test per command. |
| `e2e/*.spec.ts, playwright.config.ts` | NEW. Projects: Desktop Chrome 1280x800; WebKit iPhone 390x664 with an Instagram user agent; Chromium Pixel 7. Network is mocked through page.route. |
| `docs/SHELL.md, docs/ADDING_COMMANDS.md, README.md` | SHELL.md: the supported grammar and known gaps. ADDING_COMMANDS.md: copy commands/text/wc.ts, add examples, then npm test. README.md: an Architecture section. |

## External services

- No external API for the core. Parser, executor, VFS, help/man, completion and persistence are local. localStorage keys: vesen:fs:v1, vesen:history:v1 and vesen:theme (migrated from colorscheme); the cathode key is unchanged. Every access goes through services/storage.ts with try/catch and a memory fallback, for in-app browsers and private mode.
- Cloudflare DNS-over-HTTPS JSON for dig, host, nslookup and ping's resolve step (wave D): GET https://cloudflare-dns.com/dns-query?name={host}&type={A|AAAA|CNAME|MX|NS|TXT|SOA|CAA} with header accept: application/dns-json. All three designs report HTTP 200 with ACAO *. 5 s timeout; answers cached for their TTL.
- Google DoH fallback: GET https://dns.google/resolve?name={host}&type={type}. Same JSON shape, reported ACAO *. Used only when Cloudflare fails or times out.
- ipify for ip addr, ifconfig and fastfetch 'Public IP': GET https://api.ipify.org?format=json. Already used at src/utils/commands/system.ts:448. Cached per session; the label is fixed from 'Local IP'.
- Cloudflare trace for ip addr's location and colo and the speedtest server label: GET https://www.cloudflare.com/cdn-cgi/trace, key=value text, reported ACAO *.
- Cloudflare speed endpoints, existing at network.ts:460-461: GET https://speed.cloudflare.com/__down?bytes=N and POST https://speed.cloudflare.com/__up. They are re-ported in wave D with res.ok checks, streamed byte counting, a time bound, a light profile on saveData, 2g/3g or touch, `speedtest --full` for the full run, and no sendBeacon fallback (F027, F028).
- RDAP for whois: GET https://rdap.org/domain/{domain}, which 302s to the registry; reported ACAO * on both hops. TLDs without RDAP print 'whois: no RDAP service for .tld' and exit 1.
- GitHub REST for repo cards and git log in ~/projects/vesen: GET https://api.github.com/repos/hsalvesen/vesen and /commits?per_page=10 with Accept: application/vnd.github+json. 60 requests per hour per IP unauthenticated; cached 10 min in sessionStorage; falls back to the static repo card.
- Open-Meteo forecast and geocoding plus Nominatim fallback for weather. Owned by the weather workstream and consumed through services/weather. The lead verified Open-Meteo is CORS * and free, that Open-Meteo geocoding misses Gadigal and Aotearoa, and that Nominatim resolves Gadigal: use an alias table, cache, honour Nominatim's 1 request per second, and attribute OpenStreetMap. The shell supplies only the spec slot, net.memo, deadlines and NetError copy.
- Market data for stock, owned by the stock workstream through services/market, MarketProvider.quote(symbol, signal). Per the lead and F037/F038: no public CORS proxy (api.allorigins.win times out, corsproxy.io returns 403, Yahoo direct returns 429 and has no CORS). An owned edge proxy is expected.
- curl/wget: a direct fetch only. The dead proxy cascade (network.ts:134-139) is deleted (F038). A CORS failure prints `curl: (7) blocked by CORS: <host> does not allow browser requests`. If the network workstream ships an owned proxy, an opt-in `curl --via-proxy` uses VITE_FETCH_PROXY and says so on stderr. Responses are capped at 1 MB; HTML is shown as escaped text.
- Browser platform APIs: visualViewport, ResizeObserver, matchMedia (pointer: coarse and reduced motion), Clipboard API with execCommand fallback, Web Share API, one AudioContext, AbortController with a manual any() helper, crypto.subtle.digest (sha256sum), crypto.getRandomValues ($RANDOM, /dev/urandom), navigator.userAgentData, navigator.storage.estimate (df), navigator.deviceMemory (free), navigator.onLine.
- umami (existing; VITE_TRACKING_*): the event name is the registered argv[0]. Data: exit status, touch or desktop, inApp flag. Never arguments, file contents or sudo input.

## Steps

1. STEP 0: Guardrails (0.5 d, deploy).
- Install vitest ^3.2, happy-dom and @testing-library/svelte; add `npm test`, tsconfig.strict.json, scripts/check-boundaries.mjs and scripts/check-bundle.mjs.
- Gate both Firebase workflows on check, strict check, boundaries, test, build and the bundle budget. Resolves F084 for new code.
- Fix the 2 svelte-check errors (src/stores/theme.ts:71, :78) with setAttribute('sizes','any').
- Merge features-grep. Verified: `git merge-tree --write-tree main features-grep` exits 0, the change is 2 files, and the output is escaped.
- Add the firebase.json CSP as Report-Only, plus security and cache headers (F006, F007).
- Record golden plain-text and DOM snapshots of today's outputs at 40, 80 and 120 columns for banner, help, ls, cat README.md, theme ls, cathode ls, fastfetch (mocked navigator), history and the stock/weather fixtures, for parity checks.
2. STEP 1: Safe rendering shim (1 d, deploy).
- Add src/output/model.ts, ui/OutputView.svelte, SpanView.svelte and the use:legacyHtml action (DOMPurify with RETURN_DOM_FRAGMENT and the allowlist).
- History.svelte:20 renders every legacy string as a legacyHtml block.
- CommandSuggestionsRow.svelte:62 renders plain text spans.
- Move the wrapping CSS from textWrap.ts into OutputView (pre-wrap, overflow-wrap:anywhere).
- Add role=log, aria-live=polite, aria-busy, an input aria-label, and turn the Ps1 <h1> into a <span> (F094).
- Enforce the CSP header and add the index.html meta copy for Docker.
- Tests: an XSS corpus through sanitize and through History (img onerror, svg onload, iframe srcdoc, javascript:/data: hrefs, style url(), mXSS shapes, attribute breakouts). The legacy-parity test checks that old innerHTML equals the sanitised DOM for every golden.
- Resolves F004 and F005, and the {@html} part of F067 and F080.
3. STEP 2: Shell core behind the legacy adapter (3 d, deploy).
- Add the kernel: shell/{types, observable, ast, lexer, parser, histexpand, alias, expand, glob, streams, executor, flags, registry, help (legacy fallback), session, index}, output/{sgr, plain, html-to-text}, and services/{net, storage, clock, analytics, bell}.
- Add commands/legacy.ts and commands/index.ts registering all 26 commands with their category, summary (from the unused commandDescriptions), args/subcommands metadata and network flags.
- Make processCommand (commands.ts:318-361) delegate to shell.start.
- Input.svelte:
  - Enter calls shell.preflight and then shell.start.
  - Ctrl+C aborts any job, replacing the allowlists at commands.ts:343 and Input.svelte:294-300 (F045).
  - Ctrl+C copies when text is selected (F014).
  - The input is never disabled (remove Input.svelte:305 and :667's disabled; keep aria-busy and type-ahead) (F012).
  - The entry is pushed at submit with the job label (F013).
  - Analytics send argv[0] and status only.
- Legacy network commands get the 8 s deadline through the adapter, so a hung proxy no longer locks the terminal (F047).
- Registry: Map-based, throws on duplicates. Delete the dead reset at fileSystem.ts:479-501 (F034, F031).
- Tests: about 80 lexer/parser cases, expansion and alias cases, flags, and executor transcripts (`echo a b | wc -w` with a stub wc, `false || echo x`, `yes | head -n 2`, `echo hi > f; cat f`, `cat nope 2>/dev/null; echo $?`).
- Resolves F039, plus F066 for exit codes.
4. STEP 3: VFS, cwd store, persistence and the content move (2 d, deploy).
- Build vfs/{types, errors, path, vfs, seed, special, persist}:
  - re-home the misnested /home children into /home/guest, with a /home/user -> guest symlink (F003)
  - add /home/has, /etc, /dev, /proc, /root, /tmp, and /usr/bin generated from the registry
  - permissions and null-prototype children (F082, F031)
  - one path normaliser (F021)
  - the identity module (F024)
- Run scripts/convert-content.mjs and git mv the converted owner files to src/content/*.vt (F026's grep-on-markup issue disappears).
- utils/virtualFileSystem.ts becomes a shim exporting the backing literal, currentPath mirrored from the cwd store, and resolvePath with HOME = /home/guest.
- Port cd and pwd here (cd -, ~, OLDPWD, did-you-mean), plus reset onto shell.reset(), because both write the cwd.
- stores/screen.ts replaces stores/history.ts; delete the localStorage churn at history.ts:6-7 and :22-28 (F025).
- ui/Prompt.svelte renders a snapshot per entry and the live $cwd (F023).
- Boot sources ~/.bashrc, so ll, la and l work.
- Theme is persisted by name with migration from 'colorscheme'.
- Tests: permission matrix, ELOOP, rename and copy, glob, the persistence round-trip including seedVersion replay, the 512 KB ENOSPC cap, a throwing Storage leading to the memory fallback, and the prompt after cd.
5. STEP 4: Port the first five plus help/man (2.5 d, deploy).
1. echo and printf: -n -e -E, SGR escapes, plain text. The private redirect parser at fileSystem.ts:374-477 goes (F040).
2. cat: multiple files, '-' and stdin, -n -b -A; styled owner files on a TTY only; 'Is a directory'; continues after errors. Deletes loadRealFile (fileSystem.ts:12-36).
3. ls: -a -A -l -h -1 -R -d -t -r -S -F --color; a grid Block on a TTY, one entry per line in pipes; tappable names; sorted (F018, F015).
4. help, man, whatis, apropos and the --help renderer from specs (F042).
5. theme and cathode: ls/set/NAME, case-insensitive; theme ls as swatch rows with LiveBinding highlight (F075, F030, F009).
- In the same PR: history (-c, -d N, N; persistent), clear, mkdir (-p -v), touch (multiple operands), and rm (-r -R -f -i -v; refuses . .. /; F017, F019, F020).
- Delete the matching helpTexts entries, duplicate usage strings (commands.ts:147-155, 199-209) and src/utils/commands/system.ts:604-621.
- Role tokens land here (F068 values are owned by the UI workstream).
- Executable-examples test: every spec's offline examples exit 0.
6. STEP 5: Line editor, completion engine and phone layer (3 d, deploy).
- Add shell/complete.ts, ui/lineEditor.ts with keymap.ts (Tab state machine, history prefix search, Ctrl+R, kill ring, PS2), LineEditor.svelte (native input, 16px on coarse pointers, enterkeyhint=go, IME-safe), CompletionList.svelte and AccessoryBar.svelte (chips, Stop chip, pointerdown focus retention).
- Add platform/{env, viewport, measure} and stores/term.ts, with --app-h/--kb-inset, coordinated with the UI workstream for the viewport meta and dvh (F076, F077).
- Add ui/Terminal.svelte with the single stick-to-bottom rule (F010) and the tap-to-focus rules (F011).
- Delete Input.svelte, CommandSuggestionsRow.svelte, src/utils/commandSuggestions.ts, src/utils/mobile.ts and src/utils/textWrap.ts.
- Add the ?cmd= fill-only deep link.
- Add Playwright (Desktop Chrome, WebKit iPhone with Instagram UA, Pixel 7) in CI on PRs.
- Resolves F022, F067, F046 and the remaining parts of F012 and F014.
7. STEP 6: Streaming, TTY services and openers (1.5 d, deploy).
- rAF-batched streaming into ScreenEntry; StatusLine with the job label and elapsed time (F013, F047).
- tty.readLine with secret mode: port sudo ('Sorry, try again.', then 'guest is not in the sudoers file. This incident will be reported.' plus the gag card) and delete the sudo branches at Input.svelte:112-136 and :244-285.
- Add services/opener.ts with spec.opens preflight and link cards; port whoami (alias linkedin; prints 'guest' when piped), repo, email (copy chip) and banner (compact below 50 cols).
- Add AppHost and the Shutdown app; port poweroff, reboot and shutdown, removing the document.body rewrite at fileSystem.ts:515-538.
- Port the remaining measurement users onto termSize (F016 complete).
8. STEP 7: Port the remaining legacy commands and clean up (2.5 d, deploy, release v2.0.0).
- fastfetch: lazy; services/sysinfo; columns Block; 'Public IP'; LiveBinding for WM Theme.
- speedtest: res.ok, streamed counting, time-bounded progressive sizes, light profile and `--full`, no beacon fallback, tty.status progress (F027, F028).
- curl: direct fetch with honest CORS/timeout/offline errors; delete the proxy cascade at network.ts:134-139 (F038).
- qr, weather and stock as specs over the providers delivered by the data workstreams: in-house QR art Block, Open-Meteo plus alias table plus Nominatim, owned-proxy market data (F026, F035, F036, F037, F060, F065).
- Delete src/utils/** (helpTexts, commands.ts, commands/*, virtualFileSystem shim, tracking, osLogos moved to commands/system/fastfetch.logos.ts, beep.js), commands/legacy.ts, output/html-to-text.ts, the legacyHtml Block, DOMPurify, src/components/{History, Ps1}.svelte, src/stores/history.ts and src/interfaces/command.ts.
- check-boundaries now forbids '{@html' everywhere. Compare against the step 0 goldens.
- Resolves F080 and F081 completely.
9. WAVE A: Text and file coreutils (3 d, two PRs).
- grep: rebuilt on the spec from the merged branch: -i -n -v -c -l -r -E -w -o --color.
- head, tail (-n -c), wc, sort (-r -n -u -k -t -f), uniq (-c -d -u), cut (-d -f -c), tr (sets, -d -s), tee (-a), sed (s///gi, -n, p, d, one expression), rev, nl, seq, yes, xargs (-n, -I {}), diff (Myers, -u), column -t, fold, base64 (-d), sha256sum (crypto.subtle).
- File tools: cp (-r -v), mv, ln -s, rmdir, stat, file, tree (-a -L -d), find (-name -iname -type -maxdepth), du -sh, df -h (vfs.usage plus navigator.storage.estimate), chmod (octal and symbolic), chown (EPERM), basename, dirname, realpath, readlink, mktemp.
- Resolves the remainder of F072 tiers 1-2.
10. WAVE B: Shell builtins and expansion (1.5 d).
- $( ) and backticks, $(( )) via arith.ts.
- alias, unalias, export, unset, env, printenv, set (-o noclobber, bell), source/., type, which, command -v, true, false, test/[, read (tty.readLine), sleep (abortable), time, exit/logout (the [Process completed] screen), date +FORMAT, cal, and `<<<` here-strings.
11. WAVE C: System (1 d).
- uname -a, hostname (-f gives location.hostname), id, groups, who, w, tty, uptime (/proc/uptime), free -h, nproc, arch, lscpu, locale, lsb_release, ps aux (init, vesen and the current job), top (one-shot), kill (pid 1 gives Operation not permitted; the job pid aborts the job), dmesg (/var/log/syslog), and finger has (~has/.plan).
12. WAVE D: Network (1.5 d).
- dig (+short, record type), host and nslookup over Cloudflare DoH with Google fallback.
- ping -c N: DoH resolve, then HTTPS no-cors RTT, labelled 'via HTTPS', streaming lines and summary.
- ip addr / ifconfig: lo plus eth0 with the ipify public IP and Cloudflare trace colo, clearly labelled.
- whois (RDAP), wget -O into the VFS, curl -I -i -s -L -o -X -H -d, git log/remote -v in ~/projects/vesen (GitHub API, cached).
- traceroute, nc and ssh print honest sandbox messages.
13. WAVE E: Fun (1 d, lazy chunks).
- cowsay -f (original cows), fortune (original computing one-liners only), figlet (one embedded font), lolcat (palette cycling via spans).
- sl and cmatrix: fullscreen, honour reduced motion, any key or tap exits.
- Easter eggs: `rm -rf /` gives Permission denied plus a wink; `sudo make me a sandwich`.
- All hidden from the first Tab list.
14. WAVE F: Pager, editor and polish (2 d).
- Pager.svelte: less and more (q, space, b, /search, n, a 44px Close on phones); man uses it on a TTY.
- Editor.svelte: nano (^O/Ctrl+S save, ^X with 'Save modified buffer? (Y/N)', ^W, ^K/^U, '[ File is unwritable ]', phone toolbar [Save] [Exit] [Find]), writing through the VFS so permissions apply. vi and vim open it with a one-line notice.
- Optional desktop-only syntax-highlight mirror and fish-style ghost suggestions behind ?editor=mirror, promoted only after real-device IME checks.
- Update docs/SHELL.md and ADDING_COMMANDS.md.

## Testing

1. RUNNERS AND GATES
- vitest ^3.2: node environment for shell/output/vfs/commands/services, happy-dom for ui.
- Playwright for e2e.
- CI on every PR and on merge: svelte-check with 0 errors, check:strict, check:boundaries, vitest, build, the bundle budget (initial JS at most 70 kB gzip), and the Playwright smoke project (from step 5).

2. KERNEL UNIT TESTS (table-driven, under 2 s)
- lexer: quotes, escapes, comments, every operator, unterminated input, partial mode, token ranges.
- parser: AST snapshots, incomplete reasons, syntax-error positions, explicit not-supported keywords.
- fuzz: 10k random strings over the shell alphabet either parse or return a ParseResult error; they never throw anything else.
- histexpand: !! !n !-n !prefix !$ ^a^b, immunity inside single quotes, event not found.
- alias: pipes inside an alias, recursion guard, trailing-space rule.
- expand: tilde forms, ${x:-d} family, $? after failure, IFS splitting of unquoted expansions only, globs (hidden-file rule, no-match keeps the literal, sorting), $( ) nesting, $(( )).
- flags: -la, -n5, -n 5, --lines=5, --, numeric shortcut, unknown option wording, the -h rule.
- registry: duplicate name or alias throws; suggest distances; hints for commands found elsewhere.

3. EXECUTOR, STREAMS AND OUTPUT
- `yes | head -n 3` ends in under 50 ms, and its 141 status stays hidden.
- `cat f | sort | uniq`, `false && x || echo y`, `! false`.
- `>` vs `>>` vs noclobber, `<`, 2>&1 ordering, `cat f > f` truncates as bash does.
- Statuses 2, 126, 127, 130 and 141.
- Abort drops later writes; the network deadline fires on a never-resolving fake fetch.
- SGR parser: combinations, chunk boundaries inside an escape, OSC 8 allowlist, ESC[2J, and proof that no Action can come out of parsed text.
- plain() fallback for every Block type.
- LiveBinding re-renders when the theme store changes.

4. VFS
- errno matrix per operation for guest versus root, symlink ELOOP, rename-into-self EINVAL, rm refusing . .. /, a dangling cwd.
- /proc generators with an injected clock and SysInfo.
- Persistence: round-trip, whiteouts, seedVersion replay with user files winning, the 512 KB ENOSPC cap, a throwing Storage giving the memory fallback, old-key migration (colorscheme to vesen:theme).

5. COMMAND CONTRACTS (tests/harness.ts)
- Golden transcripts per command at 40, 80 and 120 columns, with isTTY true and false.
- Spec lint: summary of 50 characters or fewer, a description on every flag, no duplicate flags, an h flag removes -h help.
- Every offline example runs with status 0 on a fresh VFS.
- `--help` and `man` render for every spec, and help lists every non-hidden spec.
- Network commands use recorded fixtures plus timeout, offline, 429, CORS and malformed-JSON variants, so the error copy is pinned.

6. SECURITY
- XSS corpus typed through the whole pipeline (echo, cat of a written file, history, not-found, ls of a crafted filename, completion chips, curl of a mocked HTML body), then OutputView mounted in happy-dom. Asserts no on* attributes, no script/iframe/svg/math/object, no javascript: or data: hrefs, no url( in styles, and window.__x undefined.
- During steps 1-6, the same corpus goes directly through the legacyHtml sanitiser.
- Source test: no '{@html' outside OutputView (and none after step 7).
- ?cmd= never executes.

7. LEGACY PARITY (steps 1-7)
- Sanitised DOM equals the old innerHTML for every step 0 golden.
- Each port checks that span fg equals the old var(--theme-x).

8. COMPLETION AND EDITOR
- About 60 table cases of line|cursor giving candidates and common prefix:
  - `cd do`, `cat documents/li`, `ls --al`, `theme set sw`, `ls | gr`, `echo hi > ~/do`, `$HO`, `sudo ca`, `man l`
  - a quoted path with spaces, a case-insensitive fallback, and suggest mode on an empty line and an empty operand
- Reducer tests: Tab 1/2/3, Shift+Tab, Esc restore, history prefix search, Ctrl+R, kill ring, PS2 joining, secret mode, type-ahead while busy, Ctrl+C with a selection giving copySelection.

9. COMPONENT TESTS (@testing-library/svelte)
- An AccessoryBar chip's pointerdown calls preventDefault and focus stays.
- The input is never disabled while busy.
- Old entries keep their prompt after cd.
- Link cards are <a rel=noopener>.

10. E2E (Playwright: Desktop Chrome; WebKit iPhone 390x664 with an Instagram UA; Pixel 7)
- Banner and help render.
- `cd documents` shows ~/documents in the prompt.
- `cat do<Tab>li<Tab>` completes; double-Tab lists.
- Chip taps complete at 375 px.
- document.scrollingElement.scrollWidth <= innerWidth after help, ls -la, fastfetch, qr, man ls, banner and history.
- The input font size is at least 16px on touch.
- The XSS payload triggers no dialog.
- touch, reload and ls keep the file; reset restores everything.
- whoami in the Instagram profile prints a card and calls window.open 0 times (spied).
- ^C during a delayed mocked fetch gives ^C and $? = 130.
- The [Stop] chip works.

11. MANUAL DEVICE PASS PER RELEASE
Open the Firebase preview URL from an Instagram DM on iOS and Android (same in-app browser as the profile link) and check:
- the keyboard stays up across 3 commands
- the prompt stays above the keyboard
- chips work
- link cards and mailto work, and copy works
- rotation reflows grids
- reduced motion is honoured
- persistence survives a reload, and reset works

## Risks

- Sanitiser gap during the shim period (steps 1-7). Mitigations:
- DOMPurify with RETURN_DOM_FRAGMENT, so nothing is re-serialised (no mutation XSS)
- a tight tag, attribute, class and CSS allowlist
- a corpus test suite
- CSP header plus meta as a second layer
- the shim and DOMPurify are deleted in step 7
- Visual regressions while legacy HTML passes the allowlist, and later when commands are ported to spans and Blocks (fastfetch flex layout, stock panels, help panels). Mitigations: step 0 goldens at three widths, the parity test, colour-equality checks per port, and a review of the Firebase preview on every PR.
- Async execution loses user activation, so window.open would be blocked in Safari/WKWebView. Today whoami opens synchronously (system.ts:10). Mitigations:
- spec.opens preflight runs synchronously in the Enter or tap handler
- every opener also prints a real <a> card
- in-app browsers skip window.open entirely
- Older Instagram WKWebView (iOS 15/16) lacks AbortSignal.any and AbortSignal.timeout (iOS 17.4 / 16), Object.groupBy and Promise.withResolvers. Mitigations: the manual signal-combining helper, a review ban on those APIs, build.target safari14, and WebKit e2e runs.
- IME and soft-keyboard edge cases in the new editor (Gboard keyCode 229, iOS predictive text, composition). Mitigations: a native input on all devices; the reducer reads value and selection from input events, not keydown; the mirror and ghost text stay opt-in desktop polish in wave F.
- Storage blocked, wiped or partitioned in in-app browsers, corrupt payloads, schema or seed changes. Mitigations: versioned keys, the seedVersion overlay replay, try/catch everywhere, the memory fallback with one notice, the 512 KB cap with ENOSPC, and reset as the escape hatch.
- Concurrent pipelines and streaming add complexity, plus runaway producers (`yes`, `cat /dev/zero`, `ping`). Mitigations: a 64 KiB high-water mark with EPIPE, loop-capable commands check ctx.signal and await write(), 20k-line scrollback with '[output truncated]', rAF batching, and dedicated executor tests.
- During migration, legacy commands report 0 or 1 heuristically, so && chains may misbehave until they are ported (worst case `weather nowhere && echo ok`). Network commands are ported in step 7, so the window is about a week.
- Keyboard ownership conflicts between the prompt, readLine, the fullscreen apps and the window-wide handler at Input.svelte:645-652. Mitigation: a single key dispatcher with an explicit focus owner, introduced in step 5, before any fullscreen app.
- Scope creep toward full bash (if/for/while, functions, job control, heredocs). Mitigations: docs/SHELL.md lists what is supported, unsupported syntax fails loudly with status 2, the kernel API is frozen after step 2, and the waves are time-boxed and independently shippable.
- Bundle growth from about 110 commands. Mitigations: lazy load() for heavy commands (qr encoder, fastfetch logos, figlet, nano, pager, cmatrix), metadata kept eager, a CI gzip budget of 70 kB (48.7 kB today), and DOMPurify (about 9 kB gzip) removed at step 7.
- Third-party limits and outages: GitHub 60 requests per hour per IP, Nominatim 1 request per second with attribution, RDAP coverage varying by TLD, DoH availability. Mitigations: net.memo caches with failure cool-downs, Google DoH fallback, static fallback cards, and pinned error copy.
- Owner-visible behaviour changes: history persists, HOME becomes /home/guest (with a /home/user symlink), the theme is persisted by name, analytics drop arguments, -h is no longer universal help for ported coreutils, and whoami prints 'guest' when piped. Each needs owner sign-off; see the open questions.
- Content and copyright: fortune, cowsay and figlet content must be original or permissively licensed, and the sudo gag links the video without reproducing lyrics.
- CSP connect-src must stay at 'https:' because curl and wget fetch arbitrary URLs, so CSP does not limit exfiltration. Script injection is the threat it does block. The umami origin must be listed in script-src, and any future inline boot script needs its sha256 added.

## Effort

About 26 dev-days for one engineer who knows Svelte 5 and TypeScript (±25%). Each item is its own PR with a Firebase preview.

Core, about 16 days:
- Step 0, guardrails: 0.5 d
- Step 1, safe renderer: 1 d. XSS is closed at about day 1.5 with no visual change.
- Step 2, kernel with legacy adapter: 3 d. Quotes, pipes, redirects, $? and ^C for all commands by about day 4.5.
- Step 3, VFS, cwd, persistence and content: 2 d. The prompt follows cd by about day 6.5.
- Step 4, first five ports plus help/man and the file trio: 2.5 d.
- Step 5, editor, completion and phone layer: 3 d. Tap-completion in Instagram by about day 12.
- Step 6, streaming, TTY and openers: 1.5 d.
- Step 7, remaining ports and cleanup: 2.5 d. Release v2.0.0 at about day 16.

Waves, about 10 days:
- A, coreutils: 3 d
- B, builtins and expansion: 1.5 d
- C, system: 1 d
- D, network: 1.5 d
- E, fun: 1 d
- F, pager, editor and polish: 2 d

Excluded: the in-house QR encoder, the weather provider, the stock/edge proxy and the UI workstream's visual tokens. Plugging them into specs is included in step 7.

Size estimate: about 3k lines of kernel, output, vfs and services; about 3k lines of commands; about 1.5k lines of tests. Today's roughly 5.1k lines lose about 3.5k as the legacy files, Input.svelte (705 lines) and commandSuggestions.ts (234 lines) are deleted.

## Trade-offs

1. Strangler migration over a big-bang rewrite (design 0's backbone). Everything works from day one and ships in 1-3 day PRs. The cost: two output paths for about two weeks, and heuristic exit codes for legacy commands.

2. Two output channels:
   - Text with an SGR subset for realism (pipes, files, echo -e and printf behave like Unix).
   - Trusted Blocks for rich layout (grid, table, art, card, columns), which degrade to plain text in pipes.
   This costs more than design 1's ANSI-only model, but keeps fastfetch/stock layouts, reflow on rotation and tap targets. Actions are never parsed from text.

3. Concurrent bounded pipes over design 0's sequential buffers. About 150 more lines, in exchange for streaming output and correct `yes | head` and `ping | grep`.

4. DOMPurify as a temporary dependency over a hand-written sanitiser. Security-critical parsing is not reinvented, and it is deleted at v2.0.0. The owner's in-house preference applies to weather, qr and stock, where it is honoured.

5. Owner content converted to a {color} markup rather than kept as trusted HTML (design 0) or flattened to Markdown (design 2). The exact colours survive, grep and wc see real text, and there is no permanent HTML path. The cost is a one-time conversion script.

6. localStorage behind a KV interface over IndexedDB. Synchronous boot, completion and VFS, with a 512 KB cap. IndexedDB stays a drop-in later.

7. svelte/store-compatible observables over runes classes for kernel state. The kernel stays svelte-free and testable in node, components use $store, and the existing theme and cathode stores are unchanged in style.

8. A native input everywhere over a mirror editor. No inline syntax colours or ghost text by default, in exchange for IME safety and zero zoom where the Instagram audience is. The mirror is opt-in desktop polish.

9. No control flow, functions, job control or heredocs. `test`/`[` with && and || covers interactive use, and unsupported syntax fails loudly.

10. Portfolio semantics win where they conflict with Linux:
    - whoami opens LinkedIn on a desktop TTY but prints 'guest' in pipes
    - sudo stays a joke
    - reset keeps today's full restore
    - vesen commands confirm in one line

11. Single user (guest, uid 1000) with simplified POSIX permissions. No ACLs, and groups are for display only.

12. HTTP RTT ping and DoH DNS stand in for ICMP and UDP, labelled honestly. curl has no public CORS proxies; CORS failures are reported, not hidden.

13. -h means help unless a command defines -h: friendlier than GNU, and still allows ls -lh, df -h and free -h.

## Open questions raised by this design

- History persistence: should command history and files under ~ now survive reloads? Today src/stores/history.ts:6-7 deliberately wipes both on every load. The proposed default is yes, with `history -c`, lines starting with a space not saved, and `reset` clearing everything.
- Reset: now that files persist, should `reset` keep today's full factory restore (theme swamphen, cwd, original files, history; commands.ts:116-141)? The alternative is a split: `reset` restores the screen and theme, and `reset --hard` (with a y/N prompt) restores files and history.
- whoami: should it keep auto-opening LinkedIn on desktop (system.ts:10), with a link card only inside Instagram and other in-app browsers? Or should it always show a card and leave the jump to `linkedin`?
- Prompt identity: keep the full host in the prompt (guest@www.vesen.app, 31 characters on a ~46-column phone) or switch to a short 'vesen' (F024)? And is user guest with HOME=/home/guest acceptable, keeping /home/user as a compatibility symlink?
- Portfolio content: what should /home/has contain (about.md, projects.md, .plan for `finger has`)? And do you approve converting README.md, history.txt and linux.txt from inline HTML spans to the {color} markup? The colours stay identical, and the files leave public/.
- Coreutils output: should mkdir, touch and rm become silent on success as on Linux (with -v to confirm), or keep today's friendly confirmation lines for Instagram visitors?
- Owned proxy: is an owned edge proxy (Cloudflare Worker or a Firebase function, with an allowlist and rate limit) acceptable to run and pay for? It would back stock and an opt-in `curl --via-proxy`. Every public CORS proxy in network.ts:134-139 fails (F038).
- Analytics: is it OK to send umami only the command name, exit status and device class, instead of every argument as tracking.ts:9-14 does today?
- Bell and zoom: should the default bell be audible on desktop and visual on touch? And do you accept removing maximum-scale/user-scalable=no from index.html:6, which restores pinch zoom for accessibility (F077)?
- Docker image: is it still a supported deliverable? Its busybox httpd cannot send headers, so it would only get the CSP <meta> fallback (no frame-ancestors). The alternative is switching the final stage to a server that can set headers.
