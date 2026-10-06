import { describe, expect, it } from 'vitest';
import type { Lex, Token, WordPart } from './lexer-types';
import { MAX_NESTING, incompleteReason, isNewlineToken, lex, lexPartial, lexText } from './lexer';

/** `raw@start-end` per token, with `=value` added for words whose value differs from raw. */
function summary(line: string): string[] {
  return lex(line).tokens.map((t: Token) => {
    const base = `${t.raw}@${t.start}-${t.end}`;
    if (t.kind === 'op' && isNewlineToken(line, t)) return `NL@${t.start}-${t.end}`;
    return t.kind === 'word' && t.value !== t.raw ? `${base}=${t.value}` : base;
  });
}

function parts(line: string, index = 0): readonly WordPart[] {
  const words = lex(line).tokens.filter((t) => t.kind === 'word');
  const word = words[index];
  if (word?.kind !== 'word') throw new Error(`no word ${index} in ${line}`);
  return word.parts;
}

describe('lex: tokens and source ranges', () => {
  it('implements the Lex contract', () => {
    const typed: Lex = lex;
    expect(typed('a b')).toEqual({
      tokens: [
        { kind: 'word', start: 0, end: 1, raw: 'a', value: 'a', parts: [{ kind: 'lit', text: 'a', q: 0 }], quoted: false, openQuote: null, danglingEscape: false },
        { kind: 'word', start: 2, end: 3, raw: 'b', value: 'b', parts: [{ kind: 'lit', text: 'b', q: 0 }], quoted: false, openQuote: null, danglingEscape: false },
      ],
      complete: true,
      openQuote: null,
      danglingEscape: false,
      commentAt: null,
    });
  });

  const cases: [string, string[]][] = [
    ['', []],
    ['ls', ['ls@0-2']],
    ['  ls   -la  ', ['ls@2-4', '-la@7-10']],
    ['echo a b', ['echo@0-4', 'a@5-6', 'b@7-8']],
    ['a|b', ['a@0-1', '|@1-2', 'b@2-3']],
    ['a||b', ['a@0-1', '||@1-3', 'b@3-4']],
    ['a&&b', ['a@0-1', '&&@1-3', 'b@3-4']],
    ['a;b', ['a@0-1', ';@1-2', 'b@2-3']],
    ['a&b', ['a@0-1', '&@1-2', 'b@2-3']],
    ['a>f', ['a@0-1', '>@1-2', 'f@2-3']],
    ['a>>f', ['a@0-1', '>>@1-3', 'f@3-4']],
    ['a<f', ['a@0-1', '<@1-2', 'f@2-3']],
    ['a 2>f', ['a@0-1', '2>@2-4', 'f@4-5']],
    ['a 2>>f', ['a@0-1', '2>>@2-5', 'f@5-6']],
    ['a &>f', ['a@0-1', '&>@2-4', 'f@4-5']],
    ['a 2>&1', ['a@0-1', '2>&1@2-6']],
    ['a >&2', ['a@0-1', '>&2@2-5']],
    ['a <<<w', ['a@0-1', '<<<@2-5', 'w@5-6']],
    ['a2>f', ['a2@0-2', '>@2-3', 'f@3-4']],
    ['echo 2 >f', ['echo@0-4', '2@5-6', '>@7-8', 'f@8-9']],
    ['x;2>f', ['x@0-1', ';@1-2', '2>@2-4', 'f@4-5']],
    ["'a b'", ["'a b'@0-5=a b"]],
    ['"a b"', ['"a b"@0-5=a b']],
    ['a\\ b', ['a\\ b@0-4=a b']],
    ['"a\\"b"', ['"a\\"b"@0-6=a"b']],
    ['"a\\nb"', ['"a\\nb"@0-6=a\\nb']],
    ["'a\\b'", ["'a\\b'@0-5=a\\b"]],
    ['""', ['""@0-2=']],
    ["''", ["''@0-2="]],
    ["$'a\\tb'", ["$'a\\tb'@0-7=a\tb"]],
    ['$"hi"', ['$"hi"@0-5=hi']],
    ['echo #c', ['echo@0-4']],
    ['echo a#b', ['echo@0-4', 'a#b@5-8']],
    ['echo a;#b', ['echo@0-4', 'a@5-6', ';@6-7']],
    ['echo a\nb', ['echo@0-4', 'a@5-6', 'NL@6-7', 'b@7-8']],
    ['echo a \\\nb', ['echo@0-4', 'a@5-6', 'b@9-10']],
    ['echo a\\\nb', ['echo@0-4', 'a\\\nb@5-9=ab']],
    ['echo "a\\\nb"', ['echo@0-4', '"a\\\nb"@5-11=ab']],
    ['echo :)', ['echo@0-4', ':)@5-7']],
    ['>', ['>@0-1']],
    ['a | b # c | d', ['a@0-1', '|@2-3', 'b@4-5']],
    ['echo $(a | b) x', ['echo@0-4', '$(a | b)@5-13', 'x@14-15']],
    ['echo "$(echo ")")"', ['echo@0-4', '"$(echo ")")"@5-18=$(echo ")")']],
    ["echo 'café 🐟' x", ["echo@0-4", "'café 🐟'@5-14=café 🐟", 'x@15-16']],
  ];
  it.each(cases)('%j', (line, expected) => {
    expect(summary(line)).toEqual(expected);
  });

  it('keeps every word token equal to its source slice', () => {
    const line = `A=1 echo "a $B" 'c' \\d $(e "f") \${g:-h i} ~/j k>l 2>&1 | m && n || o; p &`;
    for (const t of lex(line).tokens) expect(line.slice(t.start, t.end)).toBe(t.raw);
  });

  it('reports a comment offset and ignores the rest of that line only', () => {
    expect(lex('echo a # b').commentAt).toBe(7);
    expect(lex('#only').tokens).toEqual([]);
    expect(lex('#only').commentAt).toBe(0);
    expect(summary('a # one\nb')).toEqual(['a@0-1', 'NL@7-8', 'b@8-9']);
    expect(lex('echo "#" a#b').commentAt).toBeNull();
  });
});

describe('lex: file descriptors and the bash 4 redirections', () => {
  /** `raw→value` for each redirection token, and `!fd` for one vesen refuses. */
  const redirs = (line: string): string[] =>
    lex(line).tokens.flatMap((t) => (t.kind === 'redir' ? [`${t.raw}→${t.value}${t.unsupportedFd === undefined ? '' : `!${t.unsupportedFd}`}`] : []));

  it.each([
    ['a 1>f', ['1>→>']],
    ['a 1>>f', ['1>>→>>']],
    ['a 1>&2', ['1>&2→>&2']],
    ['a 2>|f', ['2>|→2>']],
    ['a 0<f', ['0<→<']],
    ['a >|f', ['>|→>|']],
    ['a &>>f', ['&>>→&>>']],
    ['a >& f', ['>&→&>']],
    ['a >&f', ['>&→&>']],
    ['a >&1', ['>&1→>&1']],
    ['a 3>f', ['3>→>!3']],
    ['a 10>f', ['10>→>!10']],
    ['a >&3', ['>&3→>&1!3']],
    ['a 1<f', ['1<→<!1']],
  ])('%s', (line, expected) => {
    expect(redirs(line)).toEqual(expected);
  });

  it('reads |& as a pipe of both streams, and a digit inside a word as text', () => {
    expect(summary('a|&b')).toEqual(['a@0-1', '|&@1-3', 'b@3-4']);
    expect(summary('a1>f')).toEqual(['a1@0-2', '>@2-3', 'f@3-4']);
  });
});

describe('lex: word parts and quote levels', () => {
  it('splits a word into literal runs by quote level', () => {
    expect(parts('a\\ b')).toEqual([
      { kind: 'lit', text: 'a', q: 0 },
      { kind: 'lit', text: ' ', q: 1 },
      { kind: 'lit', text: 'b', q: 0 },
    ]);
    expect(parts(`x'y'"z"`)).toEqual([
      { kind: 'lit', text: 'x', q: 0 },
      { kind: 'lit', text: 'y', q: 1 },
      { kind: 'lit', text: 'z', q: 2 },
    ]);
  });

  it('keeps an empty quoted word as an empty literal', () => {
    expect(parts('""')).toEqual([{ kind: 'lit', text: '', q: 2 }]);
    expect(parts("''")).toEqual([{ kind: 'lit', text: '', q: 1 }]);
  });

  it('reads parameters, plain and braced', () => {
    expect(parts('$X')).toEqual([{ kind: 'param', name: 'X', braced: false, q: 0 }]);
    expect(parts('"$X"')).toEqual([{ kind: 'param', name: 'X', braced: false, q: 2 }]);
    expect(parts('${X}y')).toEqual([
      { kind: 'param', name: 'X', braced: true, q: 0 },
      { kind: 'lit', text: 'y', q: 0 },
    ]);
    expect(parts('$1$?$#$$$0$@$*$!$-').map((p) => (p.kind === 'param' ? p.name : '?'))).toEqual([
      '1', '?', '#', '$', '0', '@', '*', '!', '-',
    ]);
    expect(parts('$10')).toEqual([
      { kind: 'param', name: '1', braced: false, q: 0 },
      { kind: 'lit', text: '0', q: 0 },
    ]);
    expect(parts('a$')).toEqual([{ kind: 'lit', text: 'a$', q: 0 }]);
    expect(parts('$/x')).toEqual([{ kind: 'lit', text: '$/x', q: 0 }]);
  });

  it('reads the ${X op word} family with its argument', () => {
    expect(parts('${X:-a b}')).toEqual([
      { kind: 'param', name: 'X', braced: true, op: ':-', arg: [{ kind: 'lit', text: 'a b', q: 0 }], q: 0 },
    ]);
    for (const op of ['-', ':=', ':+'] as const) {
      expect(parts(`\${X${op}d}`)).toEqual([
        { kind: 'param', name: 'X', braced: true, op, arg: [{ kind: 'lit', text: 'd', q: 0 }], q: 0 },
      ]);
    }
    expect(parts('"${X:-a "b c"}"')).toEqual([
      { kind: 'param', name: 'X', braced: true, op: ':-', arg: [{ kind: 'lit', text: 'a b c', q: 2 }], q: 2 },
    ]);
    expect(parts("${X:-'a'}")).toEqual([
      { kind: 'param', name: 'X', braced: true, op: ':-', arg: [{ kind: 'lit', text: 'a', q: 1 }], q: 0 },
    ]);
    expect(parts('${X:-}')).toEqual([{ kind: 'param', name: 'X', braced: true, op: ':-', arg: [], q: 0 }]);
    expect(parts('${X:-~/a}')).toEqual([
      { kind: 'param', name: 'X', braced: true, op: ':-', arg: [{ kind: 'tilde' }, { kind: 'lit', text: '/a', q: 0 }], q: 0 },
    ]);
  });

  it('keeps unsupported ${…} forms whole, for expansion to report', () => {
    expect(parts('${#X}')).toEqual([{ kind: 'param', name: '#X', braced: true, q: 0 }]);
    expect(parts('${x/a/b}')).toEqual([{ kind: 'param', name: 'x/a/b', braced: true, q: 0 }]);
    expect(parts('${X:?m}')).toEqual([{ kind: 'param', name: 'X:?m', braced: true, q: 0 }]);
    expect(parts('${}')).toEqual([{ kind: 'param', name: '', braced: true, q: 0 }]);
  });

  it('reads command substitutions and arithmetic', () => {
    expect(parts('$(ls -l)')).toEqual([{ kind: 'cmdsub', source: 'ls -l', q: 0 }]);
    expect(parts('"$(ls)"')).toEqual([{ kind: 'cmdsub', source: 'ls', q: 2 }]);
    expect(parts('$(a $(b))')).toEqual([{ kind: 'cmdsub', source: 'a $(b)', q: 0 }]);
    expect(parts('$(echo ")")')).toEqual([{ kind: 'cmdsub', source: 'echo ")"', q: 0 }]);
    expect(parts('$(echo \\))')).toEqual([{ kind: 'cmdsub', source: 'echo \\)', q: 0 }]);
    expect(parts('`date`')).toEqual([{ kind: 'cmdsub', source: 'date', q: 0 }]);
    expect(parts('`echo \\`x\\``')).toEqual([{ kind: 'cmdsub', source: 'echo `x`', q: 0 }]);
    expect(parts('$((1+(2*3)))')).toEqual([{ kind: 'arith', expr: '1+(2*3)', q: 0 }]);
    expect(parts('"$(( X + 1 ))"')).toEqual([{ kind: 'arith', expr: ' X + 1 ', q: 2 }]);
    expect(parts('$((cd x); ls)')).toEqual([{ kind: 'cmdsub', source: '(cd x); ls', q: 0 }]);
  });

  it('reads tilde prefixes only where bash does', () => {
    expect(parts('~')).toEqual([{ kind: 'tilde' }]);
    expect(parts('~/x')).toEqual([{ kind: 'tilde' }, { kind: 'lit', text: '/x', q: 0 }]);
    expect(parts('~guest')).toEqual([{ kind: 'tilde', user: 'guest' }]);
    expect(parts('~has/a')).toEqual([{ kind: 'tilde', user: 'has' }, { kind: 'lit', text: '/a', q: 0 }]);
    expect(parts('~+')).toEqual([{ kind: 'tilde', user: '+' }]);
    expect(parts('~-')).toEqual([{ kind: 'tilde', user: '-' }]);
    expect(parts('a~')).toEqual([{ kind: 'lit', text: 'a~', q: 0 }]);
    expect(parts('"~"')).toEqual([{ kind: 'lit', text: '~', q: 2 }]);
    expect(parts('~"x"')).toEqual([
      { kind: 'lit', text: '~', q: 0 },
      { kind: 'lit', text: 'x', q: 2 },
    ]);
    expect(parts('~:x')).toEqual([{ kind: 'lit', text: '~:x', q: 0 }]);
    expect(parts('P=~/a:~/b')).toEqual([
      { kind: 'lit', text: 'P=', q: 0 },
      { kind: 'tilde' },
      { kind: 'lit', text: '/a:', q: 0 },
      { kind: 'tilde' },
      { kind: 'lit', text: '/b', q: 0 },
    ]);
  });

  it('applies ANSI-C escapes in $\'…\'', () => {
    const value = (line: string): string => {
      const t = lex(line).tokens[0];
      return t?.kind === 'word' ? t.value : '';
    };
    expect(value("$'a\\nb\\tc'")).toBe('a\nb\tc');
    expect(value("$'\\e[31mred'")).toBe('\x1b[31mred');
    expect(value("$'\\x41\\101\\u00e9\\U0001F41F'")).toBe('AAé🐟');
    expect(value("$'it\\'s'")).toBe("it's");
    expect(value("$'\\cA\\q'")).toBe('\x01\\q');
  });

  it('marks NAME=value words and where the value starts', () => {
    const word = (line: string): Token | undefined => lex(line).tokens[0];
    expect(word('A=1')).toMatchObject({ assign: { name: 'A', valueStart: 2 } });
    expect(word('_x9="a b"')).toMatchObject({ assign: { name: '_x9', valueStart: 4 } });
    expect(word('A=')).toMatchObject({ assign: { name: 'A', valueStart: 2 } });
    expect(word('1A=2')).not.toHaveProperty('assign');
    expect(word('A\\=1')).not.toHaveProperty('assign');
    expect(word('"A"=1')).not.toHaveProperty('assign');
    expect(word('=1')).not.toHaveProperty('assign');
  });

  it('escapes a whole character, surrogate pairs included', () => {
    expect(parts('\\🐟x')).toEqual([
      { kind: 'lit', text: '🐟', q: 1 },
      { kind: 'lit', text: 'x', q: 0 },
    ]);
  });
});

describe('lex: unfinished input', () => {
  const cases: [string, { quote: '"' | "'" | null; dangling: boolean; reason: string }][] = [
    ['echo "a', { quote: '"', dangling: false, reason: 'quote' }],
    ["echo 'a", { quote: "'", dangling: false, reason: 'quote' }],
    ["echo $'a", { quote: "'", dangling: false, reason: 'quote' }],
    ['echo a\\', { quote: null, dangling: true, reason: 'backslash' }],
    ['echo \\', { quote: null, dangling: true, reason: 'backslash' }],
    ['echo "a\\', { quote: '"', dangling: false, reason: 'quote' }],
    ['echo $(ls', { quote: null, dangling: false, reason: 'subst' }],
    ['echo ${X', { quote: null, dangling: false, reason: 'subst' }],
    ['echo ${X:-a', { quote: null, dangling: false, reason: 'subst' }],
    ['echo $((1+', { quote: null, dangling: false, reason: 'subst' }],
    ['echo `ls', { quote: null, dangling: false, reason: 'subst' }],
    ['echo "$(ls', { quote: null, dangling: false, reason: 'subst' }],
    ["echo $(cat 'a", { quote: "'", dangling: false, reason: 'quote' }],
    ['echo $(ls \\', { quote: null, dangling: true, reason: 'backslash' }],
    ['echo "$(ls)', { quote: '"', dangling: false, reason: 'quote' }],
  ];
  it.each(cases)('%j is unfinished', (line, { quote, dangling, reason }) => {
    const result = lex(line);
    expect(result.complete).toBe(false);
    expect(result.openQuote).toBe(quote);
    expect(result.danglingEscape).toBe(dangling);
    expect(incompleteReason(result)).toBe(reason);
    const last = result.tokens[result.tokens.length - 1];
    expect(last?.kind).toBe('word');
    expect(last?.end).toBe(line.length);
    if (last?.kind === 'word') {
      expect(last.openQuote).toBe(quote);
      expect(last.danglingEscape).toBe(dangling);
    }
  });

  it('keeps the text of an open quote as the value', () => {
    const t = lex('cat "my fi').tokens[1];
    expect(t).toMatchObject({ kind: 'word', raw: '"my fi', value: 'my fi', openQuote: '"' });
  });

  it('is complete once every construct closes', () => {
    for (const line of ['echo "a"', "echo 'a'", 'echo $(ls)', 'echo ${X:-a}', 'echo $((1))', 'echo `ls`', 'a \\\nb']) {
      expect(lex(line).complete).toBe(true);
      expect(incompleteReason(lex(line))).toBeNull();
    }
  });

  it('never throws on deeply nested input, and stops nesting at the limit', () => {
    const deep = '$('.repeat(500) + 'x' + ')'.repeat(500);
    expect(() => lex(deep)).not.toThrow();
    expect(() => lex('${'.repeat(500))).not.toThrow();
    expect(() => lex('`'.repeat(501))).not.toThrow();
    expect(() => lex('"$('.repeat(300))).not.toThrow();
    expect(MAX_NESTING).toBeGreaterThan(8);
  });

  it('stays linear when $(( turns out to be a command substitution, however deep', () => {
    let line = 'a';
    for (let k = 0; k < MAX_NESTING + 4; k += 1) line = `$((${line}) x)`;
    const started = Date.now();
    const result = lex(line);
    expect(Date.now() - started).toBeLessThan(500);
    expect(result.complete).toBe(true);
    expect(parts('$((cd x); ls)')).toEqual([{ kind: 'cmdsub', source: '(cd x); ls', q: 0 }]);
    expect(lex('$((cd x); ls').complete).toBe(false);
  });
});

describe('lexText', () => {
  it('reads arithmetic text like the inside of double quotes', () => {
    expect(lexText(' $X + ${Y:-2} * $(n) ')).toEqual([
      { kind: 'lit', text: ' ', q: 2 },
      { kind: 'param', name: 'X', braced: false, q: 2 },
      { kind: 'lit', text: ' + ', q: 2 },
      { kind: 'param', name: 'Y', braced: true, op: ':-', arg: [{ kind: 'lit', text: '2', q: 2 }], q: 2 },
      { kind: 'lit', text: ' * ', q: 2 },
      { kind: 'cmdsub', source: 'n', q: 2 },
      { kind: 'lit', text: ' ', q: 2 },
    ]);
  });
});

describe('lexPartial: the word under the cursor', () => {
  it('finds the word being typed and the command around it', () => {
    const r = lexPartial('cat do', 6);
    expect(r.word).toMatchObject({ start: 4, end: 6, value: 'do', openQuote: null });
    expect(r.words.map((w) => w.value)).toEqual(['cat']);
    expect(r.commandStart).toBe(0);
    expect(r.redirectTarget).toBe(false);
  });

  it('gives an empty word after a blank', () => {
    const r = lexPartial('cat ', 4);
    expect(r.word).toMatchObject({ start: 4, end: 4, value: '', token: null });
    expect(r.words.map((w) => w.value)).toEqual(['cat']);
  });

  it('gives the command position after an operator', () => {
    const r = lexPartial('ls -la | gr', 11);
    expect(r.word.value).toBe('gr');
    expect(r.words).toEqual([]);
    expect(r.commandStart).toBe(3);
    expect(lexPartial('a; b c', 6).words.map((w) => w.value)).toEqual(['b']);
    expect(lexPartial('a &&', 4).word.value).toBe('');
    expect(lexPartial('a &&', 4).words).toEqual([]);
  });

  it('knows a redirection target', () => {
    const r = lexPartial('echo hi > ~/do', 14);
    expect(r.redirectTarget).toBe(true);
    expect(r.word.value).toBe('~/do');
    expect(r.words.map((w) => w.value)).toEqual(['echo', 'hi']);
    expect(lexPartial('cat < f ', 8).redirectTarget).toBe(false);
    expect(lexPartial('cat < f ', 8).words.map((w) => w.value)).toEqual(['cat']);
    expect(lexPartial('cmd 2>&1 ', 9).redirectTarget).toBe(false);
  });

  it('keeps the open quote, so completion can close it', () => {
    const r = lexPartial("cat 'my fi", 10);
    expect(r.word).toMatchObject({ start: 4, value: 'my fi', openQuote: "'" });
    expect(r.complete).toBe(false);
  });

  it('ignores text after the cursor', () => {
    const r = lexPartial('cat documents/linux.txt', 16);
    expect(r.word).toMatchObject({ start: 4, end: 16, value: 'documents/li' });
  });

  it('completes inside an open command substitution', () => {
    const r = lexPartial('echo $(ca', 9);
    expect(r.regionStart).toBe(7);
    expect(r.word).toMatchObject({ start: 7, value: 'ca' });
    expect(r.words).toEqual([]);
    const nested = lexPartial('x "$(cat `ls do', 15);
    expect(nested.regionStart).toBe(10);
    expect(nested.words.map((w) => w.value)).toEqual(['ls']);
    expect(nested.word.value).toBe('do');
  });

  it('knows a comment, and clamps the cursor', () => {
    expect(lexPartial('echo # co', 9).inComment).toBe(true);
    expect(lexPartial('echo # co\nls', 12).inComment).toBe(false);
    expect(lexPartial('ls', 99).cursor).toBe(2);
    expect(lexPartial('ls', -5).cursor).toBe(0);
    expect(lexPartial('ls', Number.NaN).cursor).toBe(2);
  });
});
