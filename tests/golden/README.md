# Golden snapshots

These files record what the legacy terminal does: the output of each line typed at the prompt, plus one rendering of the transcript (`src/ui/Transcript.svelte`). They were first taken before the overhaul changed any behaviour, and every port is checked against them. They document current behaviour, bugs included, so a golden that looks wrong is still correct until a commit fixes the bug on purpose.

Lines run through the shell kernel (`src/shell`), as `Input.svelte` runs them, and the legacy commands through the legacy adapter (`src/commands/legacy.ts`). A legacy command's output is its HTML exactly as the adapter hands it to the screen, so these goldens prove the adapter renders every legacy command as before.

## Ported commands

A command ported to a spec in `src/commands` keeps its cases here, recording what the port prints: `cat`, `echo`, `history`, `ls`, `mkdir`, `rm` and `touch` (step 2.3a), and `banner`, `help`, `theme` and `cathode` (step 2.3b). Their own, fuller transcripts, at 40, 80 and 120 columns on the terminal and into a pipe, are in `tests/transcripts`. The legacy output these cases first recorded remains in git history at commit `afed6a8`, for comparison:

```sh
git show afed6a8:tests/golden/__snapshots__/legacy/ls/680.html
```

## Changing a golden

A golden diff is either a regression or an intentional change. Nothing else.

- **Intentional change:** update the affected goldens in the same commit as the code. The commit message names the goldens that changed and gives the reason, for example "ls -a: dotfiles now listed, because the home folder is re-homed (F003)".
- **Unexpected diff:** treat it as a regression and fix the code. Never refresh goldens to make an unrelated failure go away.

To refresh after an intentional change, run the following, then read every changed file in `git diff tests/golden` before committing:

```sh
npx vitest run tests/golden -u
```

On CI (`CI=true`) a missing golden fails instead of being written.

## Layout

`__snapshots__/legacy/<case>/<variant>.html` and `.txt`, where `<case>` is a slug from `CASES` in `legacy.test.ts`.

- **Variant `360`, `680`, `1000`:** the window width, for output that depends on it. The legacy code turns width into columns as `floor((innerWidth - 40) / 8)`, so these widths give exactly the plan's 40, 80 and 120 columns. No command case depends on the width any more: the ported `ls` and `help` draw grids that the page lays out (recorded once: `ls`'s items two spaces apart on one line, `help`'s names one per line with their summaries), and `history` lines wrap with CSS, as weather, stock, curl and fastfetch do. Only `rendered-session` is recorded per width, because the boot banner is compact below 50 columns.
- **Variant `all`:** the output is identical at all three widths, and the test asserts that. If a change makes such a case width-dependent on purpose, mark it `responsive: true`.
- **`rendered-session/<width>.html`:** the markup `Transcript.svelte` renders after boot, `ls`, `cd documents` and `pwd`, one entry per line, each with the prompt it was typed at, once the layout renderer (`RichBlock.svelte`, loaded on first use) has drawn `ls`'s grid. Svelte's comment anchors and scoped `svelte-<hash>` classes are stripped.

## Format

- **`.html`:** for each line typed, a marker line `<!-- $ <line> -->`, then the output, then one newline. A legacy command's output is its exact HTML. Output the shell and the ported commands write, such as `command not found` or `ls`, is written as the equivalent styled spans by `blocksToGoldenHtml` in `format.ts`: a grid's items two spaces apart (with notes, one item and its note per line), art as its hidden text and the alternative, `theme ls`'s swatches in their own hex; tap actions have no HTML form and are left out, and a live marker is recorded as it read when it was written. `parseHtmlTranscript` in `format.ts` is the reference parser, and the test checks that every golden round-trips through it.
- **`.txt`:** the same session as a reader sees it: `$ <line>`, then the output as plain text (`<br>` and block elements become newlines, trailing spaces trimmed). `[bell]` marks a line that rang the terminal bell.

## What keeps them deterministic

- Each session is a fresh page load. Storage is emptied, `vi.resetModules()` runs, and the legacy modules are imported again, because the legacy shim over the VFS and the transcript are module singletons. `~/.bashrc` is sourced, as at boot.
- Lines run the way `Input.svelte`'s Enter handler runs them: through `shell.run`, which records each line in the shell's history before it runs, so `history` sees earlier lines and itself, as in bash.
- The clock is frozen at 2026-10-06 09:00 Sydney time, `Math.random()` returns 0.5, `__APP_VERSION__` reads `0.0.0-golden`, numbers format as `en-US`, and the page URL is `https://www.vesen.app/`.
- The browser is a fixed device from `tests/support/devices.ts`. Chrome on a Mac is the default, and one `fastfetch` case uses Instagram's in-app browser on an iPhone.
- `fetch` is answered by `tests/support/net.ts`. Same-origin paths come from `public/`, and network calls come from `tests/fixtures/net/`. Any request without a fixture fails the test.
