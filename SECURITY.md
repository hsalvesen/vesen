# Security

## Reporting a problem

Please report a vulnerability privately, not in a public issue or pull request:

- through GitHub's private vulnerability reporting, under **Security → Report a vulnerability** on the repository, or
- by email to has@salvesen.app, with "vesen security" in the subject.

Say what you found, how to reproduce it (the line typed, the browser and device, and whether it was inside an in-app browser such as Instagram's), and what an attacker could do with it. You should hear back within a week. Please give a fix time to reach www.vesen.app before you talk about it publicly; you will be credited in the changelog if you would like to be.

Only the latest release, deployed at www.vesen.app, is supported.

## In scope

- **www.vesen.app and its Firebase preview channels**: anything that runs script in the page or plants a link or tap action a visitor did not ask for, whether from typed text, a file, a pasted line, a URL, or a response from a third-party service (weather, stock, DNS, RDAP, GitHub, anything `curl` or `wget` fetches).
- **Data the page keeps**: anything that leaks or keeps what it should not, such as the joke `sudo` password reaching history, storage, the session snapshot or the kill ring, or a device's location being stored.
- **Freezing the page** with a single line: a regular expression, loop or allocation that the shell's guards and budgets fail to stop.
- **The stock Worker** (`worker/stock`): answering origins other than vesen's, passing through anything but a validated quote, or being usable as an open proxy.
- **Hosting**: the Content-Security-Policy and headers in `firebase.json`, and the CI workflows' use of secrets.

## Out of scope

- What a visitor does to their own session: `rm -rf ~`, filling the 512 KB file quota, or running a slow command (each is undone by `reset`, a reload, or ^C).
- The `sudo` prompt itself: it is a joke, says so, and never runs anything with more rights.
- Denial of service against the third-party services, rate limits, or reports from automated scanners without a working case.
- Social engineering, and anything that needs a compromised device or browser.

## How the page is protected

**No HTML output.** Commands never produce HTML. They write text, with a small SGR subset for style, or typed blocks (`lines`, `grid`, `table`, `art`, `panel`, `chips`, `card`, `columns`, and `component` for the trusted rich cards). `src/ui/OutputView.svelte` draws every block with Svelte's text interpolation, so text is never parsed as markup, and `npm run check:boundaries` fails the build if `{@html` appears anywhere. The SGR reader (`src/output/sgr.ts`) keeps colours and styles and drops every other escape sequence and control character.

**Actions only from trusted code.** A chip or tappable span that runs, inserts, opens, copies or shares is made only by the `out` builders in `src/output/model.ts`, called by command code. Nothing turns text, an SGR or OSC 8 escape, or an attribute into an action, so output from `cat`, `curl` or `echo` cannot plant a command for a visitor to tap. Links, from OSC 8 or from a builder, must pass `safeHref`: an absolute `http:`, `https:` or `mailto:` URL with no whitespace or control characters. Words from data placed into a follow-up chip must match a plain pattern (`PLAIN_ARG`).

**Text from services is cleaned.** Names and text from upstream services pass through `src/lib/upstream-text.ts`, which turns controls into spaces, removes bidirectional overrides and isolates, and caps the length, so a place or company name cannot reorder a line or carry an escape.

**Content-Security-Policy.** `firebase.json` sends, on every path:

```text
default-src 'self'; script-src 'self' 'sha256-…' 'sha256-…'; style-src 'self' 'unsafe-inline';
img-src 'self' data: https:; font-src 'self'; connect-src 'self' https:; object-src 'none';
base-uri 'none'; frame-ancestors 'none'; form-action 'self'
```

Scripts come only from the site, plus the hashes of the inline scripts in `public/` (the 404 page and the device probe), which `tests/hosting/hosting.test.ts` recomputes. `style-src` allows inline styles because Svelte sets style attributes. `connect-src` stays at `https:` because `curl`, `wget` and the network commands fetch what the visitor asks for; the policy's job is to stop injected script, not to limit fetches. Alongside it: `Permissions-Policy` (geolocation, wake lock and clipboard write for the site only; camera, microphone, payment and USB off), `Referrer-Policy: strict-origin-when-cross-origin` and `X-Content-Type-Options: nosniff`. The end-to-end tests run the app, the probe and the 404 page under the enforced policy in Chromium and WebKit.

**Secret input.** The `sudo` password field is masked text that password managers ignore. What is typed there is never written to history, the session snapshot, the kill ring or storage, and is cleared when the field loses focus and when the page is left.

**Bounded work.** Every network request has a deadline and every command a budget; ^C ends any line. Every regular expression a visitor types passes one guard (`src/commands/lib/regex.ts`) that refuses patterns that could run for ever and limits the line length each pattern may run against, because a JavaScript regular expression cannot be interrupted. Output to the screen is capped.

**Tests.** `tests/security/xss-pipeline.test.ts` runs an XSS corpus through the whole pipeline (typed lines, files, pipes, SGR and OSC 8) into the real transcript component, and `e2e/safe-output.spec.ts` does the same in the browsers.
