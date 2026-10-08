# Adding a command

A vesen command is one `CommandSpec` in one file. The spec drives everything the visitor sees of
the command: running it, its options, `--help`, `help`, `man`, `whatis`, `apropos`, Tab completion,
the phone's chips, its `/usr/bin` stub and its man page. Nothing about a command is written
anywhere else. The contracts are in `src/shell/types.ts`; the decisions behind them are in
[docs/adr/0001-architecture.md](adr/0001-architecture.md).

## Core or catalogue

Commands live in one of two places, and the choice decides when their code reaches the visitor.

| | Core | Catalogue |
|---|---|---|
| Folder | `src/commands/<category>/<name>.ts` | `src/commands/more/<category>/<name>.ts` |
| Loads | with the kernel, before the first line runs | in one `catalogue-*.js` chunk, once the page is idle or as soon as a name the kernel lacks is typed |
| Budget (`npm run check:bundle`) | the kernel's 75 kB gzip, almost spent | the catalogue's 40 kB gzip |
| Categories | portfolio, files, text, shell, system, network | text, files, shell, system, network, fun, editor |

**New commands go in the catalogue.** Every spec in the core adds to the kernel, which every line
waits for. A catalogue spec adds nothing to it: `src/commands/index.ts` reaches the catalogue only
through `loadCatalogue()`, an `import()` of `src/commands/more/catalogue.ts`, which gathers the
specs under `more/` with `import.meta.glob`. A new file there is picked up with no other change.

The core is for the few commands that cannot wait for the catalogue:

- the portfolio commands and the starter chips, which a visitor taps in the first second;
- the builtins a login uses (`cd`, `export`, `alias`, `source`), and `help`, `man` and the other
  commands that look commands up; builtins that are only typed, such as `read`, `time` and
  `kill`, are in the catalogue's `shell` folder, marked `builtin` as the core's are;
- a command with `opens()`, which opens a URL inside the Enter or tap gesture: that check runs
  before the line starts, so it sees only commands already registered.

What the visitor sees does not depend on the folder. Until the catalogue arrives:

- a line whose command is not registered waits for it (up to 8 s, and ^C stops the wait), so a
  catalogue command runs as if it were always there, and `command not found` (127) comes only once
  the catalogue has settled without the name;
- `help`, `help --all`, `man`, `whatis`, `apropos`, `which`, `type`, `command -v` and `privacy`
  wait for it too, through `allCommands(ctx)` in `src/commands/lib/catalogue.ts`; a command that
  lists or looks up commands by name should do the same;
- a first Tab on a command name waits up to 300 ms, then shows what it has; the list, the ghost
  and the chips fill in when the rest arrives. With nothing to show yet, it waits on as long as a
  line would (8 s, or until the line changes) rather than ring the bell;
- the catalogue's `/usr/bin` stubs and man pages are added to the file system when it arrives.

If the catalogue cannot be loaded, the first lookup that misses it says so once, and the next
command tries again. `npm run check:boundaries` fails if anything outside `src/commands/more`
imports from it, other than that one `import()`, because a static import would pull it into the
kernel.

## The spec

Copy a command close to the one you are writing. `src/commands/more/text/rev.ts` is the smallest
complete example: a spec, its body in `rev.run.ts` and its tests in `rev.test.ts`.

```ts
// rev: reverse the characters of each line.

import { defineCommand } from '../../../shell/types';

export default defineCommand({
  name: 'rev',
  category: 'text',
  summary: 'reverse the characters of each line',
  synopsis: ['rev [FILE]...'],
  args: [{ name: 'FILE', source: { kind: 'path', accept: 'file' }, optional: true, variadic: true }],
  examples: [
    { line: 'echo hello | rev', note: 'olleh', offline: true },
    { line: 'rev .bashrc', note: 'a file, each line backwards', offline: true },
  ],
  seeAlso: ['cat', 'echo'],
  load: () => import('./rev.run'),
});
```

The file's default export is the spec, made with `defineCommand`, which insists on exactly one of
`run` and `load`. The fields:

| Field | What it is for |
|---|---|
| `name`, `aliases` | What the visitor types. A clash with another command's name or alias throws. |
| `category` | Where `help` lists it. |
| `summary` | One line, 50 characters at most, lower case, no full stop: `help`, `whatis`, Tab and the chips show it. |
| `synopsis` | The usage lines, such as `rev [FILE]...`; generated from the flags and arguments when left out. |
| `flags` | Each with `short` and/or `long`, a `description`, and `value` when it takes one. `-la`, `-n5`, `--lines=5` and `--` are parsed for you, and the values arrive in `ctx.opts`. |
| `args` | The operands, with a `source` that completion reads: `path`, `command`, `enum`, `examples`, `free` and others. Only the last may be `variadic`. `marks` names the characters that start an argument's words wherever they stand, as `+` and `@` start dig's `+short` and `@google`, so completion never takes them for another operand. |
| `subcommands` | `theme ls`, `theme set`: each with its own summary, flags and arguments. |
| `examples` | Lines that show the command at work; see below. |
| `seeAlso` | Related commands, for `man`. |
| `helpRank` | Its place in its category's row of the short `help` index, lowest first. A row keeps to one line on a phone and two elsewhere, then says how many more there are, so in a long category rank the few a visitor reaches for first; the rest follow by name. |
| `hidden` | Left out of `help`, Tab and the chips; it still runs when typed. |
| `featured` | Kept in `help`'s short index, after the ranked commands, when its category's row is too long to name everything; the kernel's commands come next and the catalogue's last, and the rest are counted in `+N more` (`help --all` lists them all). |
| `builtin` | Changes the session (`cd`, `export`): runs in the shell itself, and a usage error exits 2. |
| `network` | Fails fast offline, and gets a 15 s budget for the whole command (`budgetMs` to change it) on top of the 8 s per request. |
| `loadingLabel` | The status line while it runs, such as `fetching forecast for Oslo`. |
| `dataCost` | Asks before spending that much data on a phone, on mobile data or with Data Saver on. |
| `interactiveOnly` | Runs only at the prompt, never from a pipe, `$( )`, a script or `~/.bashrc`. |
| `next` | Follow-up chips after a run. Every word taken from data must pass `PLAIN_ARG`. |
| `opens` | A URL to open inside the Enter gesture. Core commands only (see above). |
| `usageStatus`, `posixArgs`, `numericShortcut`, `handlesHelp`, `assignmentArgs` | For commands that need Linux's exact behaviour: `ls` exits 2 on a usage error, `head -5`, `echo` reading its own options. |

`-h` and `--help` print the help generated from the spec, unless the spec defines an `h` flag of
its own (as `ls -h` and `tree -h` do); `--help` still works then. `--version` prints
`NAME (vesen) VERSION` for every command that is not a `builtin` and does not set `handlesHelp`,
so a spec never needs a flag for it.

## The body and its `doc`

Put the body in `<name>.run.ts` and load it with `load: () => import('./<name>.run')`, so only the
spec is in the catalogue's chunk (or the kernel's) and the body comes with the first run. The body
exports `run`, and the long help as `doc`:

```ts
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';

/** What --help, help and man say about rev, besides its spec (rev.ts). */
export const doc: CommandDoc = {
  description: 'Copies each FILE to standard output with the characters of every line in reverse order. ...',
  man: [{ heading: 'EXIT STATUS', body: '0 when every FILE was read, 1 when any could not be: rev carries on with the rest.' }],
};

export async function run(ctx: CommandContext): Promise<ExitCode> {
  // ...
}
```

`description` and `man` belong in `doc`, never in the spec as well: `--help`, `help NAME` and
`man` fetch the body to read them, and the summary stands in if it cannot be loaded. Summaries,
synopses, flags, examples and see-also stay in the spec, because completion, the chips, `whatis`
and `apropos` read them without loading anything.

A tiny command may keep `run` in the spec instead, with its `description` there too.

Inside `run`:

- write with `ctx.stdout.write(text)` or `ctx.stdout.line(...)`, and rich output with
  `ctx.stdout.block(out.table(...))` and the other `out` builders in `src/output/model.ts`;
  every block has a plain form for pipes. Never write HTML;
- read standard input with `ctx.stdin.chunks()` or `ctx.stdin.lines()` as it arrives, so
  `yes | rev | head -n 2` ends at once. No command holds more than `MAX_INPUT` (16 MB, in
  `src/shell/types.ts`) of it at once: `ctx.stdin.text()` and a line from `lines()` close the
  input and throw `InputTooLarge` past it, and what a command keeps back itself (a line, the
  last lines) must be held to it too, through the helpers in `src/commands/lib/text-input.ts`;
- reach files through `ctx.fs` and `ctx.resolve(path)`, and say what went wrong with the helpers in
  `src/commands/lib/files.ts`: `ctx.fail('cannot open nope: No such file or directory')` prints
  `rev: cannot open nope: No such file or directory` and returns 1;
- report bad options or operands with `ctx.usage(message)`, which adds the `Try 'rev --help'` line
  and returns the right status;
- take over the screen, as `less` and `nano` do, with `ctx.tty.fullscreen(view, props)`: the app
  (a Svelte component in `src/ui/apps`, registered in `src/ui/apps/registry.ts`, with its view
  model in a DOM-free module such as `src/lib/pager.ts`) shows until it closes and hands back its
  result. It rejects in a script, `$( )` or anywhere else not at the prompt, and an app whose chunk
  did not load closes with no result, so always have a fallback: `less` and `man` print the text
  (`src/commands/lib/pager.ts`). The last stage of a pipeline typed at the prompt may show one
  (`man ls | less`), when its output is the terminal. AppHost gives every app a history entry, so
  Back (Android's button, iOS's edge swipe) closes the app rather than leaving vesen: the app
  exports a `back()` function that closes it the way it closes itself, so the command gets its
  usual result (nano asks to save first). Without one, Back closes it with no result;
- write a table whose columns are padded with spaces (`column -t`, `free`, `ps`) through
  `writeTable(ctx, text)` in `src/commands/lib/table-out.ts`: on a screen narrower than the table
  it becomes a block that scrolls sideways, so rows never wrap under the wrong headings;
- colour text with roles (`fg: 'muted'`, `'error'`, `'accent'`, `'rainbow-red'`…) rather than raw
  palette slots where it must be readable: `npm run check:contrast` holds every text role to
  4.5:1 in every theme, and a palette slot only to its baseline;
- return the exit status, or nothing for 0.

## House rules

- **Linux behaviour.** Use Linux's wording and exit codes. Coreutils are silent when they work,
  with `-v` to say what they did.
- **DOM-free.** `src/commands` never touches `window`, `document`, `navigator`, browser storage or
  Svelte; services reach the browser for it (`ctx.net`, `ctx.sys`, `ctx.clock`, `ctx.tty`, and
  `ctx.digest` for WebCrypto's hashes).
  `npm run check:boundaries` enforces it. Avoid `AbortSignal.any` and `AbortSignal.timeout`,
  `Array.prototype.at`, `Object.hasOwn`, `Object.groupBy` and `Promise.withResolvers`: Instagram's
  browser on older iPhones lacks them.
- **Regular expressions from the visitor** (grep, sed, expr, nl -bp, pgrep and the like)
  go through the one shared guard, `src/commands/lib/regex.ts`, never straight into `new RegExp`.
  A JavaScript regular expression cannot be interrupted, so one bad pattern would freeze the page.
  `compilePatterns(patterns, { syntax })` translates basic or extended regular expressions (or takes fixed
  strings, or JavaScript's own for `grep -P`) and calls `guardRegex`, which caps the pattern at
  8192 characters, refuses what could run for ever (a repeated group with a repetition inside it,
  such as `(a+)+`, or a repeated choice whose branches overlap, such as `(a|aa)*`), and sets the
  longest line the pattern may be run against from how many open-ended repetitions it has, never
  more than a million characters. Call `check(line)` on the result before each match: it throws
  `SubjectTooLong`, which the command reports and moves on from. `patternMessage(error)` gives
  the words for any of the guard's refusals.
- **Text tools share their input handling.** `src/commands/lib/text-input.ts` has the FILE operands
  (none, or `-`, is standard input), standard input a line at a time as it arrives (so
  `yes | tool | head` ends at once), a last line without a newline kept that way, UTF-8 byte
  counts, coreutils' size suffixes (`2K`) and `pacer(ctx)`, which lets the page paint and ^C
  arrive during a long loop. It holds standard input to `MAX_INPUT` (16 MB) wherever a tool
  keeps it: `readOperand` reads a whole operand and says `NAME: standard input: input too large
  (over 16 MB)` past it, `inputRecords` and `splitChunks` give lines (or `-d` records) of any
  length up to it, `HeldRecords` keeps lines back (`tail -n`, `grep -B`) within it, and
  `readAtMost` reads a small input (figlet's message) and stops as soon as it is too long. Each
  closes the input when it gives up, so the command writing it stops with a broken pipe.
- **Options that size what is made are bounded.** A width or count that a command would turn
  into that many characters or entries (`nl -w`, `figlet -w`, `tr`'s `[c*N]`, `head -c -N`)
  is refused past a stated limit, in GNU's words where GNU has one ("Numerical result out of
  range"), or made not to matter (`tr` stops a repeat where nothing reads it, `printf` writes
  as it goes). Say the limit in the command's man page.
- **Wildcards are not regular expressions.** A shell pattern (`find -name`, `tree -I`) is matched
  with `fnmatch` in `src/commands/lib/fnmatch.ts`, which never backtracks past the last star and so
  needs no guard.
- **Options that are not getopt's.** A command whose words may start with a dash without being
  options (`chmod -w file`, `find . -name x`) sets `rawArgs` on its spec and reads its own words;
  `readOptions` in `src/commands/lib/raw-options.ts` reads the options among them as getopt would,
  with getopt's error messages.
- **Original content.** Cows, fortunes, fonts and art are written for vesen, not copied, and
  credit no other project.
- **Honest network commands.** A browser cannot send ICMP or raw DNS: say what is done instead
  (DNS over HTTPS, an HTTPS round trip for `ping`), in the output itself.
- **No new dependencies.**

## Examples are tests

Every example marked `offline: true` is run by `src/commands/examples.test.ts`, on the terminal
and into a pipe, on a fresh file system, and must exit 0. The same examples are what `help` and
`man` show; one with a `starter` rank is also a chip on an empty phone prompt, which is for core
commands. Examples that need the network leave `offline` out.

An argument whose source is `examples` completes to the operand at its place in each example (and
in history), read as getopt would: `ping -c 10 -i 0.5 example.com` offers `example.com`, never
`10`. An example's `note` goes with that value only when the example is the command and its
operands alone, so write the plainest example of an operand first.

Every spec must have at least one offline example, and `src/commands/shell/help-man.test.ts`
checks that `--help` and `man` render for every spec, the catalogue's included.
`src/commands/index.test.ts` checks that the catalogue registers beside the core with no clash,
and lists the catalogue's commands: add yours to that list.

## Tests

Put `<name>.test.ts` beside the command. `tests/harness.ts` runs lines in the app's own shell over
a fresh file system with a frozen clock:

```ts
import { runLine, session } from '../../../../tests/harness';

expect(await runLine('echo hello | rev')).toMatchObject({ status: 0, stdoutPlain: 'olleh' });
expect((await runLine('rev nope', { tty: false })).stderrPlain).toBe('rev: cannot open nope: No such file or directory');
```

`runLine` gives each line a fresh session; `session()` keeps one for several lines. `tty: false`
runs the line into a pipe, as `line | cat` would see it, and `cols` sets the width. The catalogue
is loaded before the first line unless you pass `catalogue: 'lazy'`.

`runLine` has no screen for full-screen apps: `ctx.tty.fullscreen` fails, as on a terminal without
them, unless the test passes `fullscreen`, which stands in for the app and returns its result
(`src/commands/more/editor/nano.test.ts`).

Tests never touch the network: record the responses once under `tests/fixtures/` and serve them
through a fake `fetch`, as `src/commands/network/weather.test.ts` does, with the timeout,
offline, rate-limit and malformed variants. `serveNet` in `tests/support/net.ts` serves the
DNS-over-HTTPS, RDAP, GitHub and Cloudflare fixtures in `tests/fixtures/net/` that the network
commands in `src/commands/more/network/` use, and lets a test answer some requests itself.

## The gates

Run them all before you commit; CI runs the same:

```bash
npm run check              # svelte-check, 0 errors
npm run check:strict       # the strict TypeScript settings
npm run check:boundaries   # DOM-free folders, no {@html}, the catalogue kept out of the kernel
npm test                   # Vitest, offline examples included
npm run build
npm run check:bundle       # initial JS 60 kB, kernel 75 kB in at most 4 files, catalogue 40 kB (gzip)
npm run check:contrast -- --strict
npm run test:smoke         # Playwright: desktop Chrome, iPhone in Instagram, Pixel 7
```

If `check:bundle` says the catalogue is over budget, move what a spec imports into its body. If it
says the kernel grew, a core file is importing something it should not. If it says the kernel
comes in too many files, a module the kernel shares with a later chunk has been split out:
`scripts/kernel-chunk.ts` decides what goes in the kernel's chunk.
