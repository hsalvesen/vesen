#!/usr/bin/env node
// WCAG 2.x contrast of each theme's text colours against its background. Prints a table, then:
//   - by default, fails when a pair drops below 4.5:1 (the AA threshold for normal-size text)
//     that is not in the committed baseline, or a baselined pair gets worse;
//   - with --strict, fails when any pair is below 4.5:1;
//   - with --update-baseline, records today's failing pairs as the baseline.
// The baseline lists the pairs that failed before the palette work; it should only shrink.
// Zero dependencies.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'contrast-baseline.json');

/** Palette slots that render text, checked against `background`. */
export const TEXT_ROLES = /** @type {const} */ (['foreground', 'white', 'brightBlack', 'cyan', 'yellow', 'green', 'red']);

/** WCAG AA minimum for normal-size text. */
export const AA_NORMAL = 4.5;

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
 * WCAG relative luminance, 0 (black) to 1 (white).
 * @param {string} hex
 */
export function relativeLuminance(hex) {
  const [r, g, b] = parseHex(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

/**
 * WCAG contrast ratio between two colours, 1 to 21.
 * @param {string} a
 * @param {string} b
 */
export function contrastRatio(a, b) {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

/**
 * @typedef {{ name: string, background: string } & Record<string, unknown>} ThemeColours
 * @typedef {{ theme: string, role: string, colour: string, ratio: number }} Measurement
 */

/**
 * Measures every text role of every theme.
 * @param {ThemeColours[]} themes
 * @returns {Measurement[]}
 */
export function measureThemes(themes) {
  return themes.flatMap((theme) =>
    TEXT_ROLES.map((role) => {
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

function main() {
  const strict = process.argv.includes('--strict');
  const update = process.argv.includes('--update-baseline');
  /** @type {ThemeColours[]} */
  const themes = JSON.parse(readFileSync(join(ROOT, 'themes.json'), 'utf8'));
  const measurements = measureThemes(themes);

  const width = Math.max(...TEXT_ROLES.map((role) => role.length), 6) + 2;
  console.log('theme'.padEnd(12) + 'background'.padEnd(12) + TEXT_ROLES.map((role) => role.padStart(width)).join(''));
  for (const theme of themes) {
    const cells = TEXT_ROLES.map((role) => {
      const ratio = measurements.find((m) => m.theme === theme.name && m.role === role)?.ratio ?? 0;
      const mark = ratio < AA_NORMAL ? '*' : ' ';
      return `${ratio.toFixed(2)}${mark}`.padStart(width);
    });
    console.log(theme.name.padEnd(12) + theme.background.padEnd(12) + cells.join(''));
  }

  const failures = measurements.filter((m) => m.ratio < AA_NORMAL);
  console.log(`\n* below ${AA_NORMAL}:1 (WCAG AA, normal text): ${failures.length} of ${measurements.length}`);

  if (update) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baselineOf(measurements), null, 2)}\n`);
    console.log(`check-contrast: baseline updated with ${failures.length} pair(s).`);
    return;
  }
  if (strict) {
    if (failures.length > 0) {
      console.error('check-contrast: failing because --strict is set.');
      process.exit(1);
    }
    return;
  }

  /** @type {Record<string, number>} */
  const baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
  const { regressions, cleared } = compareWithBaseline(measurements, baseline);
  if (cleared.length > 0) {
    console.log(`check-contrast: ${cleared.join(', ')} now pass; run with --update-baseline to drop them.`);
  }
  if (regressions.length > 0) {
    console.error(`check-contrast: ${regressions.length} pair(s) worse than the baseline:`);
    for (const regression of regressions) console.error(`  ${regression}`);
    process.exit(1);
  }
  console.log(`check-contrast: no pair worse than the baseline (${Object.keys(baseline).length} known); --strict enforces 4.5:1 everywhere.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
