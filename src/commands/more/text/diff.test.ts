// diff against GNU diff's behaviour: Myers' shortest edit script, the normal and unified formats,
// -q -s -i -b -w, a last line without a newline, folders and standard input, and exit 0, 1 or 2.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { session, type Session } from '../../../../tests/harness';
import { changes, myers, normalFormat, unifiedFormat, type Op } from './diff.run';

const pipe = { tty: false } as const;

/** A session with files f1 (a b c) and f2 (a B c d), and a way to write more. */
async function withFiles(): Promise<Session> {
  const s = await session(pipe);
  await s.run("printf 'a\\nb\\nc\\n' > f1; printf 'a\\nB\\nc\\nd\\n' > f2");
  return s;
}

/** The lines `ops` keeps from `a` and adds from `b`, which must be `b`. */
function apply(a: readonly number[], b: readonly number[], ops: readonly Op[]): number[] {
  const result: number[] = [];
  let i = 0;
  let j = 0;
  for (const op of ops) {
    if (op === 'eq') {
      result.push(a[i] as number);
      i += 1;
      j += 1;
    } else if (op === 'del') {
      i += 1;
    } else {
      result.push(b[j] as number);
      j += 1;
    }
  }
  return result;
}

describe('diff', () => {
  it('prints the normal format and exits 1 when the files differ', async () => {
    const s = await withFiles();
    expect(await s.run('diff f1 f2')).toMatchObject({ status: 1, stdoutPlain: '2c2\n< b\n---\n> B\n3a4\n> d' });
    expect(await s.run('diff f2 f1')).toMatchObject({ status: 1, stdoutPlain: '2c2\n< B\n---\n> b\n4d3\n< d' });
    expect(await s.run('diff f1 f1')).toMatchObject({ status: 0, stdoutPlain: '' });
    s.stop();
  });

  it('prints the unified format with -u and -U NUM', async () => {
    const s = await withFiles();
    const stamp = '2026-10-06 20:01:00.000000000 +1100';
    expect((await s.run('diff -u f1 f2')).stdoutPlain).toBe(`--- f1\t${stamp}\n+++ f2\t${stamp}\n@@ -1,3 +1,4 @@\n a\n-b\n+B\n c\n+d`);
    expect((await s.run('diff -U0 f1 f2')).stdoutPlain).toBe(`--- f1\t${stamp}\n+++ f2\t${stamp}\n@@ -2 +2 @@\n-b\n+B\n@@ -3,0 +4 @@\n+d`);
    expect((await s.run('diff -u --label old --label new f1 f2')).stdoutPlain.split('\n').slice(0, 2)).toEqual(['--- old', '+++ new']);
    s.stop();
  });

  it('splits far-apart changes into hunks with their context', async () => {
    const s = await session(pipe);
    await s.run('seq 20 > a; seq 20 | sed -e 2s/2/two/ -e 19s/19/nineteen/ > b');
    expect((await s.run('diff -U1 --label a --label b a b')).stdoutPlain).toBe(
      '--- a\n+++ b\n@@ -1,3 +1,3 @@\n 1\n-2\n+two\n 3\n@@ -18,3 +18,3 @@\n 18\n-19\n+nineteen\n 20',
    );
    // Close enough that their context touches: one hunk.
    expect((await s.run('diff -U8 --label a --label b a b')).stdoutPlain.match(/^@@/gm)).toHaveLength(1);
    s.stop();
  });

  it('says when a last line has no newline', async () => {
    const s = await session(pipe);
    await s.run("printf 'a' > h1; printf 'a\\n' > h2");
    expect((await s.run('diff h1 h2')).stdoutPlain).toBe('1c1\n< a\n\\ No newline at end of file\n---\n> a');
    s.stop();
  });

  it('reports with -q and -s, and ignores case and blanks when asked', async () => {
    const s = await withFiles();
    expect(await s.run('diff -q f1 f2')).toMatchObject({ status: 1, stdoutPlain: 'Files f1 and f2 differ' });
    expect(await s.run('diff -s f1 f1')).toMatchObject({ status: 0, stdoutPlain: 'Files f1 and f1 are identical' });
    expect(await s.run('diff -i f1 f2')).toMatchObject({ status: 1, stdoutPlain: '3a4\n> d' });
    await s.run("printf 'a  b\\n' > s1; printf 'a b \\n' > s2; printf 'ab\\n' > s3");
    expect((await s.run('diff -b s1 s2')).status).toBe(0);
    expect((await s.run('diff -b s1 s3')).status).toBe(1);
    expect((await s.run('diff -w s1 s3')).status).toBe(0);
    s.stop();
  });

  it('reads standard input for -, and a file of the same name in a folder', async () => {
    const s = await withFiles();
    expect(await s.run('cat f1 | diff - f1')).toMatchObject({ status: 0 });
    await s.run('mkdir d; cp f2 d/f1');
    expect(await s.run('diff f1 d')).toMatchObject({ status: 1, stdoutPlain: '2c2\n< b\n---\n> B\n3a4\n> d' });
    s.stop();
  });

  it('exits 2 for trouble, in GNU words', async () => {
    const s = await withFiles();
    expect(await s.run('diff f1 nope')).toMatchObject({ status: 2, stderrPlain: 'diff: nope: No such file or directory' });
    expect(await s.run('diff f1')).toMatchObject({ status: 2, stderrPlain: "diff: missing operand after 'f1'\nTry 'diff --help' for more information." });
    expect(await s.run('diff a b c')).toMatchObject({ status: 2, stderrPlain: "diff: extra operand 'c'\nTry 'diff --help' for more information." });
    expect(await s.run('diff --nope f1 f2')).toMatchObject({ status: 2 });
    s.stop();
  });

  it('finds a shortest edit script that turns the first into the second', () => {
    expect(myers([1, 2, 3], [1, 2, 3])).toEqual(['eq', 'eq', 'eq']);
    expect(myers([], [1])).toEqual(['ins']);
    expect(myers([1], [])).toEqual(['del']);
    // The classic example: ABCABBA to CBABAC takes five edits.
    const a = Array.from('ABCABBA', (c) => c.charCodeAt(0));
    const b = Array.from('CBABAC', (c) => c.charCodeAt(0));
    const ops = myers(a, b);
    expect(ops.filter((op) => op !== 'eq')).toHaveLength(5);
    expect(apply(a, b, ops)).toEqual(b);
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 0, max: 4 }), { maxLength: 30 }), fc.array(fc.integer({ min: 0, max: 4 }), { maxLength: 30 }), (x, y) => {
        const edit = myers(x, y);
        expect(apply(x, y, edit)).toEqual(y);
        expect(edit.filter((op) => op !== 'del')).toHaveLength(y.length);
        expect(edit.filter((op) => op !== 'ins')).toHaveLength(x.length);
      }),
    );
  });

  it('formats changes as GNU diff does', () => {
    const lines = (...texts: string[]) => texts.map((text) => ({ text, nl: true }));
    const a = { lines: lines('x', 'y'), label: 'a' };
    const b = { lines: lines('x', 'z', 'w'), label: 'b' };
    const found = changes(myers([0, 1], [0, 2, 3]));
    expect(found).toEqual([{ i1: 1, i2: 2, j1: 1, j2: 3 }]);
    expect(normalFormat(a, b, found)).toBe('2c2,3\n< y\n---\n> z\n> w\n');
    expect(unifiedFormat(a, b, found, 3)).toBe('--- a\n+++ b\n@@ -1,2 +1,3 @@\n x\n-y\n+z\n+w\n');
  });
});
