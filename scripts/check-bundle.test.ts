import { describe, expect, it } from 'vitest';
import { STOCK_ROOTS, closure, initialChunks, staticImports } from './check-bundle.mjs';

describe('check-bundle', () => {
  it('reads the entry and the preloads from index.html', () => {
    const html = '<script type="module" src="/assets/index-a.js"></script><link rel="modulepreload" href="/assets/shared-b.js">';
    expect(initialChunks(html)).toEqual({ entry: 'index-a.js', preloads: ['shared-b.js'] });
  });

  it("follows a chunk's static imports, leaving out what is already loaded", () => {
    const files: Record<string, string> = {
      'stock.run-a.js': 'import{a}from"./contract-c.js";import{b}from"./index-x.js";',
      'client-b.js': 'import{a}from"./contract-c.js";import"./text-d.js";',
      'contract-c.js': '',
      'text-d.js': 'import{c}from"./shell-k.js";',
    };
    const read = (name: string): string => files[name] ?? '';
    expect(staticImports(files['client-b.js'] ?? '')).toEqual(['contract-c.js', 'text-d.js']);
    expect([...closure(['stock.run-a.js', 'client-b.js'], new Set(['index-x.js', 'shell-k.js']), read)]).toEqual([
      'stock.run-a.js',
      'client-b.js',
      'contract-c.js',
      'text-d.js',
    ]);
  });

  it("finds stock's first-run chunks by name", () => {
    const names = ['stock.run-DuQ0Auxe.js', 'client-PFSwVPgT.js', 'QuoteCard-CkwtB5v4.js', 'QuoteTable-Y.js', 'stock-Z.js'];
    expect(STOCK_ROOTS.map((pattern) => names.filter((name) => pattern.test(name)))).toEqual([
      ['stock.run-DuQ0Auxe.js'],
      ['client-PFSwVPgT.js'],
      ['QuoteCard-CkwtB5v4.js'],
    ]);
  });
});
