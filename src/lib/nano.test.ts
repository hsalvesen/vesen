// The editor's model: nano's line counts and messages, cutting and pasting whole lines, finding
// text as typed with wrap-round, and where the caret is.
import { describe, expect, it } from 'vitest';
import {
  asEditorView,
  countLines,
  cutLine,
  EDITOR_HELP,
  findMessage,
  findNext,
  lineAt,
  linesMessage,
  location,
  offsetOf,
  pasteAt,
  withFinalNewline,
} from './nano';

describe('lines', () => {
  it('counts lines as nano does, a last line without a newline included', () => {
    expect(['', 'a', 'a\n', 'a\nb', 'a\nb\n', '\n'].map(countLines)).toEqual([0, 1, 1, 2, 2, 1]);
    expect(linesMessage('Read', 1)).toBe('[ Read 1 line ]');
    expect(linesMessage('Wrote', 12)).toBe('[ Wrote 12 lines ]');
  });

  it('ends a written file with a newline, unless it is empty', () => {
    expect(['', 'a', 'a\n'].map(withFinalNewline)).toEqual(['', 'a\n', 'a\n']);
  });

  it("finds the caret's line", () => {
    expect(lineAt('one\ntwo\nthree', 5)).toEqual({ start: 4, end: 7 });
    expect(lineAt('one\ntwo\nthree', 4)).toEqual({ start: 4, end: 7 });
    expect(lineAt('one\ntwo\nthree', 3)).toEqual({ start: 0, end: 3 });
    expect(lineAt('one\n', 4)).toEqual({ start: 4, end: 4 });
  });

  it('finds a line and column, kept inside the text', () => {
    expect(offsetOf('one\ntwo\nthree', 2)).toBe(4);
    expect(offsetOf('one\ntwo\nthree', 3, 3)).toBe(10);
    expect(offsetOf('one\ntwo\nthree', 2, 99)).toBe(7);
    expect(offsetOf('one\ntwo', 99)).toBe(4);
  });
});

describe('cutting and pasting', () => {
  it('cuts the whole line the caret is on, newline and all', () => {
    expect(cutLine('one\ntwo\nthree', 5)).toEqual({ text: 'one\nthree', caret: 4, cut: 'two\n' });
    expect(cutLine('one\ntwo\nthree', 0)).toEqual({ text: 'two\nthree', caret: 0, cut: 'one\n' });
  });

  it('cuts a last line with no newline as a whole line, and nothing on the empty line after the end', () => {
    expect(cutLine('one\nlast', 6)).toEqual({ text: 'one\n', caret: 4, cut: 'last\n' });
    expect(cutLine('one\n', 4)).toEqual({ text: 'one\n', caret: 4, cut: '' });
    expect(cutLine('', 0)).toEqual({ text: '', caret: 0, cut: '' });
  });

  it('pastes at the caret and leaves it after what was pasted', () => {
    expect(pasteAt('one\nthree', 4, 'two\n')).toEqual({ text: 'one\ntwo\nthree', caret: 8 });
    expect(pasteAt('', 3, 'x\n')).toEqual({ text: 'x\n', caret: 2 });
  });
});

describe('finding', () => {
  it('finds the next match after the caret, ignoring case, and goes round past the end', () => {
    const text = 'alpha beta Alpha gamma';
    expect(findNext(text, 'alpha', 0)).toEqual({ kind: 'found', index: 11, wrapped: false });
    expect(findNext(text, 'ALPHA', 11)).toEqual({ kind: 'found', index: 0, wrapped: true });
    expect(findNext(text, 'beta', 6)).toEqual({ kind: 'only', index: 6 });
    expect(findNext(text, 'delta', 0)).toEqual({ kind: 'none' });
    expect(findNext(text, '', 0)).toEqual({ kind: 'none' });
  });

  it('looks for the text as typed, never a pattern', () => {
    expect(findNext('a.b (x+)+', '(x+)+', 0)).toEqual({ kind: 'found', index: 4, wrapped: false });
    expect(findNext('abc', '.', 0)).toEqual({ kind: 'none' });
  });

  it("says what nano says about a search", () => {
    expect(findMessage({ kind: 'none' }, 'delta')).toBe('[ "delta" not found ]');
    expect(findMessage({ kind: 'only', index: 0 }, 'x')).toBe('[ This is the only occurrence ]');
    expect(findMessage({ kind: 'found', index: 0, wrapped: true }, 'x')).toBe('[ Search Wrapped ]');
    expect(findMessage({ kind: 'found', index: 3, wrapped: false }, 'x')).toBe('');
  });

  it('says where the caret is, as ^C does', () => {
    expect(location('one\ntwo\nthree', 5)).toBe('[ line 2/3 (66%), col 2/4 (50%), char 5/13 (38%) ]');
    expect(location('', 0)).toBe('[ line 1/1 (100%), col 1/1 (100%), char 0/0 (0%) ]');
  });
});

describe('the view', () => {
  it('reads what the command hands over, and needs a way to save', () => {
    const save = () => ({ ok: true as const, name: 'x', message: '' });
    expect(asEditorView({ name: 'notes.txt', text: 'hi', message: '[ Read 1 line ]', touch: true, line: 2, column: 0, save })).toEqual({
      name: 'notes.txt',
      text: 'hi',
      message: '[ Read 1 line ]',
      touch: true,
      line: 2,
      save,
    });
    expect(asEditorView({ name: '', text: 3, save })).toMatchObject({ name: null, text: '', message: '', touch: false });
    expect(asEditorView({ name: 'x', text: '' })).toBeNull();
    expect(asEditorView(undefined)).toBeNull();
  });

  it('has help that fits a phone', () => {
    expect(Math.max(...EDITOR_HELP.map((line) => line.length))).toBeLessThanOrEqual(44);
  });
});
