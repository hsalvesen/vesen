import { describe, expect, it } from 'vitest';
import { FlagError, flagKey, parseFlags, rawArgsAskForHelp, takesRawArgs, tryHelp, type FlagSource } from './flags';
import type { CommandSpec, FlagSpec } from './types';
import { UsageError } from './types';

const ls: FlagSource = {
  flags: [
    { short: 'a', long: 'all', description: 'do not ignore entries starting with .' },
    { short: 'A', long: 'almost-all', description: 'do not list . and ..' },
    { short: 'l', description: 'use a long listing format' },
    { short: 'h', long: 'human-readable', description: 'print sizes like 1K' },
    { long: 'color', value: { name: 'WHEN', source: { kind: 'enum', values: () => [] }, optional: true }, description: 'colour the output' },
  ],
};

const head: FlagSource = {
  numericShortcut: 'lines',
  flags: [
    { short: 'n', long: 'lines', value: { name: 'NUM', source: { kind: 'int' }, default: '10' }, description: 'print the first NUM lines' },
    { short: 'q', long: 'quiet', description: 'never print headers' },
  ],
};

const grep: FlagSource = {
  flags: [
    { short: 'e', long: 'regexp', key: 'patterns', value: { name: 'PATTERNS', source: { kind: 'free', placeholder: 'pattern' } }, repeatable: true, description: 'use PATTERNS' },
    { short: 'v', long: 'verbose', repeatable: true, description: 'say more' },
  ],
};

describe('short options', () => {
  it('read alone and combined', () => {
    expect(parseFlags(['-l', '-a', 'x'], ls)).toEqual({ opts: { l: true, all: true }, args: ['x'], help: false });
    expect(parseFlags(['-la', 'x'], ls).opts).toEqual({ l: true, all: true });
  });

  it('take a value attached or as the next word', () => {
    expect(parseFlags(['-n5'], head).opts.lines).toBe(5);
    expect(parseFlags(['-n', '5', 'f'], head)).toEqual({ opts: { lines: 5 }, args: ['f'], help: false });
    expect(parseFlags(['-qn3'], head).opts).toEqual({ lines: 3, quiet: true });
  });

  it('fill defaults for value options that are not given', () => {
    expect(parseFlags([], head).opts).toEqual({ lines: 10 });
  });

  it('count a repeatable flag and collect a repeatable value', () => {
    expect(parseFlags(['-vv', '-e', 'a', '--regexp=b'], grep).opts).toEqual({ verbose: 2, patterns: ['a', 'b'] });
  });
});

describe('long options', () => {
  it('take --name=value and --name value', () => {
    expect(parseFlags(['--lines=7'], head).opts.lines).toBe(7);
    expect(parseFlags(['--lines', '7'], head).opts.lines).toBe(7);
  });

  it('accept an unambiguous prefix', () => {
    expect(parseFlags(['--alm'], ls).opts).toEqual({ 'almost-all': true });
    expect(parseFlags(['--hum'], ls).opts).toEqual({ 'human-readable': true });
  });

  it('take an optional value only after =', () => {
    expect(parseFlags(['--color', 'x'], ls)).toEqual({ opts: { color: true }, args: ['x'], help: false });
    expect(parseFlags(['--color=never'], ls).opts).toEqual({ color: 'never' });
  });

  it('report an ambiguous prefix, an unknown name and a misplaced value in coreutils words', () => {
    expect(() => parseFlags(['--a'], ls)).toThrow("option '--a' is ambiguous; possibilities: '--all' '--almost-all'");
    expect(() => parseFlags(['--nope'], ls)).toThrow("unrecognized option '--nope'");
    expect(() => parseFlags(['--all=yes'], ls)).toThrow("option '--all' doesn't allow an argument");
    expect(() => parseFlags(['--lines'], head)).toThrow("option '--lines' requires an argument");
  });
});

describe('operands', () => {
  it('follow GNU permutation: options may come after operands', () => {
    expect(parseFlags(['x', '-l', 'y'], ls)).toEqual({ opts: { l: true }, args: ['x', 'y'], help: false });
  });

  it('stop at the first operand when the spec asks for POSIX order', () => {
    const echo: FlagSource = { posixArgs: true, flags: [{ short: 'n', description: 'no newline' }] };
    expect(parseFlags(['-n', 'a', '-n'], echo)).toEqual({ opts: { n: true }, args: ['a', '-n'], help: false });
  });

  it('treat everything after -- as operands, and - as an operand', () => {
    expect(parseFlags(['--', '-l', '--all'], ls).args).toEqual(['-l', '--all']);
    expect(parseFlags(['-', '-l'], ls)).toEqual({ opts: { l: true }, args: ['-'], help: false });
  });
});

describe('the numeric shortcut', () => {
  it('reads head -5 as head -n 5', () => {
    expect(parseFlags(['-5', 'f'], head)).toEqual({ opts: { lines: 5 }, args: ['f'], help: false });
  });

  it('does not apply to a spec without one', () => {
    expect(() => parseFlags(['-5'], ls)).toThrow("invalid option -- '5'");
  });
});

describe('mistakes', () => {
  it('word an unknown short option as coreutils does, as a usage error', () => {
    let caught: unknown;
    try {
      parseFlags(['-lz'], ls);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FlagError);
    expect(caught).toBeInstanceOf(UsageError);
    expect((caught as Error).message).toBe("invalid option -- 'z'");
    expect(tryHelp('ls')).toBe("Try 'ls --help' for more information.");
  });

  it('word a missing value and a bad number', () => {
    expect(() => parseFlags(['-n'], head)).toThrow("option requires an argument -- 'n'");
    expect(() => parseFlags(['-n', 'abc'], head)).toThrow("invalid argument 'abc' for '--lines'");
  });
});

describe('help', () => {
  it('is always --help, wherever it appears among the options', () => {
    expect(parseFlags(['x', '--help'], head).help).toBe(true);
    expect(parseFlags(['--nope', '--help'], head).help).toBe(true);
  });

  it('is -h only for a spec without an h flag of its own', () => {
    expect(parseFlags(['-h'], head).help).toBe(true);
    expect(parseFlags(['-qh'], head).help).toBe(true);
    expect(parseFlags(['-lh'], ls)).toEqual({ opts: { l: true, 'human-readable': true }, args: [], help: false });
  });

  it('is not an operand after --, nor the value of an option', () => {
    expect(parseFlags(['--', '--help'], head)).toEqual({ opts: { lines: 10 }, args: ['--help'], help: false });
    expect(() => parseFlags(['-n', '--help'], head)).toThrow("invalid argument '--help' for '--lines'");
  });

  it('is left to a spec that handles it itself', () => {
    expect(() => parseFlags(['--help'], head, { interceptHelp: false })).toThrow("unrecognized option '--help'");
  });

  it('reaches a POSIX-order spec only before its first operand', () => {
    expect(parseFlags(['a', '--help'], { posixArgs: true }).help).toBe(false);
  });
});

describe('helpers', () => {
  it('key a flag by key, then long, then short', () => {
    const flags: FlagSpec[] = [
      { short: 'e', long: 'regexp', key: 'patterns', description: 'x' },
      { short: 'n', long: 'lines', description: 'x' },
      { short: 'l', description: 'x' },
    ];
    expect(flags.map(flagKey)).toEqual(['patterns', 'lines', 'l']);
  });

  it('read raw-args help requests anywhere, and mark raw-args specs', () => {
    expect(rawArgsAskForHelp(['-h'])).toBe(true);
    expect(rawArgsAskForHelp(['-a', '--help'])).toBe(true);
    // F032: a later -h is an argument, and so is anything after --.
    expect(rawArgsAskForHelp(['say', '-h'])).toBe(false);
    expect(rawArgsAskForHelp(['--', '--help'])).toBe(false);
    expect(rawArgsAskForHelp(['--helpful'])).toBe(false);
    const spec = { name: 'x', category: 'fun', summary: 'x', run: () => 0 } satisfies CommandSpec;
    expect(takesRawArgs(spec)).toBe(false);
    expect(takesRawArgs({ ...spec, rawArgs: true } as CommandSpec)).toBe(true);
  });
});
