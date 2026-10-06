// The weather core is pure: only sources.ts (and resolve.ts, through it) reach the network.
// src/services may touch browser APIs, so check-boundaries does not cover this folder; this
// test holds the pure modules to the same rule as the DOM-free folders.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findBoundaryViolations } from '../../../scripts/check-boundaries.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PURE = ['types.ts', 'wmo.ts', 'units.ts', 'places.ts', 'view.ts'];
const PURE_IMPORT = /^(?:\.\/(?:types|wmo|units|places|view)|\.\.\/\.\.\/output\/model)$/;

describe('the pure weather modules', () => {
  it.each(PURE)('%s uses no browser API, Svelte or network', (file) => {
    const source = readFileSync(join(HERE, file), 'utf8');
    expect(findBoundaryViolations(source)).toEqual([]);
    const imports = [...source.matchAll(/\bfrom\s+'([^']+)'/g)].map((match) => match[1] ?? '');
    expect(imports.filter((specifier) => !PURE_IMPORT.test(specifier))).toEqual([]);
  });
});
