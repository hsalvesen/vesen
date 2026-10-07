// cut and tr against GNU coreutils' behaviour: lists and ranges, delimiters, --complement and
// -s; sets, ranges, classes, [c*n], -d -s -c and -t; the error wording and the exit status.
import { describe, expect, it } from 'vitest';
import { runLine } from '../../../../tests/harness';
import { readList } from './cut.run';
import { expand, parseSet } from './tr.run';

const pipe = { tty: false } as const;
const out = async (line: string): Promise<string> => (await runLine(line, pipe)).stdoutPlain;

describe('cut', () => {
  it.each([
    ["echo 'a:b:c:d' | cut -d: -f2", 'b'],
    ["echo 'a:b:c:d' | cut -d: -f2-3", 'b:c'],
    ["echo 'a:b:c:d' | cut -d: -f3-", 'c:d'],
    ["echo 'a:b:c:d' | cut -d: -f-2", 'a:b'],
    ["echo 'a:b:c:d' | cut -d: -f3,1", 'a:c'],
    ["echo 'a:b:c:d' | cut -d: -f2 --complement", 'a:c:d'],
    ["echo 'a:b:c:d' | cut -d: -f1,3 --output-delimiter=' '", 'a c'],
    ["echo 'a:b' | cut -d: -f5", ''],
    ["printf 'a\\tb\\n' | cut -f2", 'b'],
    ["printf 'a:b\\nnodelim\\n' | cut -d: -f2", 'b\nnodelim'],
    ["printf 'a:b\\nnodelim\\n' | cut -d: -f2 -s", 'b'],
    ["echo 'abcdef' | cut -c2-4,6", 'bcdf'],
    ["echo 'abcdef' | cut -c-2", 'ab'],
    ["echo 'abcdef' | cut -c5-", 'ef'],
    ["echo 'abcdef' | cut -b1,1,2", 'ab'],
    ["echo 'abcdef' | cut -c1,3 --complement", 'bdef'],
    ["echo 'héllo' | cut -c2", 'é'],
    ['echo hello world | cut -c 1-5', 'hello'],
    ['cut -d : -f 1,7 /etc/passwd', 'root:/bin/vesh\nnobody:/usr/sbin/nologin\nguest:/bin/vesh\nhas:/bin/vesh'],
  ])('%s', async (line, expected) => {
    expect(await out(line)).toBe(expected);
  });

  it.each([
    ['cut .profile', 'cut: you must specify a list of bytes, characters, or fields'],
    ['cut -f 0 .profile', 'cut: fields are numbered from 1'],
    ['cut -c 3-1 .profile', 'cut: invalid decreasing range'],
    ['cut -c1 -f1 .profile', 'cut: only one type of list may be specified'],
    ['cut -d ab -f1 .profile', 'cut: the delimiter must be a single character'],
    ['cut -d : -c1 .profile', 'cut: an input delimiter may be specified only when operating on fields'],
  ])('%s is a usage error', async (line, message) => {
    expect(await runLine(line, pipe)).toMatchObject({ status: 1, stderrPlain: `${message}\nTry 'cut --help' for more information.` });
  });

  it('says which FILE it cannot read, and carries on', async () => {
    expect(await runLine('cut -f1 nope .profile', pipe)).toMatchObject({ status: 1, stderrPlain: 'cut: nope: No such file or directory' });
  });

  it('reads lists as ranges, in order', () => {
    expect(readList('3,1-2', false)).toEqual([
      { from: 1, to: 2 },
      { from: 3, to: 3 },
    ]);
    expect(readList('-2,5-', true)).toEqual([
      { from: 1, to: 2 },
      { from: 5, to: Infinity },
    ]);
    expect(() => readList('a', true)).toThrow("invalid field value 'a'");
    expect(() => readList('-', true)).toThrow('invalid range with no endpoint: -');
  });
});

describe('tr', () => {
  it.each([
    ['echo hello | tr a-z A-Z', 'HELLO'],
    ["echo 'Hello World' | tr '[:upper:]' '[:lower:]'", 'hello world'],
    ["echo 'Hello World' | tr '[:lower:]' '[:upper:]'", 'HELLO WORLD'],
    ["echo 'hello world' | tr -d lo", 'he wrd'],
    ["echo 'hello world' | tr -s lo", 'helo world'],
    ["echo 'too    many   spaces' | tr -s ' '", 'too many spaces'],
    ["echo 'a b  c' | tr -s ' ' '\\n'", 'a\nb\nc'],
    ["echo 'a1b2c3' | tr -cd '[:digit:]'", '123'],
    ["echo 'a1b2c3' | tr -d '[:alpha:]'", '123'],
    ["echo 'hello' | tr -c 'l\\n' x", 'xxllx'],
    ["echo 'abc' | tr abc x", 'xxx'],
    ["echo 'abc' | tr -t abc x", 'xbc'],
    ["echo 'abcd' | tr 'a-d' '[x*2]yz'", 'xxyz'],
    ["echo 'abcd' | tr 'a-d' 'x[y*]'", 'xyyy'],
    ["echo 'tab\there' | tr '\\t' ' '", 'tab here'],
    ["echo 'a.b,c!' | tr -d '[:punct:]'", 'abc'],
    ["echo 'A B' | tr -d '[:space:]'", 'AB'],
    ["echo 'x9Y' | tr -d '[:alnum:]'", ''],
    ["echo 'aaabbb' | tr -s 'ab' 'xy'", 'xy'],
    ["echo 'one two' | tr ' ' '\\n'", 'one\ntwo'],
    ["echo '\\101' | tr '\\\\' '/'", '/101'],
    ["echo 'ABC' | tr '\\101' z", 'zBC'],
  ])('%s', async (line, expected) => {
    expect(await out(line)).toBe(expected);
  });

  it.each([
    ['tr', "tr: missing operand\nTry 'tr --help' for more information."],
    ['tr a', "tr: missing operand after 'a'\nTwo strings must be given when translating.\nTry 'tr --help' for more information."],
    ['tr -d a b', "tr: extra operand 'b'\nOnly one string may be given when deleting without squeezing repeats.\nTry 'tr --help' for more information."],
    ['tr a b c', "tr: extra operand 'c'\nTry 'tr --help' for more information."],
    ['tr z-a x', "tr: range-endpoints of 'z-a' are in reverse collating sequence order"],
    ["tr '[:foo:]' x", "tr: invalid character class 'foo'"],
    ["tr a-c '[:digit:]'", "tr: when translating, the only character classes that may appear in\nstring2 are 'upper' and 'lower'"],
  ])('%s fails with status 1', async (line, message) => {
    expect(await runLine(`echo abc | ${line}`, pipe)).toMatchObject({ status: 1, stderrPlain: message });
  });

  it('expands sets: ranges, classes and repeats', () => {
    expect(expand(parseSet('a-e', false))).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(expand(parseSet('[:digit:]', false))).toHaveLength(10);
    expect(expand(parseSet('[x*3]', true))).toEqual(['x', 'x', 'x']);
    expect(expand(parseSet('a[b*]', true), 4)).toEqual(['a', 'b', 'b', 'b']);
    expect(expand(parseSet('\\n\\t\\\\', false))).toEqual(['\n', '\t', '\\']);
  });

  it('ends a pipe at once', async () => {
    expect(await runLine('yes | tr y n | head -n 2', pipe)).toMatchObject({ status: 0, stdoutPlain: 'n\nn' });
  });
});
