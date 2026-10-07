// fortune: the sayings, chosen with the clock's random number, so a test can say which one.
import { describe, expect, it } from 'vitest';
import { runLine } from '../../../../tests/harness';
import { FORTUNES, isShort, pickFortune, SHORT_MAX } from '../../lib/fortunes';

describe('the sayings', () => {
  it('are about sixty and more, each different, short enough to read at a glance', () => {
    expect(FORTUNES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(FORTUNES).size).toBe(FORTUNES.length);
    for (const fortune of FORTUNES) {
      expect(fortune.trim()).toBe(fortune);
      expect(fortune.split('\n').length).toBeLessThanOrEqual(4);
      for (const line of fortune.split('\n')) expect(line.length, line).toBeLessThanOrEqual(100);
    }
  });

  it('include a few about the animals the themes are named after', () => {
    for (const animal of ['wombat', 'kookaburra', 'cassowary', 'kangaroo', 'crocodile']) {
      expect(FORTUNES.some((fortune) => fortune.toLowerCase().includes(animal)), animal).toBe(true);
    }
  });

  it('are short when they are one line of SHORT_MAX characters or fewer', () => {
    expect(isShort('x'.repeat(SHORT_MAX))).toBe(true);
    expect(isShort('x'.repeat(SHORT_MAX + 1))).toBe(false);
    expect(isShort('a\nb')).toBe(false);
    expect(FORTUNES.filter(isShort).length).toBeGreaterThan(20);
  });
});

describe('choosing one', () => {
  it('is decided by the random number it is given', () => {
    expect(pickFortune(FORTUNES, () => 0)).toBe(FORTUNES[0]);
    expect(pickFortune(FORTUNES, () => 0.999999)).toBe(FORTUNES[FORTUNES.length - 1]);
    expect(pickFortune(FORTUNES, () => 0.5)).toBe(FORTUNES[Math.floor(FORTUNES.length / 2)]);
    // Out of range numbers still choose one.
    expect(pickFortune(['only'], () => 1)).toBe('only');
    expect(pickFortune(['only'], () => -1)).toBe('only');
  });

  it('uses the shell clock, so the same random number gives the same saying', async () => {
    // The harness's clock always draws 0.5.
    const result = await runLine('fortune', { tty: false });
    expect(result).toMatchObject({ status: 0, stdoutPlain: FORTUNES[Math.floor(FORTUNES.length / 2)] });
    const short = FORTUNES.filter(isShort);
    expect((await runLine('fortune -s', { tty: false })).stdoutPlain).toBe(short[Math.floor(short.length / 2)]);
    expect((await runLine('fortune --short', { tty: false })).stdoutPlain).toBe(short[Math.floor(short.length / 2)]);
  });

  it('takes no operands', async () => {
    expect(await runLine('fortune cookies', { tty: false })).toMatchObject({ status: 1, stderrPlain: "fortune: extra operand 'cookies'\nTry 'fortune --help' for more information." });
  });
});
