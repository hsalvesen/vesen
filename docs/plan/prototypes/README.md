# Prototypes

During the design phase, agents wrote working prototypes to check that their designs were feasible. The ones below passed their checks and are kept here as starting points. **None of this is wired into the app**, and `tsconfig.json` does not include this folder, so it cannot affect the build.

Run any of them from the repository root with the `esbuild` that is already installed:

```bash
node_modules/.bin/esbuild docs/plan/prototypes/qr/crosscheck.ts --bundle --platform=node --format=esm --outfile=/tmp/x.mjs --external:qrcode '--external:qrcode/*' && node /tmp/x.mjs
```

Swap in any other file below as the entry point.

| Folder | What it is | Check | Result on 6 October 2026 |
|---|---|---|---|
| `qr/` | A complete QR encoder: versions 1-40, levels L, M, Q, H, numeric, alphanumeric and byte segments, optimal segmentation, Reed-Solomon over GF(256), masks with ISO penalty scoring, BCH format and version bits, a half-block text renderer | `crosscheck.ts` compares every module with the `qrcode` package for forced masks across all versions, levels and modes; `vectors.ts` checks the ISO worked examples and internal invariants | 2,912 symbols compared, 0 mismatches; 0 table mismatches; syndromes zero; format Hamming distance 7; 40/40 versions; 400/400 segmenter cases |
| `shell/` | A lexer, a parser and an interpreter with pipes, redirection, `;`, `&&`, `||`, `!` and `$?`, over in-memory streams | `test.ts` (parser cases) and `interp.test.ts` (end-to-end lines) | All parser cases give the expected result, including the four deliberate syntax errors. `yes vesen \| head -n 3`, `cat a.txt \| sort \| uniq`, `cat nope 2>/dev/null \|\| echo "fallback $?"` and `wc < a.txt` all behave as in bash |
| `completion/` | A quote-aware completion core: context detection, common prefix, case-insensitive fallback, path completion through `~`, `..` and quoted names, a Tab state machine | `test.ts`, `test2.ts`, `test3.ts` | `cat Doc` → `cat documents/`; `cd ../../e` → `cd ../../etc/`; `theme set k` lists kangaroo and kookaburra; `cat 'documents/my` → `cat 'documents/my notes.txt' `; four Tabs on `c` list, then cycle |
| `weather/art.mts` | Original 13×5 ASCII weather art for each WMO code, plus the compact and wide card layouts | Run it directly | Prints both layouts for a sample Sydney forecast |

**Changes needed before production use:**

- The shell lexer throws on incomplete input. The shared contract in [../02-architecture-and-contracts.md](../02-architecture-and-contracts.md#3-one-lexer) requires a tolerant lexer that returns `complete: false` instead.
- The QR files need the project's strict TypeScript settings and real test files under the single test stack.
