import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ALLOWED, GLYPHS_PATH, coverage, describe as describeCodePoint, findMissing, isAllowed, loadGlyphs, scanRepo, scannedFiles } from './check-glyphs.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

describe('coverage', () => {
  const drawn = coverage([
    [0x2500, 0x257f],
    [0x20, 0x7e],
    [0x2713, 0x2713],
  ]);

  it('answers from inclusive ranges, in any order', () => {
    expect(drawn(0x20)).toBe(true);
    expect(drawn(0x7e)).toBe(true);
    expect(drawn(0x7f)).toBe(false);
    expect(drawn(0x2500)).toBe(true);
    expect(drawn(0x257f)).toBe(true);
    expect(drawn(0x2580)).toBe(false);
    expect(drawn(0x2713)).toBe(true);
    expect(drawn(0x2715)).toBe(false);
  });
});

describe('findMissing', () => {
  const drawn = coverage([
    [0x20, 0x7e],
    [0x2190, 0x2195],
    [0x2500, 0x257f],
  ]);

  it('lists each character the font lacks once a line, with its line, and never ASCII or what the font has', () => {
    const text = "const a = '→ fine';\nconst b = '✉ ✉ ⧉';\n\nconst c = '─';\nconst d = '↗';";
    expect(findMissing(text, drawn)).toEqual([
      { line: 2, char: '✉', codePoint: 0x2709 },
      { line: 2, char: '⧉', codePoint: 0x29c9 },
      { line: 5, char: '↗', codePoint: 0x2197 },
    ]);
  });

  it('passes the characters allowed on purpose', () => {
    expect(isAllowed(0x0301)).toBe(true);
    expect(isAllowed(0xff71)).toBe(true);
    expect(isAllowed(0x2709)).toBe(false);
    expect(findMissing('/[̀-ͯ]/ and ｱ and ‸', drawn)).toEqual([]);
    for (const entry of ALLOWED) expect(entry.why).not.toBe('');
  });

  it('names a code point as U+XXXX', () => {
    expect(describeCodePoint(0x2709)).toBe('U+2709');
    expect(describeCodePoint(0x1f600)).toBe('U+1F600');
  });
});

describe('the committed list', () => {
  it('describes the shipped font, by its hash, and holds what the terminal draws with', () => {
    const { list, problem } = loadGlyphs(ROOT);
    expect(problem).toBeNull();
    expect(list.sha256).toBe(createHash('sha256').update(readFileSync(new URL(list.font, `file://${ROOT}`))).digest('hex'));
    expect(list.count).toBe(list.ranges.reduce((sum, [from, to]) => sum + (to - from + 1), 0));
    const drawn = coverage(list.ranges);
    for (const char of '→×▾●○▣…✓─━┃┌┐└┘│█▀▄░▒▓⠋⠙⠹•–—‹›°·≈±') expect(drawn(char.codePointAt(0) ?? 0), char).toBe(true);
    for (const char of '✉⧉↗↻✕⌄⌨⏻⋮☀⚠') expect(drawn(char.codePointAt(0) ?? 0), char).toBe(false);
  });

  it('says when the font and the list drift apart', () => {
    expect(GLYPHS_PATH).toBe('scripts/fonts/glyphs.json');
    const { problem } = loadGlyphs(ROOT);
    expect(problem).toBeNull();
  });
});

describe('the repository', () => {
  it('scans the source, the pages and the stylesheets, and no test or snapshot', () => {
    const files = scannedFiles(ROOT).map((file) => file.slice(ROOT.length));
    expect(files).toContain('src/ui/components/LinkCard.svelte');
    expect(files).toContain('src/commands/lib/cards.ts');
    expect(files).toContain('index.html');
    expect(files).toContain('public/404.html');
    expect(files.some((file) => file.endsWith('.css'))).toBe(true);
    expect(files.some((file) => /\.test\./.test(file) || file.includes('__snapshots__'))).toBe(false);
  });

  it('has no character the terminal font would not draw', () => {
    const { failures, scanned } = scanRepo(ROOT);
    expect(failures).toEqual([]);
    expect(scanned).toBeGreaterThan(100);
  });
});
