// sort and uniq against GNU coreutils' behaviour: orderings, keys and separators, stability,
// -u and -c, the C locale, uniq's groups and skips, the error wording and the exit status.
import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../../tests/harness';
import { numericValue, versionCompare } from './sort.run';
import { compareKey } from './uniq.run';

const pipe = { tty: false } as const;
const out = async (line: string): Promise<string> => (await runLine(line, pipe)).stdoutPlain;

describe('sort', () => {
  it.each([
    ["printf 'b\\na\\nc\\n' | sort", 'a\nb\nc'],
    ["printf 'b\\na\\nc\\n' | sort -r", 'c\nb\na'],
    // The locale's order: case only breaks ties, lower case first.
    ["printf 'B\\na\\nC\\nb\\n' | sort", 'a\nb\nB\nC'],
    ["printf 'B\\na\\nC\\nb\\n' | LC_ALL=C sort", 'B\nC\na\nb'],
    ["printf 'b\\nB\\na\\n' | sort -f", 'a\nb\nB'],
    ["printf '10\\n9\\n100\\n-1\\n' | sort", '-1\n10\n100\n9'],
    ["printf '10\\n9\\n100\\n-1\\n' | sort -n", '-1\n9\n10\n100'],
    ['seq 10 | sort -rn | head -3', '10\n9\n8'],
    ["printf '1,000\\n2\\n.5\\nx\\n' | sort -n", 'x\n.5\n2\n1,000'],
    ["printf '1.5K\\n200\\n3M\\n1G\\n10K\\n' | sort -h", '200\n1.5K\n10K\n3M\n1G'],
    ["printf '1e3\\n5\\n-inf\\n' | sort -g", '-inf\n5\n1e3'],
    ["printf 'MAR\\nJan\\nfeb\\nxyz\\n' | sort -M", 'xyz\nJan\nfeb\nMAR'],
    ["printf 'v1.10\\nv1.9\\nv1.2\\n' | sort -V", 'v1.2\nv1.9\nv1.10'],
    ["printf 'x\\ny\\nx\\n' | sort -u", 'x\ny'],
    ["printf 'a\\nA\\nb\\n' | sort -fu", 'a\nb'],
    ["printf 'b 2\\na 10\\nc 1\\n' | sort -k2n", 'c 1\nb 2\na 10'],
    ["printf 'b 2\\na 10\\nc 1\\n' | sort -k2", 'c 1\na 10\nb 2'],
    ["printf 'a:3\\nb:1\\nc:2\\n' | sort -t: -k2 -n", 'b:1\nc:2\na:3'],
    ["printf 'a:3\\nb:1\\nc:2\\n' | sort -t : -k 2,2nr", 'a:3\nc:2\nb:1'],
    ["printf 'x 1 b\\ny 1 a\\nz 0 c\\n' | sort -k2,2n -k3", 'z 0 c\ny 1 a\nx 1 b'],
    ["printf 'ab\\nba\\naa\\n' | sort -k1.2", 'aa\nba\nab'],
    ["printf '  b\\na\\n' | sort -b", 'a\n  b'],
    // Equal keys keep their input order with -s; without it the whole line breaks the tie.
    ["printf 'b 1\\na 1\\n' | sort -s -k2,2", 'b 1\na 1'],
    ["printf 'b 1\\na 1\\n' | sort -k2,2", 'a 1\nb 1'],
    ["printf 'a\\nb' | sort", 'a\nb'],
    ["printf '' | sort", ''],
  ])('%s', async (line, expected) => {
    expect(await out(line)).toBe(expected);
  });

  it('sorts files together, and writes -o to one of them', async () => {
    const s = await session(pipe);
    await s.run("printf 'b\\nd\\n' > one; printf 'c\\na\\n' > two");
    expect((await s.run('sort one two')).stdoutPlain).toBe('a\nb\nc\nd');
    expect((await s.run('sort -o one one two')).stdoutPlain).toBe('');
    expect(s.app.vfs.readFile('/home/guest/one')).toBe('a\nb\nc\nd\n');
    s.stop();
  });

  it('checks the order with -c and -C', async () => {
    expect(await runLine("printf 'a\\nb\\n' | sort -c", pipe)).toMatchObject({ status: 0, stderrPlain: '' });
    expect(await runLine("printf 'b\\na\\n' | sort -c", pipe)).toMatchObject({ status: 1, stderrPlain: 'sort: -:2: disorder: a' });
    expect(await runLine("printf 'b\\na\\n' | sort -C", pipe)).toMatchObject({ status: 1, stderrPlain: '' });
    expect(await runLine("printf 'a\\na\\n' | sort -cu", pipe)).toMatchObject({ status: 1, stderrPlain: 'sort: -:2: disorder: a' });
  });

  it.each([
    ['sort nope', 'sort: cannot read: nope: No such file or directory'],
    ['sort documents', 'sort: read failed: documents: Is a directory'],
    ['sort -k 0 .profile', "sort: field number is zero: invalid field specification '0'"],
    ['sort -k 1.0 .profile', "sort: character offset is zero: invalid field specification '1.0'"],
    ['sort -k x .profile', "sort: invalid number at field start: invalid count at start of 'x'"],
    ['sort -t ab .profile', "sort: multi-character tab 'ab'"],
    ['sort -n -M .profile', "sort: options '-nM' are incompatible\nTry 'sort --help' for more information."],
  ])('%s fails with status 2', async (line, message) => {
    expect(await runLine(line, pipe)).toMatchObject({ status: 2, stderrPlain: message });
  });

  it('reads numbers and versions as GNU sort does', () => {
    expect(numericValue('  -12.5abc')).toBe(-12.5);
    expect(numericValue('1,234')).toBe(1234);
    expect(numericValue('abc')).toBe(0);
    expect(versionCompare('a1.2', 'a1.10')).toBeLessThan(0);
    expect(versionCompare('1.0~rc1', '1.0')).toBeLessThan(0);
    expect(versionCompare('007', '7')).toBe(0);
  });
});

describe('uniq', () => {
  it.each([
    ["printf 'a\\na\\nb\\na\\n' | uniq", 'a\nb\na'],
    ["printf 'a\\na\\nb\\nc\\nc\\nc\\n' | uniq -c", '      2 a\n      1 b\n      3 c'],
    ["printf 'a\\na\\nb\\nc\\nc\\nc\\n' | uniq -d", 'a\nc'],
    ["printf 'a\\na\\nb\\nc\\nc\\nc\\n' | uniq -u", 'b'],
    ["printf 'a\\na\\nb\\nc\\nc\\n' | uniq -D", 'a\na\nc\nc'],
    ["printf 'Hi\\nhi\\nHI\\n' | uniq -i", 'Hi'],
    ["printf 'Hi\\nhi\\n' | uniq", 'Hi\nhi'],
    ["printf 'x a\\ny a\\nz b\\n' | uniq -f1 -c", '      2 x a\n      1 z b'],
    ["printf 'aXb\\naYb\\n' | uniq -s 2", 'aXb'],
    ["printf 'abX\\nabY\\n' | uniq -w 2", 'abX'],
    ["printf 'b\\na\\nb\\n' | sort | uniq -c", '      1 a\n      2 b'],
    ["printf 'a\\na' | uniq", 'a'],
  ])('%s', async (line, expected) => {
    expect(await out(line)).toBe(expected);
  });

  it('writes OUTPUT, reads INPUT, and words its errors as GNU does', async () => {
    const s = await session(pipe);
    await s.run("printf 'a\\na\\nb\\n' > in.txt");
    expect(await s.run('uniq in.txt out.txt')).toMatchObject({ status: 0, stdoutPlain: '' });
    expect(s.app.vfs.readFile('/home/guest/out.txt')).toBe('a\nb\n');
    expect(await s.run('uniq nope')).toMatchObject({ status: 1, stderrPlain: 'uniq: nope: No such file or directory' });
    expect(await s.run('uniq a b c')).toMatchObject({ status: 1, stderrPlain: "uniq: extra operand 'c'\nTry 'uniq --help' for more information." });
    expect(await s.run('uniq -c -D in.txt')).toMatchObject({ status: 1 });
    s.stop();
  });

  it('compares the part of a line after the skipped fields and characters', () => {
    expect(compareKey('one  two three', 1, 0, -1, false)).toBe('  two three');
    expect(compareKey('one two', 0, 2, 3, false)).toBe('e t');
    expect(compareKey('ABC', 0, 0, -1, true)).toBe('abc');
  });
});
