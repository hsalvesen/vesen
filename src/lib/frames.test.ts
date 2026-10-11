// The frames file (sudo's show): the header's numbers, frames of rows × cols characters with rows
// padded or cut to fit, any character allowed; and the ways a file is malformed or over its caps,
// each of which reads as null so the drawn dancer plays.
import { describe, expect, it } from 'vitest';
import { FRAMES_MAX_CHARS, FRAMES_MAX_FRAMES, parseFramesFile, parseFramesHeader } from './frames';

const HEADER = 'vesen-frames fps=12 cols=3 rows=2';
/** Two frames: a short row padded and a long one cut, then a mostly blank one. */
const FILE = [HEADER, 'ab', 'cdef', '===', ' x ', '   ', ''].join('\n');

describe('parseFramesHeader', () => {
  it('reads fps, cols and rows in any order, ignoring what it does not know', () => {
    expect(parseFramesHeader(HEADER)).toEqual({ fps: 12, cols: 3, rows: 2 });
    expect(parseFramesHeader('vesen-frames rows=17 cols=60 fps=12.5 made=ffmpeg')).toEqual({ fps: 12.5, cols: 60, rows: 17 });
    expect(parseFramesHeader('  vesen-frames   FPS=1  Cols=1 ROWS=1  ')).toEqual({ fps: 1, cols: 1, rows: 1 });
  });

  it('is null for another file, a missing number, a bad one or one out of bounds', () => {
    for (const line of [
      '',
      '<!doctype html>',
      'vesen-frame fps=12 cols=3 rows=2',
      'vesen-frames fps=12 cols=3',
      'vesen-frames fps=12 cols=3 rows=two',
      'vesen-frames fps=12 cols=3 rows=2 extra',
      'vesen-frames fps=0 cols=3 rows=2',
      'vesen-frames fps=-12 cols=3 rows=2',
      'vesen-frames fps=121 cols=3 rows=2',
      'vesen-frames fps=12 cols=401 rows=2',
      'vesen-frames fps=12 cols=3 rows=201',
      'vesen-frames fps=12 cols=2.5 rows=2',
      'vesen-frames fps=1e3 cols=3 rows=2',
    ]) {
      expect(parseFramesHeader(line), line).toBeNull();
    }
  });
});

describe('parseFramesFile', () => {
  it('reads the frames, each row padded or cut to cols, as text and as one span a row', () => {
    const file = parseFramesFile(FILE);
    expect(file).not.toBeNull();
    expect(file).toMatchObject({ fps: 12, cols: 3, rows: 2 });
    expect(file?.frames).toHaveLength(2);
    expect(file?.frames[0]?.text).toBe('ab \ncde');
    expect(file?.frames[0]?.rows).toEqual([[{ text: 'ab ', role: 'fg' }], [{ text: 'cde', role: 'fg' }]]);
    expect(file?.frames[1]?.text).toBe(' x \n   ');
  });

  it('takes Windows line ends, a trailing separator, and blank lines after the last frame', () => {
    expect(parseFramesFile(FILE.replace(/\n/g, '\r\n'))?.frames[1]?.text).toBe(' x \n   ');
    expect(parseFramesFile(`${FILE}===\n`)?.frames).toHaveLength(2);
    expect(parseFramesFile(`${FILE}===\n\n\n`)?.frames).toHaveLength(2);
    expect(parseFramesFile(`${FILE}\n\n`)?.frames).toHaveLength(2);
    expect(parseFramesFile(FILE.replace(/\n$/, ''))?.frames).toHaveLength(2);
  });

  it('counts characters, not bytes: any character is a cell', () => {
    const file = parseFramesFile(['vesen-frames fps=1 cols=3 rows=1', '━▀😀', '===', 'a\tb'].join('\n'));
    expect(file?.frames.map((frame) => frame.text)).toEqual(['━▀😀', 'a\tb']);
  });

  it('is null for a bad header, a frame with the wrong number of rows, or no frames at all', () => {
    expect(parseFramesFile('')).toBeNull();
    expect(parseFramesFile('<!doctype html>\n<html></html>')).toBeNull();
    expect(parseFramesFile(HEADER)).toBeNull();
    expect(parseFramesFile(`${HEADER}\n`)).toBeNull();
    expect(parseFramesFile([HEADER, 'ab', '===', 'cd', 'ef', ''].join('\n'))).toBeNull();
    expect(parseFramesFile([HEADER, 'ab', 'cd', 'ef', '===', 'gh', 'ij', ''].join('\n'))).toBeNull();
    expect(parseFramesFile([HEADER, 'ab', 'cd', '===', 'ef', ''].join('\n'))).toBeNull();
  });

  it('refuses a file over the size cap, and keeps only the first 10,000 frames', () => {
    const one = 'vesen-frames fps=1 cols=1 rows=1\n';
    expect(parseFramesFile(`${one}x\n${' '.repeat(FRAMES_MAX_CHARS)}`)).toBeNull();
    const many = parseFramesFile(one + 'x\n===\n'.repeat(FRAMES_MAX_FRAMES + 5));
    expect(many?.frames).toHaveLength(FRAMES_MAX_FRAMES);
    expect(parseFramesFile(`${one}${'x\n===\n'.repeat(3)}x`)?.frames).toHaveLength(4);
  });

  it('never throws on what it is given', () => {
    for (const bad of [null, undefined, 12, {}, [], '\u0000', '===\n===\n']) {
      expect(parseFramesFile(bad as unknown as string)).toBeNull();
    }
  });
});
