// The body of set; its spec, in set.ts, loads this the first time set runs, so the
// kernel's chunk carries only the spec.

import { out } from '../../output/model';
import type { CommandContext, CommandDoc, ExitCode, ShellOptionFlags } from '../../shell/types';

/** What --help, help and man say about set, besides its spec (set.ts). */
export const doc: CommandDoc = {
  description:
    "With nothing, lists every shell variable. -o OPTION turns an option on and +o OPTION off; 'set -o' alone lists them. noclobber (-C) stops > from overwriting a file; noglob (-f) turns off pathname expansion.",
};

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
  await ctx.stderr.line(out.span(`vesen: set: ${message}`, { fg: 'error' }));
  await ctx.stderr.line(out.span('set: usage: set [-Cf] [-o option-name] [--] [arg ...]', { fg: 'muted' }));
  return 2;
}

/** Runs set. */
export async function run(ctx: CommandContext): Promise<ExitCode | void> {
  const words = ctx.args;
  if (words.length === 1 && words[0] === '--help') {
    const { commandHelp } = await import('../../shell/help');
    for (const block of commandHelp({ ...ctx.spec, ...doc })) await ctx.stdout.block(block);
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
      await ctx.stderr.line(out.span('vesen: set: positional parameters are not supported in vesen', { fg: 'error' }));
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
        await ctx.stderr.line(out.span(`vesen: set: ${sign}${letter}: not supported in vesen`, { fg: 'error' }));
        return 1;
      }
      return invalid(ctx, `${sign}${letter}: invalid option`);
    }
  }
  return 0;
}
