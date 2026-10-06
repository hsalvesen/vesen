# Golden snapshots

These files record what the legacy terminal does today: the exact output of `processCommand` in `src/utils/commands.ts`, plus one rendering of `History.svelte`. They were taken before the overhaul changed any behaviour. Every port is checked against them. They document current behaviour, bugs included, so a golden that looks wrong is still correct until a commit fixes the bug on purpose.

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

- **Variant `360`, `680`, `1000`:** the window width, for output that depends on it. The legacy code turns width into columns as `floor((innerWidth - 40) / 8)`, so these widths give exactly the plan's 40, 80 and 120 columns. (`history` clamps columns to 100, so it lays out its 120-column golden at 100.) The legacy code also treats any width up to 768 px as a phone, so the 680 variant takes its mobile layout where a command has one.
- **Variant `all`:** the output is identical at all three widths, and the test asserts that. If a change makes such a case width-dependent on purpose, mark it `responsive: true`.
- **`rendered-session/<width>.html`:** the markup `History.svelte` renders after boot, `ls`, `cd documents` and `pwd`, one history entry per line. Svelte's comment anchors and scoped `svelte-<hash>` classes are stripped.

## Format

- **`.html`:** for each line typed, a marker line `<!-- $ <line> -->`, then the exact string `processCommand` returned, then one newline. `parseHtmlTranscript` in `format.ts` is the reference parser, and the test checks that every golden round-trips through it.
- **`.txt`:** the same session as a reader sees it: `$ <line>`, then the output as plain text (`<br>` and block elements become newlines, trailing spaces trimmed). `[bell]` marks a line that rang the terminal bell.

## What keeps them deterministic

- Each session is a fresh page load. Storage is emptied, `vi.resetModules()` runs, and the legacy modules are imported again, because the file system and current path are module singletons.
- Lines run the way `Input.svelte`'s Enter handler runs them. Every command gets an abort signal, and the history stores are updated, so `history` sees earlier lines.
- The clock is frozen at 2026-10-06 09:00 Sydney time, `Math.random()` returns 0.5, `__APP_VERSION__` reads `0.0.0-golden`, numbers format as `en-US`, and the page URL is `https://www.vesen.app/`.
- The browser is a fixed device from `tests/support/devices.ts`. Chrome on a Mac is the default, and one `fastfetch` case uses Instagram's in-app browser on an iPhone.
- `fetch` is answered by `tests/support/net.ts`. Same-origin paths come from `public/`, and network calls come from `tests/fixtures/net/`. Any request without a fixture fails the test.
