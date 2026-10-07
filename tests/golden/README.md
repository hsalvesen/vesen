# Golden snapshots (retired)

This folder held the golden snapshots of the legacy terminal: the output of each line typed at the prompt, recorded before the overhaul changed any behaviour, then kept in step with each command as it was ported to a spec, plus one rendering of the transcript. With the legacy adapter, the sanitising HTML shim and the `src/utils` shim they were checked through, they were deleted once the last command was ported.

The reference lives in git history, in the commit before the one that deleted it (`5547828`, "Phase 4 review fixes"):

```sh
git show 5547828:tests/golden/README.md
git show 5547828:tests/golden/__snapshots__/legacy/ls/all.html
```

The output of the pre-overhaul legacy commands, as first recorded, is at commit `afed6a8`.

What replaces them:

- `tests/transcripts`: each command's transcript at 40, 80 and 120 columns, on the terminal and into a pipe.
- Each command's own tests beside it in `src/commands`, over recorded fixtures for the network commands (`tests/fixtures`).
- `tests/security/xss-pipeline.test.ts`: the XSS corpus typed through the shell and drawn by the real transcript.
- The colours of the owner's documents, recorded from their original HTML in `tests/fixtures/content/legacy-colours.json` and checked by `src/output/markup.test.ts`.
