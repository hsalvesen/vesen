import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  findBoundaryViolations,
  findCatalogueImports,
  findForbiddenApis,
  findRawHtml,
  findRemovedImports,
  findRemovedPaths,
  maskSource,
  resolveImport,
} from './check-boundaries.mjs';

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
    // The owner's documents are text, imported with ?raw.
    expect(importing('src/vfs/seed.ts', '../content/README.vt?raw')).toEqual([]);
  });

  it('flags stores, concrete services, legacy code and data outside those folders', () => {
    for (const [file, specifier] of [
      ['src/shell/violate.ts', '../stores/job'],
      ['src/shell/violate.ts', '../stores/theme.ts'],
      ['src/commands/system/violate.ts', '../../services/net'],
      ['src/commands/system/violate.ts', '../../stores/screen'],
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

describe('the deleted legacy layer', () => {
  const importing = (file: string, specifier: string) => findRemovedImports(`import x from '${specifier}';`, file).map((p) => p.line);

  it('flags an import of src/utils, src/components or a legacy module from anywhere', () => {
    expect(importing('src/app/bootstrap.ts', '../utils/beep')).toEqual([1]);
    expect(importing('src/App.svelte', './components/Cathode.svelte')).toEqual([1]);
    expect(importing('tests/security/x.test.ts', '../../src/utils/legacyShell')).toEqual([1]);
    expect(importing('e2e/x.spec.ts', '../src/commands/legacy.ts')).toEqual([1]);
    expect(importing('src/ui/OutputView.svelte', './legacy-block')).toEqual([1]);
    expect(findRemovedImports("const m = import('../interfaces/command');", 'src/app/shell.ts')).toHaveLength(1);
  });

  it('allows everything else, including names that only look alike', () => {
    expect(importing('src/app/bootstrap.ts', '../services/bell')).toEqual([]);
    expect(importing('src/App.svelte', './ui/Cathode.svelte')).toEqual([]);
    expect(importing('src/platform/head.ts', '../interfaces/theme')).toEqual([]);
    expect(importing('src/commands/lib/x.ts', './utils')).toEqual([]);
    expect(importing('src/lib/x.ts', 'utils')).toEqual([]);
    expect(findRemovedImports("// import x from '../utils/beep';", 'src/app/a.ts')).toEqual([]);
  });

  it('finds a removed folder or module that has come back', () => {
    const root = mkdtempSync(join(tmpdir(), 'boundaries-'));
    try {
      expect(findRemovedPaths(root)).toEqual([]);
      mkdirSync(join(root, 'src', 'utils'), { recursive: true });
      mkdirSync(join(root, 'src', 'commands'), { recursive: true });
      writeFileSync(join(root, 'src', 'commands', 'legacy.ts'), '');
      expect(findRemovedPaths(root)).toEqual(['src/utils', 'src/commands/legacy']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('the catalogue', () => {
  const lines = (source: string, file: string) => findCatalogueImports(source, file).map((p) => p.line);

  it('may be loaded only by the import() in src/commands/index.ts', () => {
    expect(lines("const load = () => import('./more/catalogue');", 'src/commands/index.ts')).toEqual([]);
    expect(lines("import { catalogueSpecs } from './more/catalogue';", 'src/commands/index.ts')).toEqual([1]);
    expect(lines("const load = () => import('../commands/more/catalogue');", 'src/app/shell.ts')).toEqual([1]);
  });

  it('flags any other import into it from outside, static, type-only or of one command', () => {
    expect(lines("import rev from '../more/text/rev';", 'src/commands/shell/help.ts')).toEqual([1]);
    expect(lines("\nimport type { X } from '../commands/more/text/rev.run';", 'src/app/shell.ts')).toEqual([2]);
    expect(lines("export * from './more/text/rev';", 'src/commands/index.ts')).toEqual([1]);
    expect(lines("import './more/text/rev';", 'src/commands/index.ts')).toEqual([1]);
  });

  it('lets the catalogue import itself and everything else, and ignores comments and look-alikes', () => {
    expect(lines("import { reverseLine } from './rev.run';", 'src/commands/more/text/rev.ts')).toEqual([]);
    expect(lines("import { defineCommand } from '../../../shell/types';", 'src/commands/more/text/rev.ts')).toEqual([]);
    expect(lines("import { more } from './lib/more';", 'src/commands/index.ts')).toEqual([]);
    expect(lines("// import rev from './more/text/rev';", 'src/commands/index.ts')).toEqual([]);
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
