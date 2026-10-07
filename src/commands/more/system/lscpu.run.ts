// The body of lscpu; its spec, in lscpu.ts, loads this the first time lscpu runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { cpuInfo, machine } from '../../lib/sysread';

/** What --help, help and man say about lscpu, besides its spec (lscpu.ts). */
export const doc: CommandDoc = {
  description:
    "Shows the processor: its architecture, how many there are, and what /proc/cpuinfo says about them. A page cannot see the real processor, so the count is the cores your browser reports, the architecture is your device's as the browser describes it, and the model is vesen's virtual CPU.",
};

/** The modes a machine runs in, as lscpu words them. */
function opModes(arch: string): string {
  if (arch === 'x86_64' || arch === 'aarch64') return '32-bit, 64-bit';
  if (arch === 'unknown') return 'unknown';
  return '32-bit';
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args[0] !== undefined) return ctx.usage(`extra operand '${ctx.args[0]}'`);
  const cpus = cpuInfo(ctx);
  const first = cpus[0] ?? new Map<string, string>();
  const count = Math.max(1, cpus.length);
  const arch = await machine(ctx);
  const field = (name: string): string => first.get(name) ?? 'unknown';
  const mhz = Number(first.get('cpu MHz') ?? NaN);
  const rows: [number, string, string][] = [
    [0, 'Architecture', arch],
    [1, 'CPU op-mode(s)', opModes(arch)],
    [1, 'Byte Order', 'Little Endian'],
    [0, 'CPU(s)', String(count)],
    [1, 'On-line CPU(s) list', count === 1 ? '0' : `0-${count - 1}`],
    [0, 'Vendor ID', field('vendor_id')],
    [1, 'Model name', field('model name')],
    [2, 'Thread(s) per core', '1'],
    [2, 'Core(s) per socket', String(count)],
    [2, 'Socket(s)', '1'],
    [2, 'CPU max MHz', Number.isFinite(mhz) ? mhz.toFixed(4) : 'unknown'],
    [2, 'BogoMIPS', field('bogomips')],
    [2, 'Flags', field('flags')],
  ];
  const lines = rows.map(([depth, label, value]) => `${`${'  '.repeat(depth)}${label}:`.padEnd(26)}${value}`);
  await ctx.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}
