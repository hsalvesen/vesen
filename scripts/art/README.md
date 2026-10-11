# Vesen's art

The tools the ASCII art was made with, kept so it can be iterated: fastfetch's OS logos
(`src/commands/system/fastfetch.logos.ts`) and the VESEN wordmark's shadow
(`src/commands/lib/banner.ts`). They are not npm scripts and nothing in the app imports them.
The art is drawn for vesen; the tracer only chooses glyphs.

| File | What it does |
|---|---|
| `trace.py` | Traces a silhouette into ASCII in the terminal's own font: every printable glyph of `assets-src/fonts/CascadiaCode.ttf` is rendered into a cell of the terminal's aspect, and each cell of the shape gets the glyph whose ink matches it best, with full cells drawn in one fill glyph. A library (`canvas`, `trace`, `layer`, `threshold`, `outline`) and a command (`trace.py shape.png --cols 26`). |
| `logos.py` | The four OS logos as PIL silhouettes (an apple, a bugdroid, four panes, a penguin). `--ts` prints the rows for `fastfetch.logos.ts`; `--preview` writes `preview/art.txt`. |
| `wordmark.py` | Reads the wordmark's quadrant characters back into their 2x2 bitmap and draws the `:` drop shadow one column right and one row down. `--write` rewrites the two constants in `banner.ts`; `--preview` writes `preview/wordmark.txt`. |
| `preview/index.html` | Shows the pieces of `art.txt` (or `?art=wordmark.txt`) in Vesen Mono at 16px and 13px on the swamphen background, block art at line height 1 as the app draws it. |
| `preview/shot.mjs` | Screenshots that page without a server, with the repo's Playwright. |

## Iterating

```sh
python3 -m venv ~/.venvs/vesen-art && . ~/.venvs/vesen-art/bin/activate   # once, outside the repo
pip install pillow numpy                                                   # once

python3 scripts/art/logos.py --preview           # draw the logos, print them, write preview/art.txt
node scripts/art/preview/shot.mjs --out=/tmp/logos.png   # then look at the PNG
```

Or serve the repository root and open the page in a browser, where a reload shows a rewrite:

```sh
python3 -m http.server 4611 --bind 127.0.0.1     # then http://127.0.0.1:4611/scripts/art/preview/
```

Edit the geometry in `logos.py` (each logo is one function painting white shapes and black holes
on `canvas(cols, rows)`; the fill glyph, and an `alphabet` for the edges, are chosen per logo),
look again, and when it is right paste `python3 scripts/art/logos.py --ts` into
`fastfetch.logos.ts`. Keep the art to printable ASCII without a backtick, 24 to 28 columns by 12
to 14 rows, and update the sizes in `fastfetch.test.ts` and `src/ui/fastfetch-view.test.ts`.

For the wordmark, edit the quadrant characters of `BANNER_ART` or `BANNER_ART_COMPACT` in
`banner.ts` (the shadow is read as empty, so leave it or strip it), then
`python3 scripts/art/wordmark.py --write` redraws the shadow, and `node scripts/og.mjs`
regenerates `public/og.png`.

The real test is the app: `npm run build && npx vite preview --port 4611 --strictPort`, then
`fastfetch` on a desktop and on a phone (Playwright's `iphone-instagram` project, or a spoofed
`navigator.userAgent` in `page.addInitScript`, picks each logo).
