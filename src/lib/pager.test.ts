// The pager's model: lines as less shows them, wrapped at the edge; less's keys; moving within
// the text; and searching for text as typed, with every match marked for highlighting.
import { describe, expect, it } from 'vitest';
import type { Line } from '../output/model';
import {
  asPagerView,
  clampTop,
  findLine,
  firstRowOf,
  matchRanges,
  maxTop,
  moveTop,
  PAGER_HELP,
  pagerCommand,
  percentThrough,
  prepareLines,
  segments,
  wrapRows,
} from './pager';

const plainLines = (...texts: string[]): Line[] => texts.map((text) => [{ text }]);

describe('lines', () => {
  it('expands tabs to the next multiple of eight columns and drops other control characters', () => {
    const [line] = prepareLines([[{ text: 'a\tb' }, { text: '\u0007c\td', style: { bold: true } }]]);
    expect(line?.text).toBe('a       bc      d');
    expect(line?.pieces).toEqual([{ text: 'a       b' }, { text: 'c      d', style: { bold: true } }]);
  });

  it('keeps styles and leaves out links and actions, which a pager does not follow', () => {
    const [line] = prepareLines([[{ text: 'see', style: { fg: 'accent' }, href: 'https://vesen.app' as never }]]);
    expect(line?.pieces).toEqual([{ text: 'see', style: { fg: 'accent' } }]);
  });

  it('wraps at the last column, across styles, and keeps an empty line as one row', () => {
    const rows = wrapRows(prepareLines([[{ text: 'abcd' }, { text: 'efg', style: { bold: true } }], [], [{ text: 'xy' }]]), 3);
    expect(rows.map((row) => row.pieces.map((piece) => piece.text).join('|'))).toEqual(['abc', 'd|ef', 'g', '', 'xy']);
    expect(rows.map((row) => [row.line, row.start, row.end])).toEqual([
      [0, 0, 3],
      [0, 3, 6],
      [0, 6, 7],
      [1, 0, 0],
      [2, 0, 2],
    ]);
    expect(rows[1]?.pieces[1]?.style).toEqual({ bold: true });
  });

  it('counts an emoji as one column and never splits it', () => {
    const rows = wrapRows(prepareLines(plainLines('😀😀😀')), 2);
    expect(rows.map((row) => row.pieces[0]?.text)).toEqual(['😀😀', '😀']);
    expect(rows[1]?.start).toBe(4);
  });

  it("finds each line's first row", () => {
    const rows = wrapRows(prepareLines(plainLines('aaaaaa', 'b', 'cccc')), 2);
    expect([0, 1, 2].map((line) => firstRowOf(rows, line))).toEqual([0, 3, 4]);
  });
});

describe('searching', () => {
  it('ignores case unless the text has a capital, or always with -i', () => {
    expect(matchRanges('Theme theme THEME', 'theme')).toEqual([
      [0, 5],
      [6, 11],
      [12, 17],
    ]);
    expect(matchRanges('Theme theme THEME', 'Theme')).toEqual([[0, 5]]);
    expect(matchRanges('Theme theme THEME', 'Theme', true)).toHaveLength(3);
  });

  it('looks for the text as typed, never a pattern', () => {
    expect(matchRanges('a+b (a+)+ .*', '(a+)+')).toEqual([[4, 9]]);
    expect(matchRanges('anything', '.*')).toEqual([]);
    expect(matchRanges('aaaa', 'aa')).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(matchRanges('text', '')).toEqual([]);
  });

  it('finds the next line forwards or backwards, from the line given, and never wraps round', () => {
    const lines = prepareLines(plainLines('one', 'two', 'three', 'two'));
    expect(findLine(lines, 'two', 0, 1)).toBe(1);
    expect(findLine(lines, 'two', 2, 1)).toBe(3);
    expect(findLine(lines, 'two', 2, -1)).toBe(1);
    expect(findLine(lines, 'two', 4, 1)).toBeNull();
    expect(findLine(lines, 'one', 1, 1)).toBeNull();
    expect(findLine(lines, 'TWO', 0, 1)).toBeNull();
    expect(findLine(lines, 'TWO', 0, 1, true)).toBe(1);
  });

  it('marks the matches in a row, one that runs on from the row before included', () => {
    const lines = prepareLines([[{ text: 'say ' }, { text: 'hello', style: { bold: true } }, { text: ' hello' }]]);
    const rows = wrapRows(lines, 6);
    const ranges = matchRanges(lines[0]?.text ?? '', 'hello');
    expect(segments(rows[0]!, ranges)).toEqual([
      { text: 'say ', hit: false },
      { text: 'he', style: { bold: true }, hit: true },
    ]);
    expect(segments(rows[1]!, ranges)).toEqual([
      { text: 'llo', style: { bold: true }, hit: true },
      { text: ' ', hit: false },
      { text: 'he', hit: true },
    ]);
    expect(segments(rows[2]!, ranges)).toEqual([{ text: 'llo', hit: true }]);
    expect(segments(rows[0]!, [])).toEqual([
      { text: 'say ', hit: false },
      { text: 'he', style: { bold: true }, hit: false },
    ]);
  });
});

describe('keys and moving', () => {
  it("gives less's keys their meaning, and leaves the browser's shortcuts alone", () => {
    const meaning = (key: string, mods: { ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean } = {}) => pagerCommand({ key, ...mods });
    expect(['q', 'Q', 'Escape'].map((key) => meaning(key))).toEqual(['quit', 'quit', 'quit']);
    expect([' ', 'f', 'PageDown'].map((key) => meaning(key))).toEqual(['pageDown', 'pageDown', 'pageDown']);
    expect(meaning('f', { ctrlKey: true })).toBe('pageDown');
    expect(['b', 'PageUp'].map((key) => meaning(key))).toEqual(['pageUp', 'pageUp']);
    expect(meaning('v', { altKey: true })).toBe('pageUp');
    expect(['j', 'ArrowDown', 'Enter'].map((key) => meaning(key))).toEqual(['lineDown', 'lineDown', 'lineDown']);
    expect(['k', 'ArrowUp'].map((key) => meaning(key))).toEqual(['lineUp', 'lineUp']);
    expect([meaning('d'), meaning('u'), meaning('d', { ctrlKey: true })]).toEqual(['halfDown', 'halfUp', 'halfDown']);
    expect([meaning('g'), meaning('<'), meaning('Home'), meaning('G'), meaning('>'), meaning('End')]).toEqual(['top', 'top', 'top', 'bottom', 'bottom', 'bottom']);
    expect([meaning('/'), meaning('?'), meaning('n'), meaning('N'), meaning('h')]).toEqual(['searchForward', 'searchBackward', 'next', 'previous', 'help']);
    expect(meaning('c', { metaKey: true })).toBeNull();
    expect(meaning('c', { ctrlKey: true })).toBeNull();
    expect(meaning('x')).toBeNull();
    expect(meaning('constructor')).toBeNull();
  });

  it('moves a line, half a screen or a screen, and stops where the last screen shows the end', () => {
    // 100 rows, 10 on the screen: the top row goes from 0 to 90.
    expect(maxTop(100, 10)).toBe(90);
    expect(moveTop(0, 'lineDown', 10, 100)).toBe(1);
    expect(moveTop(0, 'lineUp', 10, 100)).toBe(0);
    expect(moveTop(0, 'pageDown', 10, 100)).toBe(10);
    expect(moveTop(85, 'pageDown', 10, 100)).toBe(90);
    expect(moveTop(50, 'pageUp', 10, 100)).toBe(40);
    expect(moveTop(50, 'halfDown', 10, 100)).toBe(55);
    expect(moveTop(50, 'halfUp', 10, 100)).toBe(45);
    expect(moveTop(50, 'top', 10, 100)).toBe(0);
    expect(moveTop(0, 'bottom', 10, 100)).toBe(90);
    expect(moveTop(50, 'help', 10, 100)).toBe(50);
    // Shorter than the screen: it never moves.
    expect(moveTop(0, 'pageDown', 10, 4)).toBe(0);
    expect(clampTop(-3, 100, 10)).toBe(0);
  });

  it('says how far through the bottom of the screen is', () => {
    expect(percentThrough(0, 10, 100)).toBe(10);
    expect(percentThrough(45, 10, 100)).toBe(55);
    expect(percentThrough(90, 10, 100)).toBe(100);
    expect(percentThrough(0, 10, 4)).toBe(100);
    expect(percentThrough(0, 10, 0)).toBe(100);
  });

  it('has a help page that fits a phone', () => {
    expect(Math.max(...PAGER_HELP.map((line) => line.length))).toBeLessThanOrEqual(42);
  });
});

describe('the view', () => {
  it('reads what a command hands over, defensively', () => {
    expect(asPagerView({ title: 'README.md', lines: plainLines('a'), mode: 'more', touch: true, columns: 40, rows: 20, numbers: true, note: 'cut' })).toEqual({
      title: 'README.md',
      lines: plainLines('a'),
      mode: 'more',
      touch: true,
      columns: 40,
      rows: 20,
      numbers: true,
      ignoreCase: false,
      note: 'cut',
    });
    expect(asPagerView({ lines: [[{ text: 'ok' }, { nope: 1 }], 'not a line', null], columns: -1, rows: Number.NaN })).toEqual({
      title: '(standard input)',
      lines: [[{ text: 'ok' }]],
      mode: 'less',
      touch: false,
      columns: 80,
      rows: 24,
      numbers: false,
      ignoreCase: false,
    });
    expect(asPagerView(null).lines).toEqual([]);
  });
});
