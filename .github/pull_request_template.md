## Summary

<!-- What changes, and why. Link the issue it closes (Closes #123). -->

## Testing

<!-- What you ran and what you checked by hand. CI runs the gates again. -->

- [ ] `npm run check`, `npm run check:strict` and `npm run check:boundaries`
- [ ] `npm test`
- [ ] `npm run build`, then `npm run check:bundle`
- [ ] `npm run check:contrast -- --strict`
- [ ] `npm run test:smoke` (and `npm run test:e2e` if the prompt, dock, viewport, links or a full-screen app changed)
- [ ] Docs updated where behaviour changed: `docs/SHELL.md`, `docs/ADDING_COMMANDS.md`, ADR 0001 for a contract, `CHANGELOG.md` under Unreleased

## Phone checklist

<!-- On the preview channel CI comments below, from an Instagram DM to yourself if you can.
     Say which devices you used, and tick what you checked; write "n/a" for what this change cannot affect. -->

Devices:

- [ ] No white flash. The banner fits at 320, 375 and 414 px, and the page never scrolls sideways.
- [ ] Tapping the prompt does not zoom, and pinch zoom works.
- [ ] The keyboard stays open across three commands, and the prompt stays above it.
- [ ] Chips run and insert without closing the keyboard, and the Stop chip cancels a slow command.
- [ ] Rotation reflows `help`, `ls` and `fastfetch` without running them again.
- [ ] `whoami`, `email` and `repo` show cards; tapping a link and pressing Back restores the terminal.
- [ ] `qr vesen.app` opens Present mode on a tap, and the image can be saved or screenshotted.
- [ ] Reduced motion stops the CRT animation and the cursor blink.
