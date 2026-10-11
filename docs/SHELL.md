# The vesen shell

vesen's shell reads a line the way bash does, as far as it goes: the same quoting, expansions, redirections, exit statuses and error wording. It runs one line at a time in the foreground and has no compound commands. This page lists what is supported, the gaps, and where vesen differs from bash on purpose. The code is in `src/shell` (the lexer, parser, expansion and executor each start with a comment saying what they do), and `src/shell/bash-compat.test.ts` pins the cases review found differing from `/bin/bash`.

## A line, step by step

1. **History expansion** (`!!`, `!$`, `^old^new^`), then the line is echoed if it changed.
2. **Alias expansion** of each word in command position.
3. **Lexing and parsing** into lists, `&&`/`||` chains, pipelines and simple commands. An unfinished line (an open quote, a trailing `\`, `|`, `&&` or `||`, an open `$(`) gets a `> ` continuation prompt.
4. **Word expansion**, in bash's order: braces, then tilde, parameters, command substitution and arithmetic (left to right), then field splitting on `IFS`, then pathname expansion, then quote removal.
5. **Redirections**, left to right, then the command: a builtin or registered command, else an executable file on `$PATH`, else `command not found` (127) with a did-you-mean you can tap.

## Grammar

```text
list     := andor ( (';' | '&' | newline) andor )*
andor    := pipeline ( ('&&' | '||') pipeline )*
pipeline := '!'* command ( ('|' | '|&') command )*
command  := ( NAME=value | redirection )* ( word | redirection )*
```

- `;` and newlines separate commands; `&&` and `||` chain on the previous status; `!` negates a pipeline's status.
- `a | b` runs every stage at once over bounded pipes, so `yes | head -n 2` ends as soon as `head` has its lines (the writer gets a silent 141). `a |& b` is `a 2>&1 | b`.
- `NAME=value cmd` sets a variable for that command only; `NAME=value` alone sets it in the shell.
- `#` at the start of a word starts a comment.
- **Quoting:** single quotes, double quotes, backslash escapes, `$'…'` with ANSI-C escapes (`\n`, `\t`, `\x41`, `é`), `$"…"` as a plain double-quoted string, and backslash-newline to continue a line.

## Expansions

| Expansion | Supported |
|---|---|
| Braces | `a{b,c}d`, nested `{a,{b,c}}`, sequences `{1..5}`, `{01..10}`, `{a..e}`, `{1..10..2}` |
| Tilde | `~`, `~/x`, `~guest`, `~has`, `~+` (`$PWD`), `~-` (`$OLDPWD`), and after `=` or `:` in an assignment |
| Parameters | `$X`, `${X}`, `${X:-word}`, `${X-word}`, `${X:=word}`, `${X:+word}`, `${#X}` |
| Special parameters | `$?`, `$$`, `$#`, `$0` to `$9`, `$@`, `$*`, `$RANDOM`, `$PWD` (`$!` and `$-` are empty) |
| Command substitution | `$( … )` and backticks, nested, with trailing newlines removed |
| Arithmetic | `$(( … ))`: signed 64-bit integers that wrap, C precedence, `?:`, assignments (`x+=2`), `++`/`--`, `**`, hex, octal and `BASE#DIGITS`; bash's error wording (`division by 0`) |
| Field splitting | Unquoted expansions split on `IFS` (space, tab and newline by default) |
| Pathname expansion | `*`, `?`, `[abc]`, `[a-z]`, `[!x]`, `[^x]`, `[[:alpha:]]` and the other classes; hidden files only when the pattern starts with `.`; sorted; a pattern that matches nothing stays as typed. `set -f` turns it off |
| History | `!!`, `!n`, `!-n`, `!abc`, `!?abc?`, `!$`, `!^`, `!*`, word designators (`:2`, `:$`, `:2-4`), modifiers (`:h`, `:t`, `:r`, `:e`, `:p`, `:q`, `:x`, `:s/a/b/`, `:gs/a/b/`, `:&`), and `^old^new^` |
| Aliases | In command position; a value ending in a space expands the next word too; an alias is never expanded inside itself |

## Redirections

| Form | Meaning |
|---|---|
| `< file` | Read standard input from a file |
| `> file`, `>> file` | Write or append standard output (`1>` and `1>>` too) |
| `>| file` | Overwrite even with `set -o noclobber` |
| `2> file`, `2>> file` | Write or append standard error |
| `&> file`, `&>> file`, `>& file` | Both outputs to one file |
| `2>&1`, `>&2`, `1>&2` | Duplicate one output onto the other |
| `<<< word` | A here-string: the word and a newline as standard input |

Redirections apply left to right, so `cmd > f 2>&1` and `cmd 2>&1 > f` differ as in bash. `/dev/null`, `/dev/stdout`, `/dev/stderr` and `/dev/zero` work. Only descriptors 0, 1 and 2 exist; any other is refused.

## Builtins and the session

The builtins run in the shell itself and can change it: `cd`, `pwd`, `export`, `unset`, `alias`, `unalias`, `set`, `source` (and `.`), `history`, `type`, `command`, `read`, `printf`, `kill`, `jobs`, `fg`, `bg`, `wait`, `time`, `exit` and `login`. `type` calls `echo`, `test` and `[`, `true`, `false` and `help` builtins too, as bash does.

- **Startup.** A session reads `/etc/profile`, then `~/.bashrc` (which defines `ll`, `la` and puts `~/bin` on `$PATH`). If `~/.bashrc` did not finish loading last time, it is skipped once, with a note saying how to fix it.
- **Scripts.** An executable file runs line by line as its own process, with its arguments as `$1`, `$2` and so on. It sees only exported variables and no aliases, and nothing it changes reaches the shell that ran it. Its `#!` line must name a shell (`sh`, `bash`, `dash`, `vesh`, or `/usr/bin/env` with one of them); any other interpreter is a `bad interpreter` error. `source FILE` runs a file in the current shell instead.
- **Options.** `set -o noclobber` (`-C`) and `set -o noglob` (`-f`); `set -o` lists them.
- **History.** Up to 500 lines, kept across visits; a line that starts with a space is not saved. `history -c` clears it.
- **Persistence.** Files you change under `~` and the history are kept in this browser; `reset` restores the original files and starts afresh.
- **Exit statuses.** 0 success, 1 failure, 2 a usage error from a builtin or a syntax error (and from the tools whose GNU versions use 2, such as `ls`, `grep` and `diff`), 124 a `timeout`, 126 permission denied, 127 not found, 130 ^C, 141 a broken pipe.
- **Budgets.** Each network request has 8 s and a whole network command 15 s unless its spec says otherwise (weather 25 s, stock 10 s). ^C, Escape, the dock's ^C key and the Stop chip end the running line.
- **Every command** answers `--help` (and `-h` when it has no `-h` of its own); every command that is not a builtin answers `--version`.

## Not supported

The parser refuses these before anything on the line runs, with `<word>: not supported in vesen` and status 2:

- compound commands: `if`, `for`, `while`, `until`, `case`, `select`, `[[ … ]]` and functions;
- groups `{ …; }`, subshells `( … )` and process substitution `<( … )`;
- here-documents (`<<`); use a here-string (`<<<`) or `printf … |`;
- file descriptors other than 0, 1 and 2 (`3: file descriptors other than 0, 1 and 2 are not supported`).

Also missing:

- parameter forms beyond the ones above, such as `${X#pat}`, `${X%pat}`, `${X/a/b}`, `${X:?msg}` and arrays, which fail when expanded (`${X#pat}: not supported in vesen`, status 1);
- positional parameters at the prompt (`set -- a b` says so), and the builtins `shift`, `eval`, `trap`, `local`, `getopts`, `declare` and `readonly`, which are `command not found` (127).

## Deliberate differences from bash

- **No job control.** A line ending in `&` runs in the foreground, after a dim note; `jobs` lists nothing, and `fg`, `bg` and `wait` say so.
- **Parentheses and braces are ordinary characters**, so `echo :)` prints a smiley rather than a syntax error.
- **`[!a]*` is a glob**: a `!` right after `[` is not history expansion.
- **The prompt is fixed** as `user@vesen:path$`, shortened on a narrow screen. `PS1` is set, but changing it does not change the prompt.
- **One identity.** You are `guest` (uid 1000, home `/home/guest`, with `/home/user` as a link to it); `sudo` asks for a password as a joke, never keeps it, puts on a short show (a dancer drawn for vesen and an 8-bit tune of its own, until Esc, ^C, q or Back), and says you are not in the sudoers file.
- **Commands that cannot exist in a tab say so** rather than pretend: `ping` times HTTPS round trips, `dig` uses DNS over HTTPS, `ssh` and `traceroute` explain in one line. `ps` lists the commands of the running line under a shell and init, and `/proc` has a folder for each of them.
- **Regular expressions are guarded.** A pattern a page cannot stop once it starts (`(a+)+`, `(a|aa)*`, long runs of optional parts) is refused, and a line too long for a pattern is skipped with an error, once a file, while the rest is searched, so `grep`, `sed`, `expr` and the rest can never freeze the page.
- **Long loops yield.** `yes`, `seq`, `sed ':a;ba'` and other long runs pause so the page can paint and ^C can arrive; output to the screen is capped so the page stays responsive, drawings (`figlet`, `cowsay`, wide tables) included.
- **Input is capped.** No command holds more than 16 MB of standard input at once: a whole input (`sort`, `md5sum`, `base64`, `diff`), one line, or the lines it keeps back (`tail -n`, `grep -B`). Past it the command says `standard input: input too large (over 16 MB)` and closes the pipe, so what feeds it stops; `seq 1e9 | sort` fails in a moment instead of filling the memory. `$( )` keeps at most 16 MB of output too (`command substitution: output too large`), and `figlet` and `cowsay` draw at most 4096 characters.
- **Full-screen apps** (`less`, `man`, `nano`, `sl`, `cmatrix`, `sudo`'s show) open only at the prompt; in a pipe, a script or `$( )` they print instead. The browser's Back closes the app and stays in vesen (`nano` asks to save any changes first).
