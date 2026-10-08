# Vesen: audit and improvement plan

*Prepared 6 October 2026 against `main` at 23758b9, the build live on www.vesen.app.*

> **Status (8 October 2026):** every phase below is built and ships as v2.0.0. [STATUS.md](STATUS.md) records what landed in each phase with its commits, every deviation from this plan, what still needs the owner, and the remaining follow-ups. The device probe results go in [device-probe-results.md](device-probe-results.md).

This folder holds a full audit of the vesen web terminal and a plan to improve it. The plan covers:

- the user interface and experience;
- the arrangement of the code;
- in-house weather and QR commands, and a reliable stock command;
- real tab completion;
- a phone experience built for visitors arriving from the Instagram bio link;
- a much more complete Linux-style shell.

## The short version

- **Most urgent:** `stock` and `curl` depend on public proxies that are dead or take 10-20 seconds. Nothing ever times out, so a phone visitor can be stuck behind a disabled input with no way to cancel. A half-day hotfix comes first.
- **Unsafe output:** everything a command prints is injected as raw HTML. Typed text, file contents and third-party responses can all run script in the page. A safe renderer closes this in the first week, before the larger rewrite.
- **Phones:** the site was built for a keyboard. The prompt sits under the toolbars and keyboard, pinch zoom is disabled, the keyboard closes after every command, and completion, history and cancel exist only as key shortcuts. The first release fixes this without waiting for the shell rewrite.
- **Architecture:** a strangler migration. A small, DOM-free shell kernel sits in front of today's 26 commands from its first day, so all of them gain quotes, pipes, redirection, variables and exit codes at once. Commands are then moved into one typed spec file each, and help, `man`, Tab completion and phone chips are all generated from those specs.
- **Weather, QR and stock:**
  - Weather moves to Open-Meteo, with a curated place table that keeps Gadigal, Aotearoa and the Palestine names working.
  - QR uses an in-house encoder that already exists and matches the current library module for module in 2,912 comparisons.
  - Stock moves behind a small Cloudflare Worker that vesen owns, on the free plan.
- **Size:** about 54 engineer-days for the core programme (±25%), plus about 10 optional days of extra commands. A first release of about 13 days fixes the Instagram first impression and the safety issues on its own.

## What is broken today

Of 97 distinct findings, 48 were checked by three independent verifiers each: 47 were confirmed and 1 was refuted. Two remain high severity after verification. The full list, with file and line for each, is in [01-audit.md](01-audit.md).

| Problem | Who notices | Fixed in |
|---|---|---|
| `stock` and `curl` hang for 10-20 s on dead public proxies, and phones cannot cancel | Everyone who tries them; phone visitors are stuck | Phase 0 hotfix, then Phase 4 |
| Raw HTML output: `cat main.c` drops `<stdio.h>`, and typed or fetched text can run script | Everyone; a security issue | Phase 1 |
| The page is blank if the browser blocks storage | Some in-app browsers and privacy settings | Phase 1 |
| Prompt under the toolbars and keyboard; no zoom; keyboard closes after each command | Phone and Instagram visitors | Phase 1 |
| Suggestions cannot be tapped; Tab, history and cancel are keyboard-only | Phone and Instagram visitors | Phase 3 |
| The home folder is mis-nested, so `ls -a ~` shows no dotfiles | Anyone exploring | Phase 0 quick fix |
| The prompt always shows `~`; `rm -rf` and `mkdir -p` fail; `echo "a" "b"` prints `a" "b` | Terminal users | Phases 0 and 2 |
| Seven of ten themes fail contrast for suggestions; the light theme is unreadable | Everyone on those themes | Phase 1 |
| Every push to `main` deploys live with no checks, and `npm run check` fails | The owner | Phase 0 |

## Roadmap

Each phase ships on its own, and every step inside it is one pull request with a Firebase preview. Day counts are estimates from the design panels, de-duplicated across workstreams.

| Phase | Days | What lands | Release |
|---|---|---|---|
| **0. Guardrails and hotfix** | ~5 | Review gate and one CI workflow; timeouts and Esc or tap to cancel; a day of quick fixes; toolchain upgrade and test stack; cache and security headers; the shared-contracts PR; the Instagram capability probe on a real iPhone and Android phone | v1.2.1 after the hotfix and quick fixes |
| **1. Safety and first impression** | ~8.5, plus ~6.5 in parallel | Safe output renderer; boot safety, link preview, icons and manifest; 16 px input with pinch zoom restored; app shell sized to the visible viewport; role colour tokens and contrast fixes; the self-hosted font; CRT tiers. In parallel: the QR encoder swap, the weather core, and the stock Worker with its 24-hour spike | **v1.3.0, the minimum release** |
| **2. Shell kernel** | ~7.5 | Lexer, parser, expansion, pipes, redirection, exit codes and ^C for every command; virtual file system with permissions, `/proc`, a prompt that follows `cd`, persistence; core commands ported; help and `man` generated from specs | v1.4.0 |
| **3. Prompt and phone** | ~11 | Completion engine and Tab state machine; desktop block cursor and ghost text; readline keys and reverse search; phone dock with chips and key bar; link cards and the in-app link policy; output that reflows on rotation | v1.5.0 |
| **4. Data commands** | ~11.5 | Weather cards and search; QR card and full-screen Present mode; stock card, table and states; honest `curl` | v1.6.0 |
| **5. Finish the shell** | ~3.5, plus ~10 optional | Remaining ports; deletion of all legacy code and `{@html}`; docs. Then optional command waves: text tools, built-ins, system, DNS and network, fun, pager and `nano` | v2.0.0, then v2.x |

### The minimum release (about 13 days)

If time is short, ship this and stop:

- Phase 0;
- the safe renderer;
- boot safety, head tags and hosting;
- the 16 px input with zoom restored;
- the viewport-sized app shell;
- CRT tiers and contrast fixes;
- the in-house QR engine.

That removes the safety issues and the phone failures behind the Instagram link, and drops the `qrcode` dependency. Nothing in it is thrown away by later phases.

### Ordering rules

1. No renderer, chip, status store, viewport tracker or editor is built before its contract in [02-architecture-and-contracts.md](02-architecture-and-contracts.md) exists. Those are the pieces the six design panels duplicated.
2. Nothing that runs a command from a tap ships before the safe renderer.
3. Phone work that depends on Instagram's behaviour waits for the device probe results.

## Decisions needed from you

Each row has a recommended default, so work can start without an answer. Where a choice is a judgement call, the workstream document lists the options.

| Decision | Recommended default | Needed by |
|---|---|---|
| Analytics: delete the dormant Umami code, or enable it with command names only | Delete | Phase 0 |
| Docker: keep it (switch to nginx or caddy so headers work) or drop it | Drop unless you use it | Phase 0 |
| Hosting: remove the catch-all rewrite, redirect the apex and Firebase domains to `www`, confirm the Instagram bio URL | Yes | Phase 0 |
| Run the device probe from an Instagram DM on your iPhone and an Android phone | Needed; it cannot be emulated | Phase 0 |
| Restore pinch zoom (with a 16 px input so focus does not zoom) | Yes | Phase 1 |
| CRT default: lite on phones and in-app browsers, scanlines on desktop | Yes | Phase 1 |
| Font: ship a Cascadia Code subset renamed "Vesen Mono" with its licence | Yes | Phase 1 |
| Adjust the cockatoo and swamphen colours enough to pass contrast | Yes | Phase 1 |
| Phone text size: 13 px or 14 px | 13 px | Phase 1 |
| Prompt host: `guest@vesen` instead of `guest@www.vesen.app` | `vesen` | Phase 1 |
| Stock proxy: a free Cloudflare account and two GitHub secrets | Yes | Phase 1 |
| Stock data: unofficial Yahoo and Cboe with attribution, or a keyed provider without ASX | Yahoo and Cboe, after a terms review | Phase 1 |
| Persist command history and files under `~` across reloads | Yes, with `history -c` and `reset` | Phase 2 |
| Coreutils silent on success like Linux, with `-v` to confirm | Yes; portfolio commands still confirm | Phase 2 |
| `reset`: keep today's full restore | Yes | Phase 2 |
| Starter chips on a phone, and whether they run in one tap | `help`, `cat README.md`, `fastfetch`, `ls`, `theme ls`, `cathode ls`; one tap runs | Phase 3 |
| `whoami` and `sudo` auto-open a tab on desktop | Keep on desktop; link cards everywhere | Phase 3 |
| Readline keys (Ctrl+A, U, K, D, R, L) on Windows and Linux while the prompt has focus | Yes | Phase 3 |
| Weather: bare `weather` uses approximate IP location; Aotearoa points at Wellington; units follow the browser locale | Yes | Phase 4 |
| QR: theme colours inline, black on white for exports; Present mode on tap only | Yes | Phase 4 |

Each workstream document ends with its own, more detailed questions.

## Documents

| File | Contents |
|---|---|
| [STATUS.md](STATUS.md) | What was built in each phase, the deviations from this plan, what needs the owner, and the follow-ups |
| [device-probe-results.md](device-probe-results.md) | The template for the device probe's results from Instagram on an iPhone and an Android phone |
| [01-audit.md](01-audit.md) | Every finding with corrected severity, verification, fix and phase; live reproductions; measurements; contrast table; branches; font licence |
| [02-architecture-and-contracts.md](02-architecture-and-contracts.md) | Target module layout and the fifteen shared decisions every workstream builds against |
| [03-terminal-input.md](03-terminal-input.md) | Tab completion, ghost text, readline keys, history, the line editor |
| [04-phone-and-instagram.md](04-phone-and-instagram.md) | Viewport, keyboard, dock and chips, the in-app link policy, the device probe and the QA checklist |
| [05-weather.md](05-weather.md) | In-house weather on Open-Meteo with a curated place table and Nominatim fallback |
| [06-qr.md](06-qr.md) | In-house QR encoder, card and Present mode |
| [07-stock-and-proxy.md](07-stock-and-proxy.md) | Owned Cloudflare Worker, stock card and states, honest `curl` |
| [08-shell-and-commands.md](08-shell-and-commands.md) | Shell kernel, virtual file system, portfolio commands and the command catalogue |
| [09-visual-and-accessibility.md](09-visual-and-accessibility.md) | Role tokens, palettes, font, CRT tiers, components, accessibility checklist |
| [10-tooling-hosting-docs.md](10-tooling-hosting-docs.md) | Review gate, hotfix, quick fixes, toolchain, CI, hosting, Docker, analytics, privacy, docs |
| [appendix-b-services-and-instagram.md](appendix-b-services-and-instagram.md) | Every external service probed, and what Instagram's in-app browser allows |
| [designs/](designs/) | The six full reference designs: interfaces, file plans, steps and tests |
| [prototypes/](prototypes/) | Verified QR encoder, shell interpreter, completion engine and weather art |

## How this plan was produced

1. **Inspection and live checks.** The lead read every source file and built the app. The lead also ran `svelte-check` and `npm audit`, reproduced bugs on the live site at desktop and 375 px phone widths, probed each external API for browser access, and computed contrast for every theme.
2. **Audit.** Ten auditors each took one lens: correctness, security, network reliability, desktop experience, phone and Instagram, code arrangement, Linux fidelity, visual design, performance and accessibility, and tooling. They produced 259 raw findings, which were merged into 97.
3. **Verification.** Each of the 48 most severe factual findings went to three verifiers told to refute it: one read the code, one reasoned about runtime behaviour, and one tried to reproduce it. That was 144 verifier runs in total. Ten design judgements were ranked by priority judges. Low and medium findings beyond the cap of 48 are marked "not verified".
4. **Design panels.** Each of six workstreams got three independent designs: a minimal-change pragmatist, a clean-architecture engineer and a product designer. A judge scored them, picked a winner and grafted in the best ideas from the other two.
5. **Critique.** A final critic looked for gaps, conflicts and sequencing problems. The shared contracts and the visual workstream come from that review.

**Limits:**

- Nothing has been tested on a physical phone or inside the Instagram app yet. That is why the device probe is in Phase 0.
- Yahoo's behaviour was checked only from a residential IP address. That is why the stock spike is a gate.
- Effort figures are estimates.
- Dependency versions for the upgrade should be checked on the day.
