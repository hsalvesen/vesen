#!/usr/bin/env node
// WCAG 2.x contrast of each theme's text colours against its background.
// Prints a table and, with --strict, exits non-zero when any value is under 4.5:1
// (the AA threshold for normal-size text). Zero dependencies.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

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

function main() {
  const strict = process.argv.includes('--strict');
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
  if (failures.length > 0 && strict) {
    console.error('check-contrast: failing because --strict is set.');
    process.exit(1);
  }
  if (failures.length > 0) console.log('check-contrast: report only; pass --strict to enforce.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
