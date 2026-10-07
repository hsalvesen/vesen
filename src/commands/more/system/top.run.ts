// The body of top; its spec, in top.ts, loads this the first time top runs.

import { out } from '../../../output/model';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { memPercent, processTable } from '../../lib/procs';
import { cpuCount, loadAverages, memInfo, uptimeLine } from '../../lib/sysread';

/** What --help, help and man say about top, besides its spec (top.ts). */
export const doc: CommandDoc = {
  description:
    "Prints what top's first screen shows: the time, the uptime and load, the tasks, the processor and memory use, then the processes, busiest first. Interactive top is not available here, so it prints one snapshot and exits, as `top -b -n 1` does; with -n NUMBER, that many, -d SECONDS apart. The memory figures are the ones in /proc/meminfo; the processor's share is worked out from the load in /proc/loadavg, since a page cannot measure it.",
  man: [{ heading: 'SEE ALSO', body: 'ps, for the same processes in other formats; uptime and free for the summary lines alone.' }],
};

const one = (n: number, width: number): string => n.toFixed(1).padStart(width);

/** One snapshot: the summary area, a blank line and the process table. */
function snapshot(ctx: CommandContext): string[] {
  const rows = processTable(ctx);
  const running = rows.filter((row) => row.stat.startsWith('R')).length;
  const busy = Math.min(100, (loadAverages(ctx)[0] / cpuCount(ctx)) * 100);
  const info = memInfo(ctx);
  const mib = (name: string): number => (info.get(name) ?? 0) / 1024;
  const total = mib('MemTotal');
  const available = Math.min(mib('MemAvailable'), total);
  const cache = mib('Buffers') + mib('Cached');
  const swap = mib('SwapTotal');
  const lines = [
    `top -${uptimeLine(ctx)}`,
    `Tasks: ${String(rows.length).padStart(3)} total, ${String(running).padStart(3)} running, ${String(rows.length - running).padStart(3)} sleeping,   0 stopped,   0 zombie`,
    `%Cpu(s): ${one(busy * 0.7, 4)} us, ${one(busy * 0.25, 4)} sy,  0.0 ni, ${one(100 - busy, 4)} id,  0.0 wa,  0.0 hi, ${one(busy * 0.05, 4)} si,  0.0 st`,
    `MiB Mem : ${one(total, 8)} total, ${one(mib('MemFree'), 8)} free, ${one(total - available, 8)} used, ${one(cache, 8)} buff/cache`,
    `MiB Swap: ${one(swap, 8)} total, ${one(mib('SwapFree'), 8)} free, ${one(swap - mib('SwapFree'), 8)} used. ${one(available, 8)} avail Mem`,
    '',
    '    PID USER      PR  NI    VIRT    RES    SHR S  %CPU  %MEM     TIME+ COMMAND',
  ];
  // The busiest first: top itself, running, then the rest by pid.
  const ordered = [...rows].sort((a, b) => Number(b.stat.startsWith('R')) - Number(a.stat.startsWith('R')) || a.pid - b.pid);
  for (const row of ordered) {
    const state = row.stat.charAt(0);
    lines.push(
      `${String(row.pid).padStart(7)} ${row.user.padEnd(9)} 20   0 ${String(row.vsz).padStart(7)} ${String(row.rss).padStart(6)} ${String(Math.round(row.rss * 0.7)).padStart(6)} ${state} ${one(0, 5)} ${one(memPercent(ctx, row.rss), 5)}   0:00.00 ${row.comm}`,
    );
  }
  return lines;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args[0] !== undefined) return ctx.usage(`unknown argument '${ctx.args[0]}'`);
  const count = Number(ctx.opts.n ?? 1);
  if (!Number.isInteger(count) || count < 1) return ctx.fail(`bad iterations argument '${String(ctx.opts.n)}'`);
  const seconds = Number(ctx.opts.d ?? 3);
  if (!Number.isFinite(seconds) || seconds < 0) return ctx.fail(`bad delay interval '${String(ctx.opts.d)}'`);
  for (let i = 0; i < count; i += 1) {
    if (i > 0) {
      await ctx.clock.sleep(seconds * 1000, ctx.signal);
      await ctx.stdout.write('\n');
    }
    await ctx.stdout.write(`${snapshot(ctx).join('\n')}\n`);
  }
  // At the prompt, say why it did not take over the screen.
  if (ctx.stdout.isTTY && ctx.opts.b !== true) {
    await ctx.stdout.block(out.text("Interactive top isn't available in vesen: this is one snapshot, as `top -b -n 1` prints.", { fg: 'muted' }));
  }
  return 0;
}
