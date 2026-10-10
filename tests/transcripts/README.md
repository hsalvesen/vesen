# Command transcripts

One file per ported command, written by `transcripts.test.ts`. Each runs one session of lines, typed in order in a fresh shell (`tests/harness.ts`): the seed file system, the spec files plus the kernel's stand-ins for commands not yet ported, no storage, and a clock frozen at 2026-10-06 09:00 UTC in `Australia/Sydney` that moves on a minute per line.

Every session runs six times: with stdout on the terminal and into a pipe, at 40, 80 and 120 columns. Where the six outputs of a line agree they are written once; where they differ, each output sits under the variants it belongs to, such as `[terminal at 40 columns]` or `[pipe]`.

## Format

- `$ <line>` is the line typed.
- The rows after it are what reached the screen, or the pipe: stderr rows start with `! `.
  - On the terminal, a grid (ls) is laid out as CSS lays it out at that width, in columns of its widest name plus two; the titled lists of the help index are packed left to right, each as wide as its longest name with two cells between, and start a new band, after a blank row, where the next would not fit; panels show their title in brackets.
  - In a pipe, stdout and stderr are interleaved in the order they were written.
- `? N` is the exit status.
- Control characters are written in caret notation (`^[` is ESC) and trailing spaces are trimmed.

## Changing a transcript

A diff is either a regression or an intentional change, as with the goldens in `tests/golden`. For an intentional change, update the transcripts in the same commit and say why in the commit message:

```sh
npx vitest run tests/transcripts -u
```

Read every changed file in `git diff tests/transcripts` before committing. On CI (`CI=true`) a missing transcript fails instead of being written.
