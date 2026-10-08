// seq, nl, fold and column against their Linux behaviour: steps, formats and widths; numbering
// styles and formats; wrapping at a width or at blanks; tables and filled columns.
import { describe, expect, it } from 'vitest';
import { runLine } from '../../../../tests/harness';
import { fill, table } from './column.run';
import { foldLine } from './fold.run';
import { checkFormat } from './seq.run';

const pipe = { tty: false } as const;
const out = async (line: string): Promise<string> => (await runLine(line, pipe)).stdoutPlain;

describe('seq', () => {
  it.each([
    ['seq 3', '1\n2\n3'],
    ['seq 2 4', '2\n3\n4'],
    ['seq 2 2 10', '2\n4\n6\n8\n10'],
    ['seq 5 -2 1', '5\n3\n1'],
    ['seq -2 0', '-2\n-1\n0'],
    ['seq 3 1', ''],
    ['seq -s , 4', '1,2,3,4'],
    ["seq -s ' ' 10 -2 0", '10 8 6 4 2 0'],
    ['seq -w 8 11', '08\n09\n10\n11'],
    ['seq -w -1 1', '-1\n00\n01'],
    ['seq 1 0.5 3', '1.0\n1.5\n2.0\n2.5\n3.0'],
    ['seq 0.1 0.1 0.5', '0.1\n0.2\n0.3\n0.4\n0.5'],
    ['seq 1e2 1e2 3e2', '100\n200\n300'],
    ['seq -f %03g 3', '001\n002\n003'],
    ['seq -f %.2f 0 0.25 1', '0.00\n0.25\n0.50\n0.75\n1.00'],
    ["seq -f 'n=%g' 2", 'n=1\nn=2'],
    ['seq -f %e 1 1', '1.000000e+00'],
    ['seq 99999999999999999998 99999999999999999999', '99999999999999999998\n99999999999999999999'],
  ])('%s', async (line, expected) => {
    expect(await out(line)).toBe(expected);
  });

  it.each([
    ['seq', "seq: missing operand\nTry 'seq --help' for more information."],
    ['seq a', "seq: invalid floating point argument: 'a'\nTry 'seq --help' for more information."],
    ['seq 1 0 5', "seq: invalid Zero increment value: '0'\nTry 'seq --help' for more information."],
    ['seq 1 2 3 4', "seq: extra operand '4'\nTry 'seq --help' for more information."],
    ['seq -f %d 3', "seq: format '%d' has unknown %d directive"],
    ['seq -f x 3', "seq: format 'x' has no % directive"],
    ['seq -f %g%g 3', "seq: format '%g%g' has too many % directives"],
  ])('%s fails with status 1', async (line, message) => {
    expect(await runLine(line, pipe)).toMatchObject({ status: 1, stderrPlain: message });
  });

  it('checks a format for one floating-point directive', () => {
    expect(checkFormat('%5.1f%%')).toBeNull();
    expect(checkFormat('%s')).toBe("format '%s' has unknown %s directive");
  });

  it('ends a pipe at once, however far it would count', async () => {
    expect(await runLine('seq 1000000000 | head -n 2', pipe)).toMatchObject({ status: 0, stdoutPlain: '1\n2' });
  });
});

describe('nl', () => {
  it.each([
    ['seq 3 | nl', '     1\t1\n     2\t2\n     3\t3'],
    ["printf 'a\\n\\nb\\n' | nl", '     1\ta\n       \n     2\tb'],
    ["printf 'a\\n\\nb\\n' | nl -ba", '     1\ta\n     2\t\n     3\tb'],
    ["printf 'a\\n\\nb\\n' | nl -bn", '       a\n       \n       b'],
    ["printf 'apple\\nberry\\n' | nl -bp^b", '       apple\n     1\tberry'],
    ["printf 'a\\nb\\n' | nl -nln -w3 -s'|'", '1  |a\n2  |b'],
    ["printf 'a\\nb\\n' | nl -nrz -w3", '001\ta\n002\tb'],
    ["printf 'a\\nb\\n' | nl -v10 -i5", '    10\ta\n    15\tb'],
    ["printf 'a\\n\\\\:\\\\:\\\\:\\nb\\n' | nl", '     1\ta\n\n       b'],
  ])('%s', async (line, expected) => {
    expect(await out(line)).toBe(expected);
  });

  it('words its errors as GNU does', async () => {
    expect(await runLine('nl -b x .profile', pipe)).toMatchObject({ status: 1, stderrPlain: "nl: invalid body numbering style: 'x'\nTry 'nl --help' for more information." });
    expect(await runLine('nl -n xx .profile', pipe)).toMatchObject({ status: 1, stderrPlain: "nl: invalid line numbering format: 'xx'\nTry 'nl --help' for more information." });
    expect(await runLine('nl nope', pipe)).toMatchObject({ status: 1, stderrPlain: 'nl: nope: No such file or directory' });
  });
});

describe('fold', () => {
  it.each([
    ['echo abcdefghij | fold -w 3', 'abc\ndef\nghi\nj'],
    ['echo abcdefghij | fold -3', 'abc\ndef\nghi\nj'],
    ["echo 'hello there world' | fold -s -w 8", 'hello \nthere \nworld'],
    ["echo 'hello there world' | fold -w 8", 'hello th\nere worl\nd'],
    ["echo 'averyverylongword x' | fold -s -w 5", 'avery\nveryl\nongwo\nrd x'],
    // A tab wider than what is left goes to the next line, alone when it fills one, as in GNU fold.
    ["printf 'ab\\tc\\n' | fold -w 4", 'ab\n\t\nc'],
    ["echo 'héllo' | fold -b -w 2", 'h\né\nll\no'],
    ["printf 'abc' | fold -w 2", 'ab\nc'],
  ])('%s', async (line, expected) => {
    expect(await out(line)).toBe(expected);
  });

  it('folds one line as GNU fold does', () => {
    expect(foldLine('abcdef', 2, false, false)).toBe('ab\ncd\nef');
    expect(foldLine('ab cd ef', 5, true, false)).toBe('ab \ncd ef');
    expect(foldLine('', 5, false, false)).toBe('');
  });

  it('refuses a width that is not a positive number', async () => {
    expect(await runLine('fold -w 0 .profile', pipe)).toMatchObject({ status: 1, stderrPlain: "fold: invalid number of columns: '0'" });
    expect(await runLine('fold -w x .profile', pipe)).toMatchObject({ status: 1, stderrPlain: "fold: invalid number of columns: 'x'" });
  });
});

describe('column', () => {
  it.each([
    ["printf 'a b c\\nlonger x y\\n' | column -t", 'a       b  c\nlonger  x  y'],
    ["printf 'a:b\\ncc:d\\n' | column -t -s :", 'a   b\ncc  d'],
    ["printf 'a:b\\ncc:d\\n' | column -t -s : -o ' | '", 'a  | b\ncc | d'],
    ["printf 'a::c\\n' | column -t -s :", 'a    c'],
    ["printf 'x\\n\\ny\\n' | column -t", 'x\ny'],
    ['seq 12 | column -c 40', '1       4       7       10\n2       5       8       11\n3       6       9       12'],
    ['seq 12 | column -c 40 -x', '1       2       3       4       5\n6       7       8       9       10\n11      12'],
    ['seq 3 | column -c 4', '1\n2\n3'],
  ])('%s', async (line, expected) => {
    expect(await out(line)).toBe(expected);
  });

  it('fills the width of the terminal by default', async () => {
    const narrow = await runLine('seq 30 | column', { cols: 40 });
    expect(narrow.stdoutPlain.split('\n')).toHaveLength(6);
    const wide = await runLine('seq 30 | column', { cols: 80 });
    expect(wide.stdoutPlain.split('\n')).toHaveLength(3);
  });

  // Before, Math.max(...entries) ran out of stack on a long list, and -c's width made that many
  // columns to loop over, so `seq 3 | column -c 1000000000000` did not come back.
  it('fills a long list, and any width, quickly', async () => {
    const started = performance.now();
    expect((await runLine('seq 300000 | column -c 80 | tail -n 1', pipe)).stdoutPlain).toBe('30000   60000   90000   120000  150000  180000  210000  240000  270000  300000');
    expect(await out('seq 3 | column -c 1000000000000')).toBe('1       2       3');
    expect(performance.now() - started).toBeLessThan(10_000);
  });

  it('lays out tables and lists', () => {
    expect(table([['a', 'bb'], ['ccc', 'd']], '  ')).toBe('a    bb\nccc  d\n');
    expect(fill([], 80, false)).toBe('');
    expect(fill(['a', 'b', 'c'], 80, false)).toBe('a       b       c\n');
  });
});
