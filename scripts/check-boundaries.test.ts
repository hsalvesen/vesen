import { describe, expect, it } from 'vitest';
import { findBoundaryViolations, maskSource } from './check-boundaries.mjs';

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
