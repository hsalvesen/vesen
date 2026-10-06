import { describe, expect, it } from 'vitest';
import { runLine, session } from '../../../tests/harness';
import { format, parseFormat, readFloat, readInteger } from './printf';

/** printf's output for a format and arguments, without a shell. */
function printf(fmt: string, ...args: string[]): { text: string; errors: readonly string[] } {
  const pieces = parseFormat(fmt);
  if (!Array.isArray(pieces)) throw new Error(pieces.error);
  return format(pieces, args);
}

describe('echo', () => {
  it('joins its words with one space and ends the line (F040)', async () => {
    expect(await runLine('echo hello    world')).toMatchObject({ status: 0, stdoutPlain: 'hello world' });
    expect((await runLine('echo "a" "b"')).stdoutPlain).toBe('a b');
    expect((await runLine('echo "a  b"   c')).stdoutPlain).toBe('a  b c');
    expect((await runLine('echo')).stdoutPlain).toBe('');
  });

  it('prints redirection characters inside quotes as text; the shell does the redirecting', async () => {
    const s = await session();
    expect((await s.run('echo "5 > 3"')).stdoutPlain).toBe('5 > 3');
    expect((await s.run('echo one > f; echo two >> f; cat f')).stdoutPlain).toBe('one\ntwo');
    expect(s.app.vfs.readFile('/home/guest/f')).toBe('one\ntwo\n');
    s.stop();
  });

  it('reads -n, -e and -E only as leading words of those letters, as bash does', async () => {
    const s = await session({ tty: false });
    expect((await s.run('echo -n no newline')).stdoutPlain).toBe('no newline');
    expect((await s.run("echo -n x; echo -n y")).stdoutPlain).toBe('xy');
    expect((await s.run("echo -e 'a\\tb\\nc'")).stdoutPlain).toBe('a\tb\nc');
    expect((await s.run("echo 'a\\tb'")).stdoutPlain).toBe('a\\tb');
    expect((await s.run("echo -eE 'a\\tb'")).stdoutPlain).toBe('a\\tb');
    expect((await s.run("echo -ne 'x\\ty'")).stdoutPlain).toBe('x\ty');
    expect((await s.run('echo -x -- -n')).stdoutPlain).toBe('-x -- -n');
    expect((await s.run('echo hi -n')).stdoutPlain).toBe('hi -n');
    expect((await s.run("echo -e 'stop\\chere'; echo")).stdoutPlain).toBe('stop');
    s.stop();
  });

  it('shows its help for --help alone, as GNU echo does, and prints it otherwise', async () => {
    expect((await runLine('echo --help')).stdoutPlain).toContain('echo - display a line of text');
    expect((await runLine('echo say --help')).stdoutPlain).toBe('say --help');
    expect((await runLine('echo -h')).stdoutPlain).toBe('-h');
  });

  it('colours text on the terminal with -e and SGR escapes, and passes them through a pipe', async () => {
    const tty = await runLine("echo -e '\\e[31mred\\e[0m plain'");
    expect(tty.stdoutPlain).toBe('red plain');
    const first = tty.blocks[0];
    expect(first?.type === 'lines' ? first.lines[0]?.[0] : undefined).toEqual({ text: 'red', style: { fg: 'red' } });
    expect((await runLine("echo -e '\\e[31mred'", { tty: false })).stdoutPlain).toBe('\u001b[31mred');
  });
});

describe('printf', () => {
  it('reuses the format until the arguments run out', () => {
    expect(printf('%s\\n', 'a', 'b', 'c').text).toBe('a\nb\nc\n');
    expect(printf('%s %s\\n', 'a', 'b', 'c').text).toBe('a b\nc \n');
    expect(printf('no conversions\\n', 'ignored').text).toBe('no conversions\n');
    expect(printf('%d|', '1', '2').text).toBe('1|2|');
  });

  it('formats strings, characters and widths', () => {
    expect(printf('[%5s][%-5s][%.2s][%5.1s]', 'ab', 'ab', 'abc', 'xyz').text).toBe('[   ab][ab   ][ab][    x]');
    expect(printf('%c%c', 'vesen', 'shell').text).toBe('vs');
    expect(printf('[%*d][%-*d]', '4', '7', '3', '1').text).toBe('[   7][1  ]');
    expect(printf('%%').text).toBe('%');
    expect(printf('%b', 'a\\tb').text).toBe('a\tb');
    expect(printf('%b|%s', 'x\\cy', 'never').text).toBe('x');
  });

  it('formats integers in every base, with flags and precision', () => {
    expect(printf('%d %i %x %X %o', '255', '-7', '255', '255', '8').text).toBe('255 -7 ff FF 10');
    expect(printf('%05d|%+d|% d|%-4d|%.3d', '42', '42', '42', '42', '7').text).toBe('00042|+42| 42|42  |007');
    expect(printf('%#x %#o %#x', '255', '8', '0').text).toBe('0xff 010 0');
    expect(printf('%x %u', '-1', '-1').text).toBe('ffffffffffffffff 18446744073709551615');
    expect(printf('%d %d %d', '0x1F', '017', "'A").text).toBe('31 15 65');
    expect(printf('%d', '12345678901234567890').text).toBe('12345678901234567890');
  });

  it('formats floats as C does', () => {
    expect(printf('%f|%.2f|%8.3f|%-8.1f|', '3.14159', '2.005', '1.5', '2').text).toBe('3.141590|2.00|   1.500|2.0     |');
    expect(printf('%e %E', '12345.678', '0.00012').text).toBe('1.234568e+04 1.200000E-04');
    expect(printf('%g %g %g %g %G', '100', '0.0001', '123456789', '1e-5', '1e-5').text).toBe('100 0.0001 1.23457e+08 1e-05 1E-05');
    expect(printf('%f %f %F', 'inf', '-inf', 'nan').text).toBe('inf -inf NAN');
    expect(printf('%05.1f|%+.1f', '-2.5', '2').text).toBe('-02.5|+2.0');
  });

  it("reports numbers it cannot read in GNU's words, and prints what it read", () => {
    expect(printf('%d,', 'abc', '12x', '3.5')).toEqual({
      text: '0,12,3,',
      errors: ["'abc': expected a numeric value", "'12x': value not completely converted", "'3.5': value not completely converted"],
    });
    expect(readInteger(undefined)).toEqual({ value: 0n });
    expect(readFloat('1e3')).toEqual({ value: 1000 });
  });

  it('refuses a conversion it does not know', () => {
    expect(parseFormat('%z')).toEqual({ error: '%z: invalid conversion specification' });
    expect(parseFormat('%')).toEqual({ error: '%: invalid conversion specification' });
  });

  it('runs with GNU exit statuses and messages', async () => {
    expect(await runLine("printf '%d\\n' abc")).toMatchObject({ status: 1, stdoutPlain: '0', stderrPlain: "printf: 'abc': expected a numeric value" });
    expect(await runLine("printf '%z'")).toMatchObject({ status: 1, stderrPlain: 'printf: %z: invalid conversion specification' });
    expect(await runLine('printf')).toMatchObject({ status: 2, stderrPlain: "printf: missing operand\nTry 'printf --help' for more information." });
    expect(await runLine("printf -- '-%s-\\n' x")).toMatchObject({ status: 0, stdoutPlain: '-x-' });
    expect((await runLine("printf '%s' no-newline", { tty: false })).stdoutPlain).toBe('no-newline');
  });
});
