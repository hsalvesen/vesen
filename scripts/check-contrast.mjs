#!/usr/bin/env node
// WCAG 2.x contrast of every theme, in two parts.
//
//   roles    The --role-* colours exactly as the app applies them: this imports
//            src/lib/roles.ts, the code platform/theme-apply.ts runs. Every text role must reach
//            4.5:1 on the background (and on its own panel tint where it titles a panel), body
//            text 4.5:1 on every panel tint and on the selection, ghost text and the cursor 3:1,
//            chip text 4.5:1 on the chip, a selected chip's accent outline 3:1 on the chip, and QR
//            ink 7:1 on its paper.
//   palette  The palette slots output still uses as text (the owner's documents, SGR colours), on
//            the background, against the committed baseline of pairs that failed before the
//            palette work: no pair may newly fail or get worse. The baseline should only shrink.
//
// By default a role below its minimum is reported and a palette regression fails. Flags:
//   --strict           also fail when any role is below its minimum (what CI runs)
//   --update-baseline  record today's failing palette pairs as the baseline
// Zero dependencies: the role code is TypeScript that Node 22.18+ runs as is; older Node gets a
// one-off transpile with the TypeScript compiler the repo already has.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'contrast-baseline.json');

/**
 * @typedef {import('../src/lib/roles.ts').ThemeColours} ThemeColours
 * @typedef {typeof import('../src/lib/roles.ts')} RolesModule
 * @typedef {typeof import('../src/lib/colour.ts')} ColourModule
 */

/**
 * Transpiles a TypeScript module, and the relative modules it imports at run time, into a
 * temporary copy of the repo's layout, then imports it. For Node versions that cannot strip types
 * themselves; type-only imports are dropped in the transpile, so they are not followed.
 * @param {string} entry absolute path of a .ts file in the repo
 * @returns {Promise<unknown>}
 */
export async function importTranspiled(entry) {
  const ts = (await import('typescript')).default;
  const out = mkdtempSync(join(tmpdir(), 'vesen-contrast-'));
  const built = (/** @type {string} */ file) => join(out, relative(ROOT, file)).replace(/\.ts$/, '.js');
  writeFileSync(join(out, 'package.json'), '{"type":"module"}\n');
  const pending = [entry];
  const seen = new Set();
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    const { outputText } = ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, rewriteRelativeImportExtensions: true },
    });
    mkdirSync(dirname(built(file)), { recursive: true });
    writeFileSync(built(file), outputText);
    for (const match of outputText.matchAll(/\bfrom\s*['"](\.{1,2}\/[^'"]+)\.js['"]/g)) {
      pending.push(join(dirname(file), `${match[1]}.ts`));
    }
  }
  try {
    return await import(pathToFileURL(built(entry)).href);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/** @returns {Promise<{ roles: RolesModule, colour: ColourModule }>} */
async function loadLib() {
  try {
    return { roles: await import('../src/lib/roles.ts'), colour: await import('../src/lib/colour.ts') };
  } catch (error) {
    if (/** @type {{ code?: unknown }} */ (error).code !== 'ERR_UNKNOWN_FILE_EXTENSION') throw error;
    return {
      roles: /** @type {RolesModule} */ (await importTranspiled(join(ROOT, 'src', 'lib', 'roles.ts'))),
      colour: /** @type {ColourModule} */ (await importTranspiled(join(ROOT, 'src', 'lib', 'colour.ts'))),
    };
  }
}

const { roles, colour } = await loadLib();

// ── Palette ──────────────────────────────────────────────────────────────────────────────

/** Palette slots that render text in output (documents, SGR), checked against `background`. */
export const TEXT_SLOTS = /** @type {const} */ (['foreground', 'white', 'brightBlack', 'cyan', 'yellow', 'green', 'red']);

/** WCAG AA minimum for normal-size text. */
export const AA_NORMAL = roles.TEXT_MIN;

/**
 * @param {string} hex `#rgb` or `#rrggbb`
 * @returns {[number, number, number]} sRGB channels, 0-255
 */
export function parseHex(hex) {
  const match = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match || !match[1]) throw new Error(`Not a hex colour: ${hex}`);
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join('') : match[1];
  /** @param {number} i */
  const channel = (i) => parseInt(digits.slice(i, i + 2), 16);
  return [channel(0), channel(2), channel(4)];
}

/**
 * WCAG contrast ratio between two colours, 1 to 21. Throws on anything that is not a colour.
 * @param {string} a
 * @param {string} b
 */
export function contrastRatio(a, b) {
  parseHex(a);
  parseHex(b);
  return colour.contrastRatio(a, b);
}

/**
 * @typedef {{ name: string, background: string } & Record<string, unknown>} PaletteColours
 * @typedef {{ theme: string, role: string, colour: string, ratio: number }} Measurement
 */

/**
 * Measures every text slot of every theme.
 * @param {PaletteColours[]} themes
 * @returns {Measurement[]}
 */
export function measureThemes(themes) {
  return themes.flatMap((theme) =>
    TEXT_SLOTS.map((role) => {
      const colour = theme[role];
      if (typeof colour !== 'string') throw new Error(`Theme ${theme.name} has no ${role} colour`);
      return { theme: theme.name, role, colour, ratio: contrastRatio(colour, theme.background) };
    }),
  );
}

/** Ratios are compared and stored to two decimals, as the table prints them. */
const round2 = (/** @type {number} */ ratio) => Math.round(ratio * 100) / 100;

/** @param {Measurement} m */
const pairKey = (m) => `${m.theme}/${m.role}`;

/**
 * The failing pairs as a baseline: `theme/role` -> ratio, sorted by key.
 * @param {Measurement[]} measurements
 * @returns {Record<string, number>}
 */
export function baselineOf(measurements) {
  const failing = measurements.filter((m) => m.ratio < AA_NORMAL).sort((a, b) => pairKey(a).localeCompare(pairKey(b)));
  return Object.fromEntries(failing.map((m) => [pairKey(m), round2(m.ratio)]));
}

/**
 * Compares measurements with the baseline of known failures.
 * `regressions` fail the check: a new pair below AA, or a known one that got worse.
 * `cleared` are known pairs that now pass or no longer exist; the baseline can drop them.
 * @param {Measurement[]} measurements
 * @param {Record<string, number>} baseline
 * @returns {{ regressions: string[], cleared: string[] }}
 */
export function compareWithBaseline(measurements, baseline) {
  /** @type {string[]} */
  const regressions = [];
  const failing = new Set();
  for (const m of measurements) {
    if (m.ratio >= AA_NORMAL) continue;
    const key = pairKey(m);
    failing.add(key);
    const known = baseline[key];
    const ratio = round2(m.ratio);
    if (known === undefined) regressions.push(`${key} is ${ratio.toFixed(2)}:1, below ${AA_NORMAL}:1`);
    else if (ratio < known) regressions.push(`${key} fell from ${known.toFixed(2)}:1 to ${ratio.toFixed(2)}:1`);
  }
  const cleared = Object.keys(baseline).filter((key) => !failing.has(key));
  return { regressions, cleared };
}

// ── Roles ────────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ theme: string, role: string, against: string, colour: string, ratio: number, min: number }} RoleMeasurement
 */

/**
 * Every role requirement of every theme, on the colours the app applies.
 * @param {ThemeColours[]} themes
 * @returns {RoleMeasurement[]}
 */
export function measureRoles(themes) {
  return themes.flatMap((theme) => {
    const applied = roles.deriveRoles(theme);
    return roles.roleChecks(theme, applied).map((check) => ({
      theme: theme.name,
      role: check.role,
      against: check.against,
      colour: applied[check.role],
      ratio: check.ratio,
      min: check.min,
    }));
  });
}

/**
 * Role values a theme sets that are neither a hex colour nor one of its palette slots. They are
 * ignored by the app, which computes the role instead, so they are mistakes worth failing on.
 * @param {ThemeColours[]} themes
 * @returns {string[]}
 */
export function invalidRoleOverrides(themes) {
  const known = new Set(/** @type {readonly string[]} */ (roles.ROLE_NAMES));
  return themes.flatMap((theme) =>
    Object.entries(theme.roles ?? {}).flatMap(([role, value]) => {
      if (!known.has(role)) return [`${theme.name}: '${role}' is not a role`];
      const slot = /** @type {Record<string, unknown>} */ (theme)[String(value)];
      const ok = colour.isHexColour(value) || (value !== 'name' && colour.isHexColour(slot));
      return ok ? [] : [`${theme.name}: ${role} is '${value}', neither a hex colour nor a palette slot`];
    }),
  );
}

/** A ratio, rounded down so a value just under a minimum never prints as meeting it. */
const fmt = (/** @type {number} */ ratio) => `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;

function main() {
  const strict = process.argv.includes('--strict');
  const update = process.argv.includes('--update-baseline');
  /** @type {ThemeColours[]} */
  const themes = JSON.parse(readFileSync(join(ROOT, 'themes.json'), 'utf8'));

  // Roles, as applied.
  const measured = measureRoles(themes);
  const below = measured.filter((m) => m.ratio < m.min);
  console.log('Roles, as the app applies them (src/lib/roles.ts):');
  for (const theme of themes) {
    const own = measured.filter((m) => m.theme === theme.name);
    const tightest = own.reduce((low, m) => (m.ratio / m.min < low.ratio / low.min ? m : low));
    const failing = own.filter((m) => m.ratio < m.min);
    const status = failing.length === 0 ? `all ${own.length} checks pass` : `${failing.length} of ${own.length} below minimum`;
    console.log(
      `  ${theme.name.padEnd(11)} ${status}; tightest: ${tightest.role} on ${tightest.against} ${fmt(tightest.ratio)} (min ${tightest.min}:1)`,
    );
    for (const m of failing) console.log(`    * ${m.role} ${m.colour} on ${m.against}: ${fmt(m.ratio)}, needs ${m.min}:1`);
  }
  const invalid = invalidRoleOverrides(themes);
  for (const problem of invalid) console.log(`  * ${problem}`);

  // Palette slots, against the baseline.
  const measurements = measureThemes(themes);
  const width = Math.max(...TEXT_SLOTS.map((role) => role.length), 6) + 2;
  console.log('\nPalette slots used as text by output:');
  console.log('theme'.padEnd(12) + 'background'.padEnd(12) + TEXT_SLOTS.map((role) => role.padStart(width)).join(''));
  for (const theme of themes) {
    const cells = TEXT_SLOTS.map((role) => {
      const ratio = measurements.find((m) => m.theme === theme.name && m.role === role)?.ratio ?? 0;
      const mark = ratio < AA_NORMAL ? '*' : ' ';
      return `${ratio.toFixed(2)}${mark}`.padStart(width);
    });
    console.log(theme.name.padEnd(12) + theme.background.padEnd(12) + cells.join(''));
  }
  const failures = measurements.filter((m) => m.ratio < AA_NORMAL);
  console.log(`\n* below ${AA_NORMAL}:1 (WCAG AA, normal text): ${failures.length} of ${measurements.length} palette pairs`);

  if (update) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baselineOf(measurements), null, 2)}\n`);
    console.log(`check-contrast: baseline updated with ${failures.length} pair(s).`);
    return;
  }

  let failed = false;
  /** @type {Record<string, number>} */
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const { regressions, cleared } = compareWithBaseline(measurements, baseline);
  if (cleared.length > 0) {
    console.log(`check-contrast: ${cleared.join(', ')} now pass; run with --update-baseline to drop them.`);
  }
  if (regressions.length > 0) {
    console.error(`check-contrast: ${regressions.length} palette pair(s) worse than the baseline:`);
    for (const regression of regressions) console.error(`  ${regression}`);
    failed = true;
  }
  if (below.length > 0 || invalid.length > 0) {
    const message = `check-contrast: ${below.length} role check(s) below minimum, ${invalid.length} invalid role override(s).`;
    if (strict) {
      console.error(`${message} Failing because --strict is set.`);
      failed = true;
    } else {
      console.log(`${message} --strict fails on these.`);
    }
  }
  if (failed) process.exit(1);
  console.log(
    `check-contrast: every role meets its minimum in all ${themes.length} themes; no palette pair worse than the baseline (${Object.keys(baseline).length} known).`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
