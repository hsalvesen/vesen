// qr's options, as qrencode and getopt_long read them, and every way to get them wrong.
import { describe, expect, it } from 'vitest';
import { parseQrArgs, type QrArgs } from './qr-args';

function args(...words: string[]): QrArgs {
  const parsed = parseQrArgs(words);
  if (parsed.kind !== 'args') throw new Error(`expected options, got ${JSON.stringify(parsed)}`);
  return parsed.args;
}

function error(...words: string[]): string {
  const parsed = parseQrArgs(words);
  if (parsed.kind !== 'error') throw new Error(`expected an error, got ${JSON.stringify(parsed)}`);
  return parsed.message;
}

describe('parseQrArgs', () => {
  it('defaults to a card at the default size, M raised for free, any mask, the best segments', () => {
    expect(args('vesen.app')).toEqual({ operands: ['vesen.app'], size: 'fit', type: 'svg', eightBit: false, fullscreen: false });
  });

  it.each([
    [['-eH', 'x'], 'H'],
    [['-e', 'h', 'x'], 'H'],
    [['--ec=Q', 'x'], 'Q'],
    [['--ec', 'quartile', 'x'], 'Q'],
    [['-l', 'Q', 'x'], 'Q'],
    [['--level=low', 'x'], 'L'],
    [['x', '-e', 'm'], 'M'],
  ])('reads the level from %j', (words, level) => {
    expect(args(...words).ec).toBe(level);
  });

  it('reads every option, before or after the text, in clusters and with unique prefixes', () => {
    expect(args('-8f', 'hello', '-s12', '--margin', '2', '-t', 'UTF8I', '--sym=5', '--mask', '3', '--full', 'world')).toEqual({
      operands: ['hello', 'world'],
      size: 12,
      margin: 2,
      type: 'utf8i',
      minVersion: 5,
      mask: 3,
      eightBit: true,
      fullscreen: true,
    });
    expect(args('-s', 'fit', 'x').size).toBe('fit');
    expect(args('--8bit', 'x').eightBit).toBe(true);
  });

  it('lets the last of --text and --url win', () => {
    expect(args('--text', 'vesen.app').force).toBe('text');
    expect(args('--text', '--url', 'vesen.app').force).toBe('url');
  });

  it('takes everything after -- as text, and - alone as text', () => {
    expect(args('--', '-5°C', '--help', '-e').operands).toEqual(['-5°C', '--help', '-e']);
    expect(args('-').operands).toEqual(['-']);
  });

  it('is help for -h or --help anywhere among the options, even after a mistake', () => {
    expect(parseQrArgs(['--help'])).toEqual({ kind: 'help' });
    expect(parseQrArgs(['x', '-h'])).toEqual({ kind: 'help' });
    expect(parseQrArgs(['-fh', 'x'])).toEqual({ kind: 'help' });
    expect(parseQrArgs(['--sz', '3', '--help'])).toEqual({ kind: 'help' });
    expect(parseQrArgs(['--', '--help']).kind).toBe('args');
  });

  it('names an unknown option, with the nearest one', () => {
    expect(error('--sz', '3', 'x')).toBe("unknown option '--sz'. Did you mean '--size'?");
    expect(error('--fulscreen', 'x')).toBe("unknown option '--fulscreen'. Did you mean '--fullscreen'?");
    expect(error('--colour', 'x')).toBe("unknown option '--colour'");
    expect(error('-x', 'hi')).toBe("unknown option '-x'");
    expect(error('-fz', 'hi')).toBe("unknown option '-z'");
    expect(error('-size', '3', 'hi')).toBe("unknown option '-size'. Did you mean '--size'?");
    expect(error('--m', 'x')).toBe("ambiguous option '--m': '--margin' or '--mask'");
  });

  it('says what each option needs', () => {
    expect(error('-e', 'X', 'hi')).toBe("'-e' needs one of L, M, Q, H (got 'X')");
    expect(error('--ec=Z', 'hi')).toBe("'--ec' needs one of L, M, Q, H (got 'Z')");
    expect(error('-l', 'constructor', 'hi')).toBe("'-l' needs one of L, M, Q, H (got 'constructor')");
    expect(error('-e')).toBe("'-e' needs one of L, M, Q, H");
    expect(error('-s', '0', 'hi')).toBe("'-s' needs a number from 1 to 32 or 'fit'");
    expect(error('--size=33', 'hi')).toBe("'--size' needs a number from 1 to 32 or 'fit'");
    expect(error('-s', 'big', 'hi')).toBe("'-s' needs a number from 1 to 32 or 'fit'");
    expect(error('-m', '11', 'hi')).toBe("'-m' needs a number from 0 to 10");
    expect(error('-t', 'png', 'hi')).toBe("'-t' needs one of svg, utf8, utf8i, ascii (got 'png')");
    expect(error('-v', '41', 'hi')).toBe("'-v' needs a version from 1 to 40");
    expect(error('-v0', 'hi')).toBe("'-v' needs a version from 1 to 40");
    expect(error('--mask', '9', 'hi')).toBe('--mask needs a number from 0 to 7');
    expect(error('--mask')).toBe('--mask needs a number from 0 to 7');
    expect(error('--8bit=yes', 'hi')).toBe("'--8bit' takes no value");
  });

  it('asks for -- before text that starts with a dash', () => {
    expect(error('-5°C')).toBe("to encode text that starts with '-', put -- first: qr -- -5°C");
    expect(error('-12.5')).toBe("to encode text that starts with '-', put -- first: qr -- -12.5");
    expect(error('---')).toBe("to encode text that starts with '-', put -- first: qr -- ---");
  });
});
