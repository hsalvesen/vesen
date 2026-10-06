import { describe, expect, it } from 'vitest';
import { expandHistory, type HistoryLookup } from './histexpand';

/** A history over `lines`, numbered from 1, newest last. */
function history(lines: readonly string[]): HistoryLookup {
  return {
    get: (n) => (n >= 1 ? lines[n - 1] : undefined),
    last: (offset = 1) => (offset >= 1 ? lines[lines.length - offset] : undefined),
    findPrefix: (prefix) => [...lines].reverse().find((line) => line.startsWith(prefix)),
    search: (query) => {
      for (let k = lines.length - 1; k >= 0; k -= 1) {
        const line = lines[k];
        if (line !== undefined && line.includes(query)) return { n: k + 1, line };
      }
      return undefined;
    },
  };
}

const lines = ['ls -la', 'cp notes.txt backup/notes.txt', 'echo hi > out.txt', 'cat out.txt'];
const h = history(lines);

function expanded(line: string): string {
  const r = expandHistory(line, h);
  if (r.ok === false) throw new Error(r.error);
  return r.line;
}

describe('expandHistory: events', () => {
  const cases: [string, string][] = [
    ['!!', 'cat out.txt'],
    ['sudo !!', 'sudo cat out.txt'],
    ['!! | wc -l', 'cat out.txt | wc -l'],
    ['!1', 'ls -la'],
    ['!3', 'echo hi > out.txt'],
    ['!-1', 'cat out.txt'],
    ['!-4', 'ls -la'],
    ['!ec', 'echo hi > out.txt'],
    ['!c', 'cat out.txt'],
    ['!cp', 'cp notes.txt backup/notes.txt'],
    ['!?backup?', 'cp notes.txt backup/notes.txt'],
    ['!?la', 'ls -la'],
    ['!! && !!', 'cat out.txt && cat out.txt'],
    ['echo "!!"', 'echo "cat out.txt"'],
  ];
  it.each(cases)('%j becomes %j', (line, result) => {
    expect(expandHistory(line, h)).toEqual({ ok: true, line: result, changed: true });
  });
});

describe('expandHistory: words', () => {
  const cases: [string, string][] = [
    ['vim !$', 'vim out.txt'],
    ['echo !^', 'echo out.txt'],
    ['echo !*', 'echo out.txt'],
    ['echo !-3:1', 'echo notes.txt'],
    ['echo !cp:$', 'echo backup/notes.txt'],
    ['echo !cp:*', 'echo notes.txt backup/notes.txt'],
    ['echo !cp:0', 'echo cp'],
    ['echo !ec:1-2', 'echo hi >'],
    ['echo !ec:2*', 'echo > out.txt'],
    ['echo !ec:^', 'echo hi'],
  ];
  it.each(cases)('%j becomes %j', (line, result) => {
    expect(expanded(line)).toBe(result);
  });

  it('treats operators as words, as bash does', () => {
    expect(expanded('echo !-2:2')).toBe('echo >');
  });
});

describe('expandHistory: quick substitution', () => {
  it('replaces the first match in the previous command', () => {
    expect(expandHistory('^out^in', h)).toEqual({ ok: true, line: 'cat in.txt', changed: true });
    expect(expanded('^cat^less^')).toBe('less out.txt');
    expect(expanded('^cat^less^ -N')).toBe('less out.txt -N');
  });

  it('fails when the text is not there', () => {
    expect(expandHistory('^zz^y', h)).toEqual({ ok: false, error: ':s^zz^y: substitution failed' });
    expect(expandHistory('^a^b', history([]))).toEqual({ ok: false, error: '!!: event not found' });
  });
});

describe('expandHistory: what stays literal', () => {
  const unchanged = [
    "echo '!!'",
    "echo $'it\\'s !!'",
    'echo \\!!',
    'echo hi!',
    'echo "wow!"',
    'a != b',
    '! false',
    'echo !(x)',
    'echo !=',
    'ls [!a]*',
    'echo $!',
    'echo ${!x}',
    'echo !#',
    'plain line',
    '',
  ];
  it.each(unchanged)('%j', (line) => {
    expect(expandHistory(line, h)).toEqual({ ok: true, line, changed: false });
  });

  it('expands again after a single-quoted part closes', () => {
    expect(expanded("echo '!!' !!")).toBe("echo '!!' cat out.txt");
  });
});

describe('expandHistory: event not found', () => {
  const cases: [string, string, string[]?][] = [
    ['!nope', '!nope: event not found'],
    ['!99', '!99: event not found'],
    ['!-9', '!-9: event not found'],
    ['!0', '!0: event not found'],
    ['!?zzz?', '!?zzz: event not found'],
    ['!!', '!!: event not found', []],
    ['echo !$', '!$: event not found', []],
  ];
  it.each(cases)('%j', (line, error, lines) => {
    expect(expandHistory(line, lines === undefined ? h : history(lines))).toEqual({ ok: false, error });
  });

  it('reports a word designator that selects nothing', () => {
    expect(expandHistory('echo !!:9', h)).toEqual({ ok: false, error: '!!:9: bad word specifier' });
    expect(expandHistory('echo !^', history(['ls']))).toEqual({ ok: false, error: '!^: bad word specifier' });
  });
});
