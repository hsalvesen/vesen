// figlet: the font's glyphs, the bands that fit the width, alignment, and the command.
import { describe, expect, it } from 'vitest';
import { runLine } from '../../../../tests/harness';
import { textWidth } from '../../../output/model';
import { bands, drawnWidth, figlet, FONT_CHARACTERS, FONT_HEIGHT, glyph, INK } from '../../lib/block-font';

const rows = (text: string): string[] => text.split('\n');
const widest = (text: string): number => Math.max(0, ...rows(text).map((row) => textWidth(row)));

describe('the font', () => {
  it('has every glyph five rows high, each row as wide as the rest, with some ink', () => {
    for (const ch of FONT_CHARACTERS) {
      const g = glyph(ch);
      expect(g, ch).toHaveLength(FONT_HEIGHT);
      expect(new Set(g.map((row) => row.length)).size, ch).toBe(1);
      if (ch !== ' ') expect(g.join('').includes('#'), ch).toBe(true);
    }
  });

  it('covers A-Z, 0-9 and the common punctuation', () => {
    for (const ch of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?\'"-_:;/\\()[]+=*#@&%$<>') expect(FONT_CHARACTERS, ch).toContain(ch);
  });

  it('draws lower case as upper case, an accented letter as its plain one, and the rest as ?', () => {
    expect(glyph('a')).toEqual(glyph('A'));
    expect(glyph('é')).toEqual(glyph('E'));
    expect(glyph('€')).toEqual(glyph('?'));
  });

  it('measures a line as its glyphs one column apart', () => {
    expect(drawnWidth('')).toBe(0);
    expect(drawnWidth('A')).toBe(4);
    expect(drawnWidth('AT')).toBe(4 + 1 + 5);
    expect(widest(figlet('HELLO', { width: 80, align: 'left' }))).toBe(drawnWidth('HELLO'));
  });
});

describe('fitting the width', () => {
  it('moves whole words to a new band, and cuts a word wider than the width', () => {
    expect(bands('hello world', 80)).toEqual(['hello world']);
    expect(bands('hello world', 30)).toEqual(['hello', 'world']);
    expect(bands('abcdefghij', 20)).toEqual(['abcd', 'efgh', 'ij']);
    expect(bands('', 20)).toEqual(['']);
  });

  it.each([20, 30, 40, 60, 80, 120])('keeps every row within %i columns', (width) => {
    const text = 'The quick brown fox jumps over the lazy dog 1234567890!';
    const drawn = figlet(text, { width, align: 'left' });
    expect(widest(drawn)).toBeLessThanOrEqual(width);
    // Bands of five rows, a blank row between them.
    expect((rows(drawn).length + 1) % (FONT_HEIGHT + 1)).toBe(0);
  });

  it('centres or right-aligns each band in the width', () => {
    const band = drawnWidth('HI');
    const centred = rows(figlet('hi', { width: 40, align: 'center' }));
    for (const row of centred) expect(row.startsWith(' '.repeat(Math.floor((40 - band) / 2)))).toBe(true);
    expect(rows(figlet('hi', { width: 40, align: 'right' }))[0]?.length).toBe(40);
    expect(rows(figlet('hi', { width: 40, align: 'left' }))[0]?.startsWith(INK)).toBe(true);
  });
});

describe('figlet in the shell', () => {
  it('fits the screen on a terminal, 80 columns in a pipe, or -w', async () => {
    const text = 'a sentence long enough to wrap on any screen';
    expect(widest((await runLine(`figlet ${text}`, { cols: 40 })).stdoutPlain)).toBeLessThanOrEqual(40);
    expect(widest((await runLine(`figlet ${text}`, { tty: false })).stdoutPlain)).toBeLessThanOrEqual(80);
    expect(widest((await runLine(`figlet ${text}`, { tty: false })).stdoutPlain)).toBeGreaterThan(60);
    expect(widest((await runLine(`figlet -w 30 ${text}`, { tty: false })).stdoutPlain)).toBeLessThanOrEqual(30);
  });

  it('draws art a screen reader reads as the text', async () => {
    const result = await runLine('figlet Hi there');
    expect(result.blocks).toEqual([expect.objectContaining({ type: 'art', alt: 'Hi there', fit: 'scale' })]);
    expect(rows(result.stdoutPlain)).toHaveLength(FONT_HEIGHT);
  });

  it('draws each piped line, or its own name with nothing to draw', async () => {
    const piped = await runLine("printf 'ab\\ncd\\n' | figlet", { tty: false });
    expect(rows(piped.stdoutPlain)).toHaveLength(FONT_HEIGHT * 2 + 1);
    expect((await runLine('figlet')).stdoutPlain).toBe(figlet('vesen', { width: 80, align: 'left' }));
  });

  it('centres with -c and right-aligns with -r', async () => {
    expect((await runLine('figlet -c -w 40 hi', { tty: false })).stdoutPlain).toBe(figlet('hi', { width: 40, align: 'center' }));
    expect((await runLine('figlet -r -w 40 hi', { tty: false })).stdoutPlain).toBe(figlet('hi', { width: 40, align: 'right' }));
  });

  it('refuses a width under 1', async () => {
    expect(await runLine('figlet -w 0 hi', { tty: false })).toMatchObject({ status: 1, stderrPlain: "figlet: invalid width '0'\nTry 'figlet --help' for more information." });
  });
});
