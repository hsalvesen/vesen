# The shell, the file system and the command catalogue

**Goal:** make vesen behave like a real Linux shell (quoting, pipes, redirection, variables, globs, aliases, history, exit codes, realistic coreutils and a realistic file system) while keeping its portfolio commands, themes and CRT effects intact. Adding a command should take about 50 lines in one file.

**Reference design:** [designs/shell-architecture.md](designs/shell-architecture.md). The shared decisions in [02-architecture-and-contracts.md](02-architecture-and-contracts.md) override it where they differ. A working lexer, parser and interpreter with pipes, redirection, `&&`, `||` and `$?` is already in [prototypes/shell/](prototypes/shell/).

## What is wrong today

- **No shell grammar.** The input is split on whitespace in two different ways (`commands.ts:319` and `Input.svelte:262`), with no quoting, pipes, `;`, `&&`, variables or globs. Redirection exists only inside `echo`, which is why `echo "5 > 3"` writes a file named `3"` (F039, F040).
- **Flags and operands.** `ls` recognises only a literal `-a`, `rm` only a bare `-r` in first position, and `mkdir -p x` creates a directory named `-p`. Commands take one operand and print confirmations that coreutils never prints (F017, F018, F019).
- **The file system.** The home folder is mis-nested: dotfiles and project folders sit in `/home` beside `user` (F003). Paths with `..` after `/` or `~/` fail (F021). `rm -r .` deletes the current folder (F020). Files have no permissions, owners, sizes or times (F082). The seeded documents are HTML, so `grep` would see tags (F093).
- **The prompt.** It always shows `~`, whatever the current folder (F023). The identity disagrees with itself: the prompt says `guest`, the home is `/home/user`, `/etc/passwd` gives guest `/home/guest`, and `fastfetch` prints `user@` (F024).
- **The registry.** Commands are an untyped object spread with silent name collisions: two `reset` implementations exist and one is dead (F033, F034). Names like `constructor` run as commands (F031). Help lives in four places that disagree (F042, F043).

## How the shell works after this plan

A line goes through these stages:

1. **History expansion:** `!!`, `!n`, `!prefix`, `!$` and `^a^b`.
2. **Lexing and parsing** into lists, `&&`/`||` chains and pipelines. An unclosed quote or a trailing `|` shows a `> ` continuation prompt.
3. **Alias expansion**, so `ll` and `la` from `~/.bashrc` work.
4. **Word expansion:** tilde, `$VAR` and `${VAR:-default}`, `$?`, command substitution, arithmetic, field splitting, globbing against the virtual file system, then quote removal.
5. **Redirection:** `<`, `>`, `>>`, `2>`, `2>&1` and `&>`.
6. **Execution:** the stages of a pipeline run concurrently over bounded pipes, so `yes | head -3` ends at once.

Flags are parsed getopt-style from each command's spec: `-la`, `-n5`, `--lines=5` and `--`. Errors use Linux wording and real exit codes. Unsupported syntax such as `if`, `for` and functions fails loudly: `vesen: for: not supported in vesen`.

A legacy adapter wraps all 26 existing commands on the first day of the kernel, so every one of them gains this grammar at once. Commands are then ported one pull request at a time.

## The file system after this plan

- **Class.** A `Vfs` class over the existing tree literal, with null-prototype children, one path normaliser, typed errors with Linux messages, and simple POSIX permissions. `touch /etc/x` gives "Permission denied", and `cat /etc/shadow` cannot be read.
- **Home folders.** The visitor is `guest` with `HOME=/home/guest`. The mis-nested folders move inside it, and `/home/user` stays as a symlink. `/home/has` holds the owner's read-only portfolio files.
- **System folders.** `/proc` files are generated on each read from the visitor's real device. `/dev/null`, `/dev/zero`, `/dev/random` and `/dev/urandom` exist. `/etc` gains `hostname`, `os-release` (with the real version), `passwd`, `group`, `shells` and `motd`. `/usr/bin` lists the registered commands.
- **Owner documents.** `README.md`, `history.txt` and `linux.txt` are converted once to a small `{cyan,bold}…{/}` markup. `cat` keeps their exact colours, while `grep` and `wc` see plain text.
- **Persistence** (if the owner approves). Changes under `~` and command history survive a reload. If storage is blocked, everything still works for the session, with one dim notice. `reset` restores everything.

## Portfolio commands in a realistic shell

| Command | Behaviour |
|---|---|
| `whoami` | Prints `guest` in a pipe. On a desktop terminal it also opens LinkedIn, if the owner keeps that |
| `linkedin`, `about`, `contact` | Print link cards |
| `email` | A link card with Copy |
| `repo` | A link card; `git log` inside `~/projects/vesen` reads recent commits from the GitHub API |
| `theme`, `cathode` | Unchanged, plus swatches |
| `sudo` | Stays a joke: `[sudo] password for guest:`, then `guest is not in the sudoers file. This incident will be reported.` with the punchline as a link |
| `poweroff`, `reboot`, `shutdown` | A shutdown screen with Power on, never a dead page |
| `reset` | Keeps today's meaning: banner, default theme, home folder, original files |

## Command catalogue

Commands arrive in waves. Each wave ships on its own and is time-boxed. Every command is one spec file with flags, examples (run by the tests) and a `man` page.

| Wave | Days | Commands |
|---|---|---|
| Core ports (Phase 2) | 2.5 | `echo` and `printf` (`-n -e -E`), `cat` (`-n -b -A`, stdin, several files), `ls` (`-a -A -l -h -1 -R -d -t -r -S -F --color`, sorted, grid on a terminal, one per line in a pipe), `cd` (`-`, `~`, `OLDPWD`), `pwd`, `mkdir -p`, `touch`, `rm -rfiv`, `history` (`-c -d N`), `clear`, `help`, `man`, `whatis`, `apropos`, `theme`, `cathode` |
| A: text and files | 3 | `grep` (rebuilt from the `features-grep` branch: `-i -n -v -c -l -r -E -w -o --color`), `head`, `tail`, `wc`, `sort`, `uniq`, `cut`, `tr`, `tee`, `sed` (one `s///` expression), `rev`, `nl`, `seq`, `yes`, `xargs`, `diff -u`, `column -t`, `fold`, `base64`, `sha256sum`; `cp -r`, `mv`, `ln -s`, `rmdir`, `stat`, `file`, `tree`, `find`, `du -sh`, `df -h`, `chmod`, `chown`, `basename`, `dirname`, `realpath`, `readlink`, `mktemp` |
| B: shell built-ins | 1.5 | `$( )`, `$(( ))`, `alias`, `unalias`, `export`, `unset`, `env`, `printenv`, `set -o noclobber`, `source`, `type`, `which`, `command -v`, `true`, `false`, `test` and `[`, `read`, `sleep`, `time`, `exit` and `logout`, `date +FORMAT`, `cal`, here-strings |
| C: system | 1 | `uname -a`, `hostname`, `id`, `groups`, `who`, `w`, `tty`, `uptime`, `free -h`, `nproc`, `arch`, `lscpu`, `locale`, `lsb_release`, `ps aux`, `top` (one shot), `kill`, `dmesg`, `finger has` |
| D: network | 1.5 | `dig`, `host` and `nslookup` over DNS-over-HTTPS (Cloudflare, falling back to Google); `ping -c N` timed over HTTPS and labelled as such; `ip addr`; `whois` over RDAP; `wget -O`; `curl -I -i -s -L -o -X -H -d`; honest sandbox messages for `traceroute`, `nc` and `ssh` |
| E: fun | 1 | `cowsay`, `fortune` (original lines only), `figlet` (one embedded font), `lolcat`, `sl`, `cmatrix`. All hidden from the first Tab list, all respect reduced motion |
| F: pager and editor | 2 | `less`/`more` with search; `nano` with Save, Exit and Find on a phone toolbar; `vi` and `vim` open `nano` with a one-line note; `man` uses the pager |

DNS-over-HTTPS from Cloudflare and Google and RDAP are all callable from a browser (verified, see [appendix-b-services-and-instagram.md](appendix-b-services-and-instagram.md)). `sha256sum` uses the browser's WebCrypto, so none of these need a server.

**Hints for commands that do not exist.** `vim` suggests `nano`, `apt` explains that vesen has no packages, `cls` suggests `clear`, and an unknown command offers a tappable did-you-mean within an edit distance of 2.

## Work sequence

| Step | Phase | Days | Delivers | Resolves |
|---|---|---|---|---|
| Safe renderer | 1 | 1 | Output model, `OutputView`, the legacy HTML shim, accessible log region | F004, F005, F080 (first part), F094 (part) |
| Kernel behind the legacy adapter | 2 | 3 | Lexer, parser, expansion, globbing, executor, flags, registry, session, net service; all 26 commands wrapped | F039, F066, F034, F031, F045, F013 |
| File system, current folder, persistence, content | 2 | 2 | `Vfs`, re-homed seed, identity, `/proc` and `/dev`, the prompt following `cd`, theme by name, converted documents | F003, F021, F023, F024, F025, F082, F093, F008, F041 |
| Core ports with help and man | 2 | 2.5 | The core wave above; help, `--help` and `man` generated from specs | F017, F018, F019, F020, F040, F042, F043, F075, F032, F033, F071 |
| Remaining ports and clean-up | 5 | 2.5 | `fastfetch`, `speedtest` and `curl` ports; weather, stock and QR plugged in; deletion of `src/utils/**`, the legacy adapter, DOMPurify and `helpTexts.ts`; release v2.0.0 | F080, F081, F087 |
| Waves A to F | 5 | 10 | The catalogue above | F072, F092 |

About 11 days for the safe renderer and the kernel through v2.0.0, plus 10 days of optional command waves.

## Acceptance checks

- `cat README.md | grep -i theme | wc -l` works.
- `echo hi > f; cat f` prints `hi`.
- `cat nope 2>/dev/null || echo missing` prints `missing`.
- `yes | head -n 3` ends in under 50 ms.
- `export NAME=Has; echo "hi $NAME"` prints `hi Has`.
- `ls *.txt` expands, and `ll` works from `~/.bashrc`.
- After `cd /etc`, the prompt shows `/etc`, and earlier prompts keep the folder they were typed in.
- `ls -la ~` shows `.bashrc`, `.ssh` and `projects`. `rm -rf ~/projects` works. `rm -r .` is refused.
- `echo '<img src=x onerror=alert(1)>'` prints the text literally.
- Every spec's offline examples exit 0 in the test suite.
- No `{@html` remains anywhere after v2.0.0.

## Questions for the owner

- **Persistence:** should files under `~` and command history survive reloads?
- **Silent coreutils:** should `mkdir`, `touch` and `rm` be silent on success like Linux (with `-v` to confirm), or keep today's friendly confirmations?
- **Home folder:** is `HOME=/home/guest` acceptable, with `/home/user` kept as a symlink?
- **Portfolio files:** what should `/home/has` contain (`about.md`, `projects.md`, a `.plan` for `finger has`)?
- **Reset:** should `reset` keep today's full restore, or split into `reset` (screen and theme) and `reset --hard` (files and history, with a confirmation)?
