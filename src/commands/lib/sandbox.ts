// The commands a browser tab cannot be: traceroute, nc, ssh, telnet and ftp need raw sockets or
// packets a page cannot send. Each says so in one line, in its own name, and exits 1.

import type { CommandContext, ExitCode, RunFn } from '../../shell/types';

/**
 * The host a line names: the first word that is not an option or an option's value (`-p 22`,
 * for the letters in `valueOptions`), without a user@ in front.
 */
export function targetOf(args: readonly string[], valueOptions = ''): string | null {
  for (let i = 0; i < args.length; i += 1) {
    const word = args[i] ?? '';
    if (/^-[A-Za-z]$/.test(word) && valueOptions.includes(word.charAt(1))) i += 1;
    else if (!word.startsWith('-')) return word.replace(/^[^@]*@/, '');
  }
  return null;
}

/** A run that says `name: why`, the reason made from the host when it names one, and exits 1. */
export function sandboxed(why: string | ((target: string | null) => string), valueOptions = ''): RunFn {
  return (ctx: CommandContext): Promise<ExitCode> => ctx.fail(typeof why === 'string' ? why : why(targetOf(ctx.args, valueOptions)));
}
