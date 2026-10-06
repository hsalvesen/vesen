import { describe, expect, it } from 'vitest';
import { findBoundaryViolations, findForbiddenApis, findRawHtml, maskSource, resolveImport } from './check-boundaries.mjs';

describe('maskSource', () => {
  it('blanks comments and literals but keeps template expressions and line breaks', () => {
    const source = "// window\nconst a = 'document'; /* x\n */ const b = `t ${navigator} t`;";
    const masked = maskSource(source, { keepStrings: false });
    expect(masked.split('\n')).toHaveLength(source.split('\n').length);
    expect(masked).not.toMatch(/window|document/);
    expect(masked).toContain('${navigator}');
  });

  it('treats a slash after an operand as division, not a regex', () => {
    const masked = maskSource("const x = a / b / c; const y = 'window';", { keepStrings: false });
    expect(masked).toContain('a / b / c');
    expect(masked).not.toContain('window');
  });
});

describe('findBoundaryViolations', () => {
  it('flags browser globals and Svelte imports', () => {
    const source = [
      "import { writable } from 'svelte/store';",
      'const width = window.innerWidth;',
      'const saved = localStorage.getItem("k");',
    ].join('\n');
    expect(findBoundaryViolations(source).map((p) => p.line)).toEqual([1, 2, 3]);
  });

  it('ignores mentions in comments, strings, regexes and property names', () => {
    const source = [
      '// the window is fine here',
      "const label = 'open a document';",
      'const re = /["\']navigator/;',
      'const value = ctx.window ?? env?.document;',
    ].join('\n');
    expect(findBoundaryViolations(source)).toEqual([]);
  });
});

describe('findBoundaryViolations: globals reached another way', () => {
  it('flags globalThis, self, location, DOMParser, matchMedia and fetch', () => {
    const source = [
      'globalThis.localStorage.getItem("k");',
      'const agent = self.navigator.userAgent;',
      'const here = location.href;',
      'const doc = new DOMParser();',
      "const dark = matchMedia('(prefers-color-scheme: dark)');",
      "fetch('/README.md');",
      'register(window);',
    ].join('\n');
    expect(findBoundaryViolations(source).map((p) => p.line)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('ignores property keys and names the file declares itself', () => {
    const source = [
      'interface Place { location: string; fetch?: boolean }',
      "const view = { location: 'Oslo', self: true };",
      'const describe = (location: Place) => location.name;',
      "import { fetch } from './fetcher';",
      'fetch(view);',
      'function where() { const document = parse(); return document.title; }',
    ].join('\n');
    expect(findBoundaryViolations(source)).toEqual([]);
  });
});

describe('findBoundaryViolations: imports', () => {
  const importing = (file: string, specifier: string) =>
    findBoundaryViolations(`import { x } from '${specifier}';`, file).map((p) => p.message);

  it('allows the DOM-free folders and the service contracts', () => {
    expect(importing('src/shell/kernel.ts', '../output/model')).toEqual([]);
    expect(importing('src/shell/kernel.ts', './types.ts')).toEqual([]);
    expect(importing('src/commands/system/whoami.ts', '../../services/types')).toEqual([]);
    expect(importing('src/commands/system/whoami.ts', '../../services/storage-keys.ts')).toEqual([]);
    expect(importing('src/commands/network/stock.ts', '../../services/market/contract')).toEqual([]);
    expect(importing('src/commands/net/qr.ts', '../../lib/qr')).toEqual([]);
    expect(importing('src/lib/qr/index.ts', 'some-package')).toEqual([]);
  });

  it('flags stores, concrete services, legacy code and data outside those folders', () => {
    for (const [file, specifier] of [
      ['src/shell/violate.ts', '../stores/job'],
      ['src/shell/violate.ts', '../stores/theme.ts'],
      ['src/commands/system/violate.ts', '../../services/net'],
      ['src/commands/system/violate.ts', '../../stores/history'],
      ['src/output/violate.ts', '../utils/commands'],
      ['src/vfs/violate.ts', '../platform/hosts'],
      ['src/commands/theme.ts', '../../themes.json'],
    ] as const) {
      expect(importing(file, specifier), `${file} -> ${specifier}`).toHaveLength(1);
    }
  });

  it('checks re-exports, side-effect imports and dynamic imports too', () => {
    const source = ["export * from '../stores/job';", "import '../stores/cathode';", "const m = import('../ui/x');"].join('\n');
    expect(findBoundaryViolations(source, 'src/shell/a.ts').map((p) => p.line)).toEqual([1, 2, 3]);
  });

  it('resolves specifiers to repo paths without extensions', () => {
    expect(resolveImport('src/commands/system/a.ts', '../../services/types.ts')).toBe('src/services/types');
    expect(resolveImport('src/shell/a.ts', './complete/index.ts')).toBe('src/shell/complete');
    expect(resolveImport('src/shell/a.ts', 'svelte/store')).toBeNull();
  });
});

describe('findForbiddenApis', () => {
  it('flags AbortSignal.any and AbortSignal.timeout in code only', () => {
    const source = [
      '// AbortSignal.any is fine in a comment',
      "const label = 'AbortSignal.timeout';",
      'const both = AbortSignal.any([a, b]);',
      'const later = AbortSignal .timeout(5000);',
      'const fine = AbortSignal.abort();',
    ].join('\n');
    expect(findForbiddenApis(source).map((p) => p.line)).toEqual([3, 4]);
  });
});

describe('findRawHtml', () => {
  it('flags every raw HTML block, wherever it is', () => {
    const tag = '{' + '@html';
    const source = ['<p>{text}</p>', `<div>${tag} output}</div>`, `<!-- ${tag} in a comment -->`].join('\n');
    expect(findRawHtml(source).map((p) => p.line)).toEqual([2, 3]);
  });

  it('allows text interpolation and other blocks', () => {
    expect(findRawHtml('<span>{line}</span>{#if a}{@render b()}{/if}')).toEqual([]);
  });
});
