# ADR 0001: Architecture and shared contracts

- **Status:** Accepted
- **Date:** 6 October 2026
- **Full text:** [docs/plan/02-architecture-and-contracts.md](../plan/02-architecture-and-contracts.md)

## Context

The overhaul is split into workstreams: shell, terminal input, phone and Instagram, weather, QR, stock, and visual design. Their reference designs each solved one problem well but overlapped. Between them they defined five command specs, two lexers, three completion engines, three phone docks, four HTML escapers, four storage wrappers and five owners for "a command is running". This record makes one decision per overlap, before any workstream writes code against it. Where a reference design in `docs/plan/designs/` disagrees, the full text wins.

## Decision

1. **One command spec.** Each command is one `CommandSpec`, declared with `defineCommand` in `src/commands/<category>/<name>.ts`. It drives execution, flags, help, `man`, Tab completion and the phone chips. Every command can be cancelled, so there are no per-command cancel flags.
2. **One output model.** Commands write SGR text or typed blocks (`lines`, `grid`, `table`, `art`, `panel`, `chips`, `card`, `columns`), never HTML. Rich cards are trusted `component` blocks with a typed view model. Every block has a plain-text form for pipes and files. Legacy HTML goes through a sanitised `legacyHtml` block until the last legacy command is ported.
3. **One lexer.** It never throws. It returns `{ tokens, complete, openQuote, danglingEscape, commentAt }`. The parser and completion both use it.
4. **One job model.** The shell `Session` owns a single job, and each line gets one `AbortController`. Ctrl+C, Escape, the dock's ^C key and the Stop chip all abort it, with status 130. Requests time out after 8 s and whole commands after 15 s, unless the spec says otherwise. Signals are combined by hand, without `AbortSignal.any` or `AbortSignal.timeout`.
5. **One completion engine, one editor, one dock.** Tab goes extend, list, then cycle. The native input stays the editing surface and is never disabled. The phone dock is a sibling of `<main>`.
6. **Tap actions come only from trusted code.** Run, insert, open, copy and share actions are made only by the `out` builders. They are never parsed from HTML, SGR, OSC 8 or `data-*` attributes.
7. **One platform layer.** `platform/` detects the device and the in-app browser and sizes the viewport. `services/opener` opens links inside the user gesture on desktop and prints a link card everywhere. In an in-app browser nothing navigates without a tap.
8. **One storage-key registry.** Keys follow `vesen:<name>:v<n>`, all access is guarded and falls back to memory, and legacy keys are migrated once. Secret input is never stored.
9. **One copy of each shared helper.** Escaping, HTTP (with typed `NetError` kinds and `memo`), storage, the bell and notices each live in exactly one module.
10. **One token namespace.** Palette colours stay as `--theme-*`. A `--role-*` layer names what text is for. Spans carry token names, never hex values.
11. **Help comes only from specs.** `help`, `--help`, `man`, `whatis`, `apropos`, Tab descriptions and starter chips are all generated from `CommandSpec`.
12. **Secret input.** The sudo prompt uses a masked text field that password managers ignore. It is never written to history, snapshots, the kill ring or storage, and its copy says it is a joke.
13. **Security and cache headers.** One CSP and the other security headers are set in `firebase.json`. `index.html` is not cached and hashed assets are immutable. A `404.html` replaces the catch-all rewrite. A stale chunk prints "vesen was updated, reloading…" and triggers one reload.
14. **One test stack.** Vitest runs in node for DOM-free code and in happy-dom for UI code, and Playwright runs end-to-end tests. CI gates every change on svelte-check, strict types, module boundaries, unit tests, the build, a bundle budget, the Playwright smoke test and contrast.
15. **One identity.** The visitor is `guest` (uid 1000, `HOME=/home/guest`, with `/home/user` as a symlink). The prompt host is `vesen` on every domain, and `/home/has` holds the owner's read-only portfolio.

**Module rule.** `shell/`, `output/`, `vfs/`, `lib/` and `commands/` never touch `window`, `document`, `navigator`, browser storage or Svelte. Only `services/` and `platform/` reach browser APIs, and only `app/bootstrap.ts` builds them. `npm run check:boundaries` enforces this, including what those folders import: each other and the service contracts (`services/types.ts`, `services/storage-keys.ts`) only. `tsconfig.strict.json` checks them with no Node types, so Node-only globals and ES2022 calls fail to compile.

## Where the contracts live

| Contract | File |
|---|---|
| `CommandSpec`, context, registry, history, TTY, streams, identity | `src/shell/types.ts` |
| Lexer result and tokens | `src/shell/lexer-types.ts` |
| Spans, blocks, actions, `out` builders, `plain()` | `src/output/model.ts` |
| File system | `src/vfs/types.ts` |
| Net, storage, bell, opener, clipboard, clock, system info, appearance | `src/services/types.ts` |
| Storage keys | `src/services/storage-keys.ts` |
| Stock quote wire format, shared with the `worker/stock` Worker | `src/services/market/contract.ts` |

## Consequences

- Workstreams build against these types and do not redefine them. A change to a contract is a change to this record and to the full text.
- Ports are incremental: a legacy adapter wraps every existing command on day one of the kernel. Each port deletes that command's legacy function and help text, and is compared with the golden snapshots.
- No renderer, chip executor, status store, viewport tracker or editor is built before its contract exists.

## Amendments

Changes to the contracts since the full text was written. Where an amendment and the full text disagree, the amendment wins.

- **`NetError` has a seventh kind, `network`.** Section 9 of the full text lists six kinds: offline, timeout, cors, http, parse and abort. `NetErrorKind` in `src/services/types.ts` adds `network`, a failed same-origin request while the browser reports being online. `cors` stays for failed cross-origin requests, which browsers do not explain further. Every kind-to-message map, such as weather's, stock's and curl's, handles all seven.
- **The stale-chunk reload does not restore the session yet.** Section 13 of the full text reloads and restores the session from the snapshot. Phase 0 prints the notice and reloads once (`src/platform/chunkReload.ts`). The restore arrives with the `vesen:session:v1` snapshot in Phase 3; until then the reload starts a fresh transcript.
- **The CSP is enforced from the first deploy.** Section 13 of the full text ships it as Report-Only for one deploy first. With no reporting endpoint, a Report-Only policy reports only to each visitor's own console, so the trial would collect nothing, and Instagram's in-app browsers cannot be inspected remotely. Instead the end-to-end tests run the app, the device probe and the 404 page under the enforced policy in Chromium and WebKit, and the device probe records every violation in its results, so a probe run from Instagram shows anything the policy blocks there.
- **The market contract is a service contract.** `src/services/market/contract.ts` holds the stock Worker's wire types, `SYMBOL_RE`, the ranges, `normaliseSymbol` and `marketPhaseAt`. It imports nothing and touches no browser API, because the Worker bundles it as it is. DOM-free code may import it like `services/types.ts`, and `check:boundaries` holds it to the DOM-free rules.
