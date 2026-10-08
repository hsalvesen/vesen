// Safety: no tool holds more than MAX_INPUT (16 MB) of standard input at once. Each of these
// lines ran until the tab ran out of memory before (sort, the checksums, base64, column, diff,
// bc, tail and head keeping lines back, a line with no end through grep, rev, xargs and read);
// now each fails within moments with GNU's shape of message, `NAME: standard input: input too
// large (over 16 MB)`, and closes the pipe so `yes` stops. The time bound is what proves the page
// cannot be frozen by them: before, none of these lines ended at all.
import { describe, expect, it } from 'vitest';
import { runLine, session, type LineResult } from '../../../../tests/harness';

const TOO_LARGE = 'standard input: input too large (over 16 MB)';

/** Generous for a loaded machine; each line takes well under a second alone. */
const BOUND_MS = 10_000;

async function timed(line: string): Promise<LineResult> {
  const started = performance.now();
  const result = await runLine(line, { tty: false });
  expect(performance.now() - started, line).toBeLessThan(BOUND_MS);
  return result;
}

describe('whole-input readers', () => {
  it.each([
    ['yes | sort', 'sort', 2],
    ['yes | diff - .bashrc', 'diff', 2],
    ['yes | md5sum', 'md5sum', 1],
    ['yes | base64', 'base64', 1],
    ['yes | column', 'column', 1],
    ['yes | bc', 'bc', 1],
  ])('%s stops at 16 MB with an error and status %i', async (line, name, status) => {
    const result = await timed(line);
    expect(result).toMatchObject({ status, stdoutPlain: '', stderrPlain: `${name}: ${TOO_LARGE}` });
  }, 30_000);

  it('grep -f - stops reading patterns at 16 MB, with status 2', async () => {
    expect(await timed('yes | grep -f - .bashrc')).toMatchObject({ status: 2, stderrPlain: `grep: ${TOO_LARGE}` });
  }, 30_000);

  it('still reads an input under the cap whole', async () => {
    expect((await timed('seq 1 200000 | sort -n | tail -n 1')).stdoutPlain).toBe('200000');
    expect((await timed('seq 1 200000 | md5sum')).stdoutPlain).toMatch(/^[0-9a-f]{32} {2}-$/);
  }, 30_000);
});

describe('a line with no end', () => {
  // `seq -s ''` with no end is one line that never ends (as `yes | tr -d '\n'` is, more slowly);
  // before, every line reader held it whole.
  it.each([
    ["seq -s '' 1000000000000 | grep x", 'grep'],
    ["seq -s '' 1000000000000 | rev", 'rev'],
    ["seq -s '' 1000000000000 | sed s/y/n/", 'sed'],
    ["seq -s '' 1000000000000 | xargs -d , echo", 'xargs'],
    ["seq -s '' 1000000000000 | factor", 'factor'],
    ["seq -s '' 1000000000000 | read x", 'read'],
  ])('%s stops at 16 MB', async (line, name) => {
    const result = await timed(line);
    expect(result.status).toBe(1);
    expect(result.stderrPlain).toBe(`${name}: ${TOO_LARGE}`);
  }, 30_000);
});

describe('lines and bytes kept back', () => {
  it('tail -n and head -n -N keep at most 16 MB, however many lines are asked for', async () => {
    expect(await timed('yes | tail -n 100000000000')).toMatchObject({ status: 1, stderrPlain: `tail: ${TOO_LARGE}` });
    expect(await timed('yes | head -n -100000000000')).toMatchObject({ status: 1, stderrPlain: `head: ${TOO_LARGE}` });
    expect(await timed('yes | grep -B 100000000000 x')).toMatchObject({ status: 1, stderrPlain: `grep: ${TOO_LARGE}` });
  }, 60_000);

  it('tail -c and head -c -N keep at most 16 MB, and only what they need below it', async () => {
    expect(await timed('yes | tail -c 100000000000')).toMatchObject({ status: 1, stderrPlain: `tail: ${TOO_LARGE}` });
    expect(await timed('yes | head -c -100000000000')).toMatchObject({ status: 1, stderrPlain: `head: ${TOO_LARGE}` });
    // Below it they stream: 20 MB passes through, holding back only the bytes asked for.
    expect((await timed("yes | head -c 20000000 | tail -c 6 | tr '\\n' ."))).toMatchObject({ status: 0, stdoutPlain: 'y.y.y.' });
    expect((await timed('yes | head -c 20000000 | head -c -15999996 | wc -c')).stdoutPlain).toBe('4000004');
    // Holding back more than 16 MB is over the cap, however much comes.
    expect(await timed('yes | head -c 20000000 | head -c -19999996')).toMatchObject({ status: 1, stderrPlain: `head: ${TOO_LARGE}` });
  }, 60_000);

  it('gives the same bytes as from a file, multibyte characters included', async () => {
    const s = await session({ tty: false });
    await s.run("printf 'añb€c😀d\\nend\\n' > f");
    for (const opts of ['-c 5', '-c 9', '-c +3', '-c +5', '-c 0', '-n 0', '-n +2']) {
      const file = (await s.run(`tail ${opts} f`)).stdoutPlain;
      expect((await s.run(`cat f | tail ${opts}`)).stdoutPlain, `tail ${opts}`).toBe(file);
    }
    for (const opts of ['-c -1', '-c -4', '-c -9', '-c -100', '-n -1']) {
      const file = (await s.run(`head ${opts} f`)).stdoutPlain;
      expect((await s.run(`cat f | head ${opts}`)).stdoutPlain, `head ${opts}`).toBe(file);
    }
    s.stop();
  });
});

describe('uniq', () => {
  // Before, uniq kept an entry for every line of a group, and -D every line: `yes | uniq` grew
  // without end. GNU's uniq keeps one line, and -D writes a repeated group as it goes.
  it('writes repeated lines as they come with -D, and keeps only a group\'s first line', async () => {
    expect(await timed('yes | uniq -D | head -n 3')).toMatchObject({ status: 0, stdoutPlain: 'y\ny\ny' });
    expect((await timed("printf 'a\\na\\nb\\nc\\nc\\nc\\n' | uniq -D")).stdoutPlain).toBe('a\na\nc\nc\nc');
    expect((await timed("printf 'a\\na\\nb\\n' | uniq -c")).stdoutPlain).toBe('      2 a\n      1 b');
  }, 30_000);

  it('writes an OUTPUT file as it goes', async () => {
    const s = await session({ tty: false });
    expect((await s.run("printf 'a\\na\\nb\\n' | uniq - out")).status).toBe(0);
    expect((await s.run('cat out')).stdoutPlain).toBe('a\nb');
    s.stop();
  });
});

describe('xargs', () => {
  it('refuses an item that cannot fit on a command line, as GNU xargs does', async () => {
    const result = await timed("seq -s '' 100000 | xargs echo");
    expect(result).toMatchObject({ status: 1, stdoutPlain: '', stderrPlain: 'xargs: argument line too long' });
  }, 30_000);
});

describe('$( )', () => {
  it('keeps at most 16 MB, and stops what writes it', async () => {
    const result = await timed('echo $(yes) | wc -c');
    expect(result.stderrPlain).toBe('vesen: command substitution: output too large (over 16 MB)');
    // Under it, as before: the trailing newline goes.
    expect((await timed('x=$(yes | head -c 100); echo ${#x}')).stdoutPlain).toBe('99');
  }, 30_000);
});
