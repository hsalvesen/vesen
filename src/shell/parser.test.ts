import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { AndOr, List, ParseResult, Pipeline, SimpleCommand } from './ast';
import { expandAliases } from './alias';
import { ArithError, evaluateArith } from './arith';
import { ExpandError, Expander } from './expand';
import { expandHistory } from './histexpand';
import { lex, lexPartial } from './lexer';
import { describeIncomplete, parse } from './parser';

/** A compact rendering of a tree: `[A=1 cmd arg >out] | [cmd] && ! [x] ; [y] &`. */
function show(list: List): string {
  const cmd = (c: SimpleCommand): string =>
    `[${[
      ...c.assigns.map((a) => `$${a.name}=${a.value.raw}`),
      ...c.words.map((w) => w.raw),
      ...c.redirects.map((r) => `${r.op}${r.target?.raw ?? ''}`),
    ].join(' ')}]`;
  const pipe = (p: Pipeline): string => (p.negate ? '! ' : '') + p.cmds.map(cmd).join(' | ');
  const andOr = (a: AndOr): string => [pipe(a.first), ...a.rest.map((r) => `${r.op} ${pipe(r.pipe)}`)].join(' ');
  return list.items.map((item) => andOr(item.node) + (item.background ? ' &' : '')).join(' ; ');
}

function outcome(r: ParseResult): string {
  if (r.ok === true) return show(r.ast);
  if (r.incomplete === true) return `incomplete:${r.reason}`;
  return `error:${r.message}`;
}

describe('parse: trees', () => {
  const cases: [string, string][] = [
    ['', ''],
    ['   ', ''],
    ['# just a comment', ''],
    ['ls', '[ls]'],
    ['ls -la /tmp', '[ls -la /tmp]'],
    ['a; b', '[a] ; [b]'],
    ['a;b;', '[a] ; [b]'],
    ['a && b || c', '[a] && [b] || [c]'],
    ['a | b | c', '[a] | [b] | [c]'],
    ['! a | b', '! [a] | [b]'],
    ['! ! a', '[a]'],
    ['!', '! []'],
    ['a | b && ! c', '[a] | [b] && ! [c]'],
    ['a &', '[a] &'],
    ['a & b', '[a] & ; [b]'],
    ['A=1', '[$A=1]'],
    ['A=1 B="x y" env', '[$A=1 $B="x y" env]'],
    ['env A=1', '[env A=1]'],
    ['> f', '[>f]'],
    ['> f A=1 env', '[$A=1 env >f]'],
    ['cat < in > out 2> err', '[cat <in >out 2>err]'],
    ['cmd 2>&1 | less', '[cmd 2>&1] | [less]'],
    ['echo hi >&2', '[echo hi >&2]'],
    ['echo hi &> all', '[echo hi &>all]'],
    ['log >> f 2>> g', '[log >>f 2>>g]'],
    ['cat <<< "x y"', '[cat <<<"x y"]'],
    ['a\nb', '[a] ; [b]'],
    ['a |\nb', '[a] | [b]'],
    ['a &&\n\nb', '[a] && [b]'],
    ['\n\na\n\n', '[a]'],
    ['a # c\nb', '[a] ; [b]'],
    ['echo hi # c && x', '[echo hi]'],
    ['echo $(a | b) `c`', '[echo $(a | b) `c`]'],
    ['echo "$(a; b)"', '[echo "$(a; b)"]'],
    ['x=$(date) y', '[$x=$(date) y]'],
    ['"if" x', '["if" x]'],
    ['A=1 if', '[$A=1 if]'],
    ['echo if then fi', '[echo if then fi]'],
    ['echo :) (x)', '[echo :) (x)]'],
    ['echo $((1+2))', '[echo $((1+2))]'],
  ];
  it.each(cases)('%j', (line, expected) => {
    expect(outcome(parse(line))).toBe(expected);
  });

  it('records positions on every node', () => {
    const r = parse('A=1 echo hi > f | wc && x');
    if (!r.ok) throw new Error('expected a tree');
    const item = r.ast.items[0];
    expect(r.ast).toMatchObject({ start: 0, end: 25 });
    expect(item?.node).toMatchObject({ start: 0, end: 25 });
    expect(item?.node.first).toMatchObject({ start: 0, end: 20 });
    const cmd = item?.node.first.cmds[0];
    expect(cmd).toMatchObject({ start: 0, end: 15 });
    expect(cmd?.assigns[0]).toMatchObject({ start: 0, end: 3, name: 'A', value: { start: 2, end: 3, raw: '1' } });
    expect(cmd?.words.map((w) => [w.raw, w.start, w.end])).toEqual([
      ['echo', 4, 8],
      ['hi', 9, 11],
    ]);
    expect(cmd?.redirects[0]).toMatchObject({ op: '>', start: 12, end: 15, target: { raw: 'f', start: 14, end: 15 } });
  });

  it('strips NAME= from an assignment value but keeps its quoting', () => {
    const r = parse(`A="a b"$X B= C=''`);
    if (!r.ok) throw new Error('expected a tree');
    const assigns = r.ast.items[0]?.node.first.cmds[0]?.assigns ?? [];
    expect(assigns.map((a) => [a.name, a.value.raw, a.value.parts])).toEqual([
      ['A', '"a b"$X', [{ kind: 'lit', text: 'a b', q: 2 }, { kind: 'param', name: 'X', braced: false, q: 0 }]],
      ['B', '', []],
      ['C', "''", [{ kind: 'lit', text: '', q: 1 }]],
    ]);
    expect(assigns[0]?.value.quoted).toBe(true);
  });

  it('returns the tokens with every result', () => {
    expect(parse('a | b').tokens).toHaveLength(3);
    expect(parse('a |').tokens).toHaveLength(2);
    expect(parse('| a').tokens).toHaveLength(2);
  });
});

describe('parse: unfinished lines', () => {
  const cases: [string, string][] = [
    ['echo "a', 'quote'],
    ["echo 'a b", 'quote'],
    ['echo "$(ls)', 'quote'],
    ['a |', 'pipe'],
    ['a | ', 'pipe'],
    ['a |\n', 'pipe'],
    ['a &&', 'andor'],
    ['a ||', 'andor'],
    ['a && b ||\n', 'andor'],
    ['a \\', 'backslash'],
    ['ls | \\', 'backslash'],
    ['echo $(a', 'subst'],
    ['echo $(a |', 'subst'],
    ['echo ${a', 'subst'],
    ['echo $((1', 'subst'],
    ['echo `a', 'subst'],
    ['"if', 'quote'],
  ];
  it.each(cases)('%j needs more input (%s)', (line, reason) => {
    expect(outcome(parse(line))).toBe(`incomplete:${reason}`);
  });

  it('finishes once the next line arrives', () => {
    expect(outcome(parse('echo "a\nb"'))).toBe('[echo "a\nb"]');
    expect(outcome(parse('a |\nb'))).toBe('[a] | [b]');
    expect(outcome(parse('echo a \\\nb'))).toBe('[echo a b]');
    expect(outcome(parse('echo $(a\n)'))).toBe('[echo $(a\n)]');
  });
});

describe('parse: errors', () => {
  const cases: [string, string, [number, number]?][] = [
    ['| a', "syntax error near unexpected token '|'", [0, 1]],
    ['a ||| b', "syntax error near unexpected token '|'", [4, 5]],
    ['a && && b', "syntax error near unexpected token '&&'", [5, 7]],
    [';', "syntax error near unexpected token ';'", [0, 1]],
    ['a;;', "syntax error near unexpected token ';;'", [1, 3]],
    ['a ; ; b', "syntax error near unexpected token ';'", [4, 5]],
    ['&', "syntax error near unexpected token '&'", [0, 1]],
    ['a & & b', "syntax error near unexpected token '&'", [4, 5]],
    ['a >', "syntax error near unexpected token 'newline'", [3, 3]],
    ['a > | b', "syntax error near unexpected token '|'", [4, 5]],
    ['a 2>', "syntax error near unexpected token 'newline'", [4, 4]],
    ['a < > b', "syntax error near unexpected token '>'", [4, 5]],
    ['a >\nb', "syntax error near unexpected token 'newline'", [3, 4]],
    ['! | a', "syntax error near unexpected token '|'", [2, 3]],
    ['then', "syntax error near unexpected token 'then'", [0, 4]],
    ['fi', "syntax error near unexpected token 'fi'"],
    ['done', "syntax error near unexpected token 'done'"],
    ['}', "syntax error near unexpected token '}'"],
    ['a | then', "syntax error near unexpected token 'then'"],
    ['if true; then x; fi', 'if: not supported in vesen', [0, 2]],
    ['for i in 1 2; do echo $i; done', 'for: not supported in vesen', [0, 3]],
    ['while true; do x; done', 'while: not supported in vesen'],
    ['until x', 'until: not supported in vesen'],
    ['case x in a) b;; esac', 'case: not supported in vesen'],
    ['select x', 'select: not supported in vesen'],
    ['function f { x; }', 'function: not supported in vesen'],
    ['f() { x; }', 'function: not supported in vesen', [0, 3]],
    ['f () { x; }', 'function: not supported in vesen', [2, 4]],
    ['{ a; }', '{: not supported in vesen'],
    ['[[ -f x ]]', '[[: not supported in vesen'],
    ['((x++))', '((: not supported in vesen'],
    ['a | while read x', 'while: not supported in vesen', [4, 9]],
    ['a && for x', 'for: not supported in vesen'],
    ['cat <<EOF', '<<: not supported in vesen', [4, 6]],
    ['cat <<-EOF', '<<: not supported in vesen'],
    ['echo $(|)', "syntax error near unexpected token '|'", [5, 9]],
    ['echo $(a |)', "syntax error near unexpected token ')'"],
    ['echo "$(a && )"', "syntax error near unexpected token ')'"],
    ['echo $(for x)', 'for: not supported in vesen'],
    ['echo `a "`', "unexpected EOF while looking for matching '\"'"],
    ['echo ${X:-$(|)}', "syntax error near unexpected token '|'"],
    ['x=$(;) y', "syntax error near unexpected token ';'"],
    ['cat < $(|)', "syntax error near unexpected token '|'"],
  ];
  it.each(cases)('%j', (line, message, at) => {
    const r = parse(line);
    expect(outcome(r)).toBe(`error:${message}`);
    if (at !== undefined && r.ok === false && r.incomplete === false) expect([r.at.start, r.at.end]).toEqual(at);
  });

  it("reports an error before a later quote is closed, as bash does", () => {
    expect(outcome(parse('| echo "a'))).toBe("error:syntax error near unexpected token '|'");
  });

  it('describes a script that ends too early', () => {
    expect(describeIncomplete('echo "a', 'quote')).toBe(`unexpected EOF while looking for matching '"'`);
    expect(describeIncomplete("echo 'a", 'quote')).toBe("unexpected EOF while looking for matching '''");
    expect(describeIncomplete('a |', 'pipe')).toBe('syntax error: unexpected end of file');
  });
});

describe('fuzz: total functions over random shell input', () => {
  const alphabet = [
    'a', 'b', 'x', '1', '2', ' ', ' ', '\t', '\n', "'", '"', '\\', '$', '(', ')', '{', '}', '`',
    '|', '&', ';', '<', '>', '~', '*', '?', '[', ']', '!', '#', '=', ':', '-', '+', '/', '^', '%', '🐟',
  ];
  const shellText = fc.string({ unit: fc.constantFrom(...alphabet), maxLength: 48 });

  it('parses 10,000 random strings into a result, never an exception', () => {
    fc.assert(
      fc.property(shellText, (line) => {
        const result = parse(line);
        expect(typeof result.ok).toBe('boolean');
        if (result.ok === false && result.incomplete === false) {
          expect(result.message).not.toBe('');
          expect(result.at.start).toBeGreaterThanOrEqual(0);
          expect(result.at.end).toBeLessThanOrEqual(line.length);
        }
        if (result.ok === false && result.incomplete === true) expect(['quote', 'pipe', 'andor', 'backslash', 'subst']).toContain(result.reason);
        let previousEnd = 0;
        for (const t of result.tokens) {
          expect(t.start).toBeGreaterThanOrEqual(previousEnd);
          expect(t.end).toBeGreaterThan(t.start);
          expect(t.end).toBeLessThanOrEqual(line.length);
          if (t.kind === 'word') expect(line.slice(t.start, t.end)).toBe(t.raw);
          previousEnd = t.end;
        }
      }),
      { numRuns: 10_000 },
    );
  });

  it('lexes every prefix in partial mode without throwing', () => {
    fc.assert(
      fc.property(shellText, fc.nat(60), (line, cursor) => {
        const r = lexPartial(line, cursor);
        expect(r.word.end).toBe(r.cursor);
        expect(r.word.start).toBeLessThanOrEqual(r.word.end);
        expect(r.regionStart).toBeLessThanOrEqual(r.cursor);
      }),
      { numRuns: 3000 },
    );
  });

  it('expands history and aliases without throwing', () => {
    const history = {
      get: (n: number) => (n === 1 ? 'echo "a b" | wc' : undefined),
      last: (offset = 1) => (offset === 1 ? 'ls -la ~' : undefined),
      findPrefix: (p: string) => ('grep x'.startsWith(p) ? 'grep x' : undefined),
      search: () => undefined,
    };
    const aliases = new Map([
      ['a', 'b | b '],
      ['b', "x 'y"],
      ['x', 'a; $(a)'],
    ]);
    fc.assert(
      fc.property(shellText, (line) => {
        const h = expandHistory(line, history);
        expect(typeof h.ok).toBe('boolean');
        const a = expandAliases(line, aliases);
        expect(typeof a.line).toBe('string');
        expect(lex(a.line)).toBeDefined();
      }),
      { numRuns: 3000 },
    );
  });

  it('expands parsed words or fails with an ExpandError, nothing else', async () => {
    const vars = new Map([['X', 'a b'], ['IFS', ' :']]);
    await fc.assert(
      fc.asyncProperty(shellText, async (line) => {
        const r = parse(line);
        if (!r.ok) return;
        const expander = new Expander({
          vars: { get: (k) => vars.get(k), set: (k, v) => void vars.set(k, v) },
          status: 1,
          pid: 7,
          argv0: 'vesen',
          args: ['p1', 'p 2'],
          home: '/home/guest',
          cwd: '/home/guest',
          random: () => 0.25,
          glob: (pattern) => (pattern.includes('*') ? ['m1', 'm2'] : []),
          exec: async (source) => ({ stdout: `[${source}]\n`, status: 0 }),
        });
        for (const item of r.ast.items) {
          for (const pipe of [item.node.first, ...item.node.rest.map((x) => x.pipe)]) {
            for (const cmd of pipe.cmds) {
              try {
                await expander.fields(cmd.words);
                for (const a of cmd.assigns) await expander.string(a.value);
              } catch (error) {
                expect(error).toBeInstanceOf(ExpandError);
              }
            }
          }
        }
      }),
      { numRuns: 2000 },
    );
  });

  it('evaluates random arithmetic or fails with an ArithError', () => {
    const arithmetic = fc.string({
      unit: fc.constantFrom('1', '0', '9', 'x', 'y', ' ', '+', '-', '*', '/', '%', '(', ')', '<', '>', '=', '!', '&', '|', '^', '~', '?', ':', ',', '#'),
      maxLength: 24,
    });
    fc.assert(
      fc.property(arithmetic, (expr) => {
        const vars = new Map([['x', '3'], ['y', 'x*2']]);
        try {
          expect(typeof evaluateArith(expr, { get: (k) => vars.get(k), set: (k, v) => void vars.set(k, v) })).toBe('bigint');
        } catch (error) {
          expect(error).toBeInstanceOf(ArithError);
        }
      }),
      { numRuns: 5000 },
    );
  });
});
