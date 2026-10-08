# Device probe results

*Template: not yet run. The owner fills this in; see [STATUS.md](STATUS.md), "What still needs the owner".*

The device probe (`public/probe/index.html`, served at `/probe/` on every preview channel and, once the overhaul is merged, at `https://www.vesen.app/probe/`; nothing in the app links to it) records what Instagram's in-app browser really does. Emulators cannot answer these questions, so it has to be run on real phones. Plan 04, "The device capability probe", explains why each item matters.

## How to run it

1. Send yourself the probe's address (the preview channel URL from the pull request, followed by `/probe/`, or `https://www.vesen.app/probe/` once merged) in an Instagram DM, on an iPhone and on an Android phone, and open it from the DM.
2. Tap each test in order: focus the 16px and 12px inputs, Measure viewport, Clipboard write, `window.open`, the `target=_blank` link, the `mailto:` link, Geolocation, the two downloads, Share, then long-press the image. Try each escape link last (each may leave Instagram; come back and reopen the probe from the DM).
3. Write in **Notes** what you saw that the page cannot detect: whether a mail app opened, what long-press offered, where each escape link went.
4. Close Instagram completely, reopen the probe from the DM, and check that **storage.previousVisit** is filled in (it proves `localStorage` survives).
5. Tap **Copy results** and paste the JSON below. The probe keeps only the origin and path of URLs and the names of query parameters, so the results are safe to commit.
6. When both phones are recorded, remove the probe: delete `public/probe/`, its script hash from the CSP and its `/probe/` cache headers in `firebase.json`, and the probe cases in `tests/hosting/hosting.test.ts` and `e2e/hosting.spec.ts`.

## Summary

| Question | iPhone, Instagram | Android, Instagram | Affects |
|---|---|---|---|
| Device, OS and Instagram version | | | |
| `inApp.instagram` detected from the user agent | | | in-app link policy (`platform/env.ts`) |
| 16px input focus zooms the page (`zoomedOnFocus`) | | | the 16 px touch input |
| 12px input focus zooms the page | | | why the input is 16 px |
| Keyboard shrinks `visualViewport` (`visualViewportShrank`), and `innerHeight` too (`layoutViewportShrank`) | | | `--app-h`, `--kb-h` (`platform/viewport.ts`) |
| Input still focused after the keyboard opened (`stillFocused`) | | | keyboard kept open across commands |
| Clipboard write works | | | Copy on cards and QR |
| `window.open` opens a tab, the same view, or nothing | | | opener (`services/opener.ts`) |
| `target=_blank` link opens a tab or the same view | | | link cards |
| `mailto:` opened a mail app (Notes) | | | `contact` / `email` |
| Geolocation prompt shown, and the answer (or timeout at 8 s) | | | `weather --here` |
| `data:` PNG download / blob download / Share sheet | | | QR Save and Share |
| Long-press on the image offers Save or Add to Photos (Notes) | | | QR Present mode |
| `instagram://extbrowser/` escape opens the real browser | | | "Open in browser" escape |
| Android `intent://` escape (and the Chrome variant) works | | | "Open in browser" escape |
| `x-safari-https://` opens Safari | | | "Open in browser" escape |
| `localStorage` survives closing Instagram (`storage.previousVisit`) | | | history and files under `~` |
| `sessionStorage` works | | | the Back snapshot (`vesen:session:v1`) |
| `AbortSignal.any` / `AbortSignal.timeout` exist | | | confirms the manual signal helper |
| `CSS.supports`: container queries, `dvh`, `lh`, `color-mix`, `:has` | | | banner fit and styles |
| Media: `pointer: coarse`, `hover: none`, reduced motion, more contrast, forced colours, dark | | | dock, CRT tier |
| `connection` (`effectiveType`, `saveData`) | | | idle prefetch, `speedtest`'s data warning |
| CSP violations (`csp`), such as scripts Instagram injects | | | the Content-Security-Policy |

## Fields the probe records

For reference when reading the JSON:

- `probe`, `loadedAt`, `url` (origin and path), `queryKeys`, `notes`
- `csp[]`: `directive`, `blocked`, `source`, `disposition` for each violation
- `ua`: `userAgent`, `userAgentData` (`brands`, `mobile`, `platform`, and high-entropy values where given), `platform`, `vendor`, `maxTouchPoints`, `languages`, `locale`
- `inApp`: `instagram`, `facebook`, `messenger`, `tiktok`, `threads`, `androidWebView`, `iosWebView`
- `display`: `devicePixelRatio`, `screen` (`width`, `height`, `availWidth`, `availHeight`)
- `viewport.atLoad`: `innerWidth`, `innerHeight`, `clientHeight`, `scrollY`, `visualViewport` (`width`, `height`, `offsetTop`, `pageTop`, `scale`), `orientation`
- `css`: `container-type: inline-size`, `100dvh`, `1lh`, `color-mix(in srgb, red, blue)`, `:has(*)`
- `apis`: `AbortSignal.any`, `AbortSignal.timeout`, `share`, `canShareFiles`, `clipboardWriteText`, `geolocation`, `downloadAttribute`, `wakeLock`, `isSecureContext`, `standalone`
- `media`: `pointer: coarse`, `pointer: fine`, `any-pointer: fine`, `hover: hover`, `hover: none`, `prefers-reduced-motion: reduce`, `prefers-contrast: more`, `forced-colors: active`, `prefers-color-scheme: dark`, `display-mode: standalone`
- `connection`: `effectiveType`, `saveData`, `type`, `downlink`, `rtt`
- `navigation`: `referrer`, `historyLength`, `hasOpener`, `type`
- `storage`: `localStorage`, `previousVisit`, `visits`, `sessionStorage`; `previousActions` (tests that navigated away)
- `actions`: one record per test tapped (`focus16`, `focus12`, `measure`, `clipboard`, `windowOpen`, `targetBlank`, `mailto`, `geolocation`, `downloadData`, `downloadBlob`, `share`, `instagramExtbrowser`, `androidIntent`, `androidIntentChrome`, `xSafari`), each with `at`, its result, any `error`, and `leftPage`, `leftAfterMs` and `backAfterMs` when the tap left the page. The focus tests add `before`, `after`, `zoomedOnFocus`, `maxScale`, `layoutViewportShrank`, `visualViewportShrank`, `viewportEvents` and `stillFocused`.

## iPhone, Instagram

- Date:
- Device and iOS version:
- Instagram version:
- Notes:

```json
(paste the probe's JSON here)
```

## Android, Instagram

- Date:
- Device and Android version:
- Instagram version:
- Notes:

```json
(paste the probe's JSON here)
```

## What changed because of these results

(Record any change to the app the results call for, with the commit.)
