// The body of free; its spec, in free.ts, loads this the first time free runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { memInfo } from '../../lib/sysread';

/** What --help, help and man say about free, besides its spec (free.ts). */
export const doc: CommandDoc = {
  description:
    "Shows how much memory is in use and how much is free, and the same for swap, in kibibytes unless an option picks another unit. The total is the device's memory as the browser reports it, which it rounds and caps at 8 GB; how it is shared out is a picture of a busy system, not a measurement, since a page cannot see the rest of the device. The figures are the ones in /proc/meminfo, so `cat /proc/meminfo` agrees. used is total less available; buff/cache is buffers and page cache together, or with -w in two columns.",
};

const UNITS = ['K', 'M', 'G', 'T', 'P'] as const;

/** A size in bytes the way free -h writes it: at most four characters and an i, as `5.0Gi`, `285Mi` or `0B`. */
export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)}B`;
  for (const [i, unit] of UNITS.entries()) {
    const value = bytes / 1024 ** (i + 1);
    const tenths = `${value.toFixed(1)}${unit}`;
    if (tenths.length <= 4) return `${tenths}i`;
    const whole = `${Math.round(value)}${unit}`;
    if (whole.length <= 4) return `${whole}i`;
  }
  return `${Math.round(bytes / 1024 ** UNITS.length)}Ei`;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args[0] !== undefined) return ctx.usage(`extra operand '${ctx.args[0]}'`);
  const info = memInfo(ctx);
  const kb = (name: string): number => info.get(name) ?? 0;
  const total = kb('MemTotal');
  const available = Math.min(kb('MemAvailable'), total);
  const buffers = kb('Buffers');
  const cache = kb('Cached') + kb('SReclaimable');
  const swapTotal = kb('SwapTotal');
  const swapFree = kb('SwapFree');

  const show = (kib: number): string => {
    if (ctx.opts.human === true) return humanSize(kib * 1024);
    if (ctx.opts.bytes === true) return String(kib * 1024);
    if (ctx.opts.gibi === true) return String(Math.floor(kib / 1024 / 1024));
    if (ctx.opts.mebi === true) return String(Math.floor(kib / 1024));
    return String(kib);
  };
  const row = (label: string, values: readonly number[]): string => `${label.padEnd(8)}${values.map((value) => show(value).padStart(12)).join('')}`;

  const wide = ctx.opts.wide === true;
  const heads = ['total', 'used', 'free', 'shared', ...(wide ? ['buffers', 'cache'] : ['buff/cache']), 'available'];
  const used = total - available;
  const lines = [
    `${''.padEnd(8)}${heads.map((head) => head.padStart(12)).join('')}`,
    row('Mem:', [total, used, kb('MemFree'), kb('Shmem'), ...(wide ? [buffers, cache] : [buffers + cache]), available]),
    row('Swap:', [swapTotal, swapTotal - swapFree, swapFree]),
  ];
  if (ctx.opts.total === true) lines.push(row('Total:', [total + swapTotal, used + swapTotal - swapFree, kb('MemFree') + swapFree]));
  await ctx.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}
