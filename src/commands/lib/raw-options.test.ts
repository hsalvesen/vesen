// getopt_long for commands that read their own words (lib/raw-options.ts).
import { describe, expect, it } from 'vitest';
import { readOptions, type OptionTable } from './raw-options';

const TABLE: OptionTable = {
  shorts: { v: 'verbose', R: 'recursive', o: { key: 'output', value: true } },
  longs: { verbose: 'verbose', recursive: 'recursive', reference: { key: 'reference', value: true }, quiet: 'quiet', 'quieter-still': 'quiet' },
  modeChars: 'rwx+-=,',
};

describe('readOptions', () => {
  it('reads clusters, values attached or apart, and long options with = or a word', () => {
    expect(readOptions(['-vR', 'a', '-ofile', '--reference=x', 'b'], TABLE)).toEqual({
      flags: { verbose: true, recursive: true, output: 'file', reference: 'x' },
      operands: ['a', 'b'],
      modeWords: [],
    });
    expect(readOptions(['-o', 'out', '--reference', 'r', '--verb'], TABLE)).toMatchObject({ flags: { output: 'out', reference: 'r', verbose: true } });
  });

  it('ends the options at --, and keeps - as an operand', () => {
    expect(readOptions(['--', '-v', '-'], TABLE)).toMatchObject({ flags: {}, operands: ['-v', '-'] });
    expect(readOptions(['-', '-v'], TABLE)).toMatchObject({ flags: { verbose: true }, operands: ['-'] });
  });

  it('takes a dash word of mode letters as a mode', () => {
    expect(readOptions(['-w', 'f'], TABLE)).toEqual({ flags: {}, operands: ['f'], modeWords: ['-w'] });
    expect(readOptions(['-rwx', '-x', 'f'], TABLE)).toMatchObject({ modeWords: ['-rwx', '-x'] });
  });

  it("words its mistakes as getopt does", () => {
    expect(readOptions(['-z'], TABLE)).toEqual({ error: "invalid option -- 'z'" });
    expect(readOptions(['--nope'], TABLE)).toEqual({ error: "unrecognized option '--nope'" });
    expect(readOptions(['--re'], TABLE)).toEqual({ error: "option '--re' is ambiguous; possibilities: '--recursive' '--reference'" });
    expect(readOptions(['--qui'], TABLE)).toMatchObject({ flags: { quiet: true } });
    expect(readOptions(['--reference'], TABLE)).toEqual({ error: "option '--reference' requires an argument" });
    expect(readOptions(['--verbose=1'], TABLE)).toEqual({ error: "option '--verbose' doesn't allow an argument" });
    expect(readOptions(['-o'], TABLE)).toEqual({ error: "option requires an argument -- 'o'" });
  });
});
