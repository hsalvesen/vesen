import { describe, expect, it } from 'vitest';
import { MAX_ALIAS_EXPANSION, expandAliases, isValidAliasName } from './alias';

const aliases = new Map([
  ['ll', 'ls -l'],
  ['la', 'ls -A'],
  ['ls', 'ls --color=auto'],
  ['count', 'ls | wc -l'],
  ['both', 'echo a; echo b'],
  ['sudo', 'sudo '],
  ['g', 'git'],
  ['st', 'status'],
  ['loop1', 'loop2'],
  ['loop2', 'loop1'],
  ['quiet', '2>/dev/null '],
  ['setx', 'X=1 '],
]);

const expand = (line: string): string => expandAliases(line, aliases).line;

describe('expandAliases', () => {
  const cases: [string, string][] = [
    ['ll', 'ls --color=auto -l'],
    ['ll ~/docs', 'ls --color=auto -l ~/docs'],
    ['ls', 'ls --color=auto'],
    ['la -h', 'ls --color=auto -A -h'],
    ['ll | ll', 'ls --color=auto -l | ls --color=auto -l'],
    ['ll; ll && ll || ll & ll', 'ls --color=auto -l; ls --color=auto -l && ls --color=auto -l || ls --color=auto -l & ls --color=auto -l'],
    ['ll\nll', 'ls --color=auto -l\nls --color=auto -l'],
    ['count', 'ls --color=auto | wc -l'],
    ['both && ll', 'echo a; echo b && ls --color=auto -l'],
    ['A=1 ll', 'A=1 ls --color=auto -l'],
    ['A=1 B=2 ll', 'A=1 B=2 ls --color=auto -l'],
    ['sudo ll', 'sudo  ls --color=auto -l'],
    ['sudo sudo ll', 'sudo  sudo  ls --color=auto -l'],
    ['g st', 'git st'],
    ['setx ll', 'X=1  ls --color=auto -l'],
    ['loop1', 'loop1'],
    ['loop2 x', 'loop2 x'],
    ['> out ll', '> out ls --color=auto -l'],
    ['quiet ll', '2>/dev/null  ls --color=auto -l'],
  ];
  it.each(cases)('%j becomes %j', (line, result) => {
    expect(expandAliases(line, aliases)).toEqual({ line: result, changed: true });
  });

  const unchanged = [
    'echo ll',
    "'ll'",
    '"ll"',
    '\\ll',
    'cat > ll',
    'cat < ll',
    'echo hi # ll',
    'x ll',
    'll=1',
    'unknown',
    '',
  ];
  it.each(unchanged)('leaves %j alone', (line) => {
    expect(expandAliases(line, aliases)).toEqual({ line, changed: false });
  });

  it('keeps text around an expansion exactly', () => {
    expect(expand('  ll   -h  ;  la')).toBe('  ls --color=auto -l   -h  ;  ls --color=auto -A');
  });

  it('expands an alias defined as the empty string to nothing, leaving the next word in command position', () => {
    expect(expandAliases('nop ls', new Map([['nop', '']]))).toEqual({ line: ' ls', changed: true });
    expect(expandAliases('nop ls', new Map([['nop', ''], ['ls', 'LS']])).line).toBe(' LS');
  });

  it('caps runaway expansion', () => {
    const table = new Map<string, string>();
    for (let k = 0; k < 12; k += 1) table.set(`a${k}`, Array.from({ length: 4 }, () => `a${k + 1}`).join(';'));
    const result = expandAliases('a0', table);
    expect(result.changed).toBe(true);
    expect(result.line.length).toBeLessThanOrEqual(MAX_ALIAS_EXPANSION + 2);
  });
});

describe('isValidAliasName', () => {
  it.each(['ll', 'la', 'l', 'g.', 'git-st', '..', '_x', 'ü'])('accepts %j', (name) => {
    expect(isValidAliasName(name)).toBe(true);
  });
  it.each(['', 'a b', 'a/b', '$x', 'a=b', "a'b", 'a"b', 'a|b', 'a;b', 'a&b', 'a(b', 'a<b', '-x', 'a`b', 'a\\b'])('rejects %j', (name) => {
    expect(isValidAliasName(name)).toBe(false);
  });
});
