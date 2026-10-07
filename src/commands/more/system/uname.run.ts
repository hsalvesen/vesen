// The body of uname; its spec, in uname.ts, loads this the first time uname runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { HOST } from '../../../vfs/identity';
import { KERNEL_RELEASE } from '../../../vfs/special';
import { machine, readText } from '../../lib/sysread';

/** What --help, help and man say about uname, besides its spec (uname.ts). */
export const doc: CommandDoc = {
  description:
    "Prints facts about the system, in this order: the kernel's name (-s), the host name (-n), the kernel release (-r) and version (-v), the machine (-m), the processor (-p), the hardware platform (-i) and the operating system (-o). With no option, -s. The kernel is vesen's own, as /proc/version says. The machine is your device as the browser describes it: aarch64 for an ARM phone or Apple silicon, x86_64 for most PCs, and unknown where the browser does not say, as Safari on a Mac does not.",
  man: [{ heading: 'EXIT STATUS', body: '0, or 1 when given an operand.' }],
};

/** What --help, help and man say about arch, besides its spec (arch.ts). */
export const archDoc: CommandDoc = {
  description:
    'Prints the machine hardware name, as uname -m does: your device as the browser describes it, such as aarch64 or x86_64, or unknown where the browser does not say.',
};

export async function runArch(ctx: CommandContext): Promise<ExitCode> {
  const [extra] = ctx.args;
  if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
  await ctx.stdout.write(`${await machine(ctx)}\n`);
  return 0;
}

const FIELDS = ['kernel-name', 'nodename', 'kernel-release', 'kernel-version', 'machine', 'processor', 'hardware-platform', 'operating-system'] as const;

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const [extra] = ctx.args;
  if (extra !== undefined) return ctx.usage(`extra operand '${extra}'`);
  const all = ctx.opts.all === true;
  const asked = new Set(FIELDS.filter((field) => ctx.opts[field] === true));
  if (!all && asked.size === 0) asked.add('kernel-name');
  const version = readText(ctx, '/proc/version') ?? '';
  const hash = version.indexOf('#');
  const values: Record<(typeof FIELDS)[number], string> = {
    'kernel-name': 'Linux',
    nodename: HOST,
    'kernel-release': KERNEL_RELEASE,
    'kernel-version': hash === -1 ? '#1' : version.slice(hash).trim(),
    machine: await machine(ctx),
    // Debian's uname, like most, does not know these two.
    processor: 'unknown',
    'hardware-platform': 'unknown',
    'operating-system': 'GNU/Linux',
  };
  const words = FIELDS.filter((field) => {
    if (asked.has(field)) return true;
    if (!all) return false;
    // -a leaves out the processor and platform when they are unknown, as coreutils does.
    return (field !== 'processor' && field !== 'hardware-platform') || values[field] !== 'unknown';
  }).map((field) => values[field]);
  await ctx.stdout.write(`${words.join(' ')}\n`);
  return 0;
}
