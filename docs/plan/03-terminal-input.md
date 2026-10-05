# Terminal input and tab completion

**Goal:** a prompt that feels like bash or zsh on a laptop and is fully usable by thumb on a phone.

**Reference design:** [designs/terminal-input.md](designs/terminal-input.md). The shared decisions in [02-architecture-and-contracts.md](02-architecture-and-contracts.md) override it where they differ.

## What is wrong today

- Tab completion is a 230-line chain of per-command branches in `Input.svelte:381-613`. It copies the common-prefix loop eight times, cannot complete `~/` or `../`, skips `ls`, `mkdir` and `echo`, completes a `nano` command that does not exist, and does nothing visible when several matches exist (F022).
- A second, different vocabulary lives in `src/utils/commandSuggestions.ts`. It suggests `rm -f`, which `rm` does not support (F017).
- The suggestion row is plain text rendered with `{@html}`. It cannot be tapped and is not announced to screen readers (F067).
- Only Ctrl+C and Ctrl+L are handled. On Windows and Linux, Ctrl+R reloads the page and wipes the session, and Ctrl+C cannot copy selected text (F014, F046).
- The input is disabled while a command runs, which drops keystrokes and closes the iOS keyboard (F012).
- Up arrow throws away the line being typed (F069).

## What visitors get

**On a laptop**

- A blinking block cursor in the theme's cursor colour. Grey ghost text offers the rest of the newest matching history entry, or else the top completion. Right or End accepts it.
- Tab completes commands, subcommands, flags (with descriptions), theme and CRT names, and paths through `~`, `..` and nested folders. It also completes after `|`, `&&`, `;`, `>` and `sudo`. The sequence is extend, then list, then cycle, as defined in the contracts.
- Readline keys work while the prompt has focus:

  | Keys | Action |
  |---|---|
  | Ctrl+A / Ctrl+E | Start or end of line |
  | Ctrl+U / Ctrl+K | Kill to start or end of line |
  | Ctrl+W | Kill previous word (Mac only; Alt+Backspace everywhere) |
  | Ctrl+Y | Yank |
  | Alt+B / Alt+F | Back or forward one word |
  | Alt+. | Insert the last argument of the previous command |
  | Ctrl+R | Reverse search through history |
  | Ctrl+L | Clear the screen and keep the current line |

- Up and Down search history by what has been typed and keep the draft. `help keys` lists every binding.
- Ctrl+C copies when text is selected. Otherwise it prints `^C` and gives a fresh prompt, or interrupts a running command.

**On a phone**

- A 16 px input that does not zoom, drawn at terminal size.
- A dock above the keyboard with chips (completions, did-you-mean, starter commands) and a key bar.
- Tapping a chip inserts exactly what Tab would and keeps the keyboard open. A folder chip shows its contents next, so a whole path can be built by tapping.

## Decisions that change the reference design

| Topic | Reference design | This plan |
|---|---|---|
| Lexer | Its own tolerant lexer | The single shared lexer from the contracts, owned by the shell workstream |
| Spec | Its own `CommandSpec` in `src/shell/spec.ts` | The merged `CommandSpec` from the contracts |
| Phone dock | `PromptDock` with Tab, Up, chips and Run | The phone workstream's Dock and KeyBar; this workstream supplies the chips |
| Touch editor | A mirror over a transparent input | Desktop keeps the mirror. Touch uses the visible scaled native input until the device probe shows the mirror is safe |
| History persistence | Only if approved | Same; the owner decides once for the whole plan |
| Window click focus | Mouse clicks refocus | Same, plus the phone rule that taps on output never open the keyboard |

## Work sequence

| Step | Phase | Days | Delivers | Resolves |
|---|---|---|---|---|
| Golden parity tests for today's Tab and suggestion behaviour | 0 | 0.5 | Recorded expectations, with intended differences marked | |
| Completion engine on the shared lexer and registry | 3 | 1.5 | `complete()`, `accept()`, path, flag, enum and example sources; case-insensitive fallback; never throws | F022, F017 |
| Tab state machine, ghost text and chip model | 3 | 1 | `pressTab()`, `ghostFor()`, `chipsFor()`, and the 100-candidate prompt | F022 |
| Desktop completion row and chips | 3 | 0.5 | `<button role=option>` chips with swatches, replacing `CommandSuggestionsRow.svelte` and `commandSuggestions.ts` | F067 |
| Controller and line editor | 3 | 2 | Mirror and block cursor on desktop, scaled native input on touch, input never disabled, type-ahead, immediate interrupt, focus policy | F012, F014, F011 |
| Readline, keymap and history store | 3 | 1 | `BINDINGS` table, reverse search, kill ring, draft-preserving history, `help keys` | F046, F069 |
| End-to-end tests and device pass | 3 | 0.5 | Playwright cases for Tab, double Tab and chips at 375 px; Instagram on iOS and Android | |

About 6.5 days in Phase 3, after the kernel in Phase 2 provides the lexer and registry, plus half a day of parity tests in Phase 0.

## Acceptance checks

- `cat doc<Tab>li<Tab>` produces `cat documents/linux.txt `. `cd ../../e<Tab>` produces `cd ../../etc/`. `theme set k<Tab><Tab>` lists kangaroo and kookaburra.
- `rm -<Tab>` offers only flags that `rm` implements.
- The completion prototype in [prototypes/completion/](prototypes/completion/) already produces these results.
- On a phone, tapping a chip leaves `document.activeElement` on the input and never closes the keyboard.
- After Enter on a phone, the keyboard is still open across three commands.
- With text selected, Ctrl+C copies on Windows and Linux.
- Ctrl+R never reloads the page while the prompt has focus.
- Esc then Tab within one second moves focus out of the terminal, so the page has no keyboard trap (F095).

## Questions for the owner

- Should command history persist across reloads (500 lines, `history -c` to clear)? Ghost text is much more useful if it does.
- On Windows and Linux, may Ctrl+A, U, K, D, R and L act as readline keys while the prompt has focus? The alternative is binding them only on macOS.
- Desktop chips: show them always while typing, as today's suggestion row does, or only after Tab, which is more like a real terminal?
- Long commands: keep horizontal scrolling inside the prompt (lower risk), or spend about 1.5 more days on a prompt that wraps under itself?
