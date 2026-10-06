// set: list the shell's variables, or turn its options on and off, as bash's builtin does. vesen
// has two options: noclobber (-C), which stops > overwriting a file, and noglob (-f), which turns
// off pathname expansion. Positional parameters are not supported, and say so.

import type { RawArgsSpec } from '../../shell/flags';
import { out } from '../../output/model';
import { defineCommand, type CommandContext, type CommandSpec, type ExitCode, type RunnerChoice, type ShellOptionFlags } from '../../shell/types';

type OptionName = keyof ShellOptionFlags;

/** The options by name, and the letter each has. */
const OPTIONS: Readonly<Record<OptionName, string>> = { noclobber: 'C', noglob: 'f' };
const BY_LETTER: Readonly<Record<string, OptionName>> = { C: 'noclobber', f: 'noglob' };

/** bash's single-letter options vesen does not have. */
const ELSEWHERE = new Set(['a', 'b', 'e', 'h', 'k', 'm', 'n', 'p', 't', 'u', 'v', 'x', 'B', 'E', 'H', 'P', 'T']);

/** A value as `set` prints it: as it is when it is safe to read back, else in single quotes. */
export function setValue(value: string): string {
  return /^[\w@%+=:,./-]*$/.test(value) && value !== '' ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

function isOption(name: string): name is OptionName {
  return Object.prototype.hasOwnProperty.call(OPTIONS, name);
}

async function listOptions(ctx: CommandContext, reusable: boolean): Promise<void> {
  const options = ctx.shell.options;
  for (const name of Object.keys(OPTIONS).sort() as OptionName[]) {
    const on = options[name];
    await ctx.stdout.write(reusable ? `set ${on ? '-' : '+'}o ${name}\n` : `${name.padEnd(15)}\t${on ? 'on' : 'off'}\n`);
  }
}

async function invalid(ctx: CommandContext, message: string): Promise<ExitCode> {
  await ctx.stderr.line(out.span(`set: ${message}`, { fg: 'error' }));
  await ctx.stderr.line(out.span('set: usage: set [-Cf] [-o option-name] [--] [arg ...]', { fg: 'muted' }));
  return 2;
}

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'set',
  category: 'shell',
  summary: "list variables, or set the shell's options",
  synopsis: ['set', 'set [-Cf] [-o OPTION] [+o OPTION]', 'set -o'],
  description:
    "With nothing, lists every shell variable. -o OPTION turns an option on and +o OPTION off; 'set -o' alone lists them. noclobber (-C) stops > from overwriting a file; noglob (-f) turns off pathname expansion.",
  builtin: true,
  rawArgs: true,
  handlesHelp: true,
  flags: [
    {
      short: 'o',
      description: 'turn on OPTION (+o turns it off); alone, list the options',
      value: { name: 'OPTION', source: { kind: 'enum', values: () => Object.keys(OPTIONS).map((value) => ({ value })) } },
    },
    { short: 'C', description: 'the same as -o noclobber' },
    { short: 'f', description: 'the same as -o noglob' },
  ],
  examples: [
    { line: 'set -o', note: 'list the options', offline: true },
    { line: 'set -o noclobber', note: '> no longer overwrites a file', offline: true },
    { line: 'set +o noclobber', offline: true },
    { line: 'set', note: 'every variable', offline: true },
  ],
  seeAlso: ['export', 'unset', 'env'],
  async run(ctx) {
    const words = ctx.args;
    if (words.length === 1 && words[0] === '--help') {
      const { commandHelp } = await import('../../shell/help');
      for (const block of commandHelp(ctx.spec)) await ctx.stdout.block(block);
      return 0;
    }
    if (words.length === 0) {
      for (const [name, value] of ctx.env.entries()) await ctx.stdout.write(`${name}=${setValue(value)}\n`);
      return 0;
    }
    const options = ctx.shell.options;
    for (let i = 0; i < words.length; i += 1) {
      const word = words[i] ?? '';
      const sign = word.charAt(0);
      if (word === '--' || word === '-' || (sign !== '-' && sign !== '+')) {
        await ctx.stderr.line(out.span('set: positional parameters are not supported in vesen', { fg: 'error' }));
        return 1;
      }
      const on = sign === '-';
      for (const letter of word.slice(1)) {
        if (letter === 'o') {
          const name = words[i + 1];
          if (name === undefined) {
            await listOptions(ctx, !on);
            continue;
          }
          i += 1;
          if (!isOption(name)) return invalid(ctx, `${name}: invalid option name`);
          options[name] = on;
          continue;
        }
        const option = BY_LETTER[letter];
        if (option !== undefined) {
          options[option] = on;
          continue;
        }
        if (ELSEWHERE.has(letter)) {
          await ctx.stderr.line(out.span(`set: ${sign}${letter}: not supported in vesen`, { fg: 'error' }));
          return 1;
        }
        return invalid(ctx, `${sign}${letter}: invalid option`);
      }
    }
    return 0;
  },
};

export default defineCommand(spec);
