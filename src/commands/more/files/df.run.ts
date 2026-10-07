// The body of df; its spec, in df.ts, loads this the first time df runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { reason } from '../../lib/files';
import { humanSize } from '../../lib/listing';

/** What --help, help and man say about df, besides its spec (df.ts). */
export const doc: CommandDoc = {
  description:
    "Shows how full each file system is. vesenfs is vesen's own, mounted on /: its size is the 512 KiB your files may take in all, which keeps what is under ~ small enough for this browser to save. Where the browser says, a second line shows the storage it grants this site (from navigator.storage.estimate), of which vesen's files are a small part. With FILEs, it shows the file system each one is on. Sizes are in kibibytes, or in K, M and G with -h.",
  man: [{ heading: 'EXIT STATUS', body: '0 when every FILE was found, 1 otherwise.' }],
};

/** How long df waits for the browser's estimate before leaving that line out. */
const ESTIMATE_WAIT_MS = 1500;

interface Row {
  readonly source: string;
  readonly type: string;
  readonly size: number;
  readonly used: number;
  readonly avail: number;
  readonly target: string;
}

/** The browser's estimate for this site, or null when it gives none in time. */
async function estimate(ctx: CommandContext): Promise<{ usage: number; quota: number } | null> {
  const controller = new AbortController();
  try {
    const late = ctx.clock.sleep(ESTIMATE_WAIT_MS, controller.signal).then(() => null);
    return await Promise.race([ctx.sys.storage(), late]);
  } catch {
    return null;
  } finally {
    controller.abort();
  }
}

/** Columns: Filesystem, Type, 1K-blocks or Size, Used, Available or Avail, Use%, Mounted on. */
function table(rows: readonly Row[], human: boolean, typed: boolean): string[] {
  const amount = (bytes: number): string => (human ? humanSize(bytes) : String(Math.ceil(bytes / 1024)));
  const percent = (row: Row): string => (row.used + row.avail === 0 ? '-' : `${Math.ceil((row.used * 100) / (row.used + row.avail))}%`);
  const head = ['Filesystem', 'Type', human ? 'Size' : '1K-blocks', 'Used', human ? 'Avail' : 'Available', 'Use%', 'Mounted on'];
  // GNU df's narrowest columns, and which way each is aligned.
  const least = [14, 4, 5, 5, 5, 4, 0];
  const right = [false, false, true, true, true, true, false];
  const cells = rows.map((row) => [row.source, row.type, amount(row.size), amount(row.used), amount(row.avail), percent(row), row.target]);
  const shown = [0, 1, 2, 3, 4, 5, 6].filter((column) => typed || column !== 1);
  const widths = head.map((title, column) => Math.max(least[column] ?? 0, title.length, ...cells.map((cell) => (cell[column] ?? '').length)));
  return [head, ...cells].map((cell) =>
    shown
      .map((column, i) => {
        const text = cell[column] ?? '';
        if (i === shown.length - 1) return text;
        const width = widths[column] ?? 0;
        return right[column] ? text.padStart(width) : text.padEnd(width);
      })
      .join(' ')
      .trimEnd(),
  );
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const usage = ctx.fs.usage();
  const own: Row = { source: 'vesenfs', type: 'vesenfs', size: usage.quota, used: usage.used, avail: Math.max(0, usage.quota - usage.used), target: '/' };
  const rows: Row[] = [];
  let status = 0;
  if (ctx.args.length === 0) {
    rows.push(own);
    const site = await estimate(ctx);
    if (site !== null && site.quota > 0) {
      rows.push({ source: 'browser', type: 'storage', size: site.quota, used: site.usage, avail: Math.max(0, site.quota - site.usage), target: '(site data)' });
    }
  } else {
    for (const typed of ctx.args) {
      try {
        ctx.fs.stat(ctx.resolve(typed));
        rows.push(own);
      } catch (error) {
        await ctx.fail(`${typed}: ${reason(error)}`);
        status = 1;
      }
    }
    if (rows.length === 0) {
      await ctx.fail('no file systems processed');
      return 1;
    }
  }
  if (ctx.opts.total === true) {
    const sum = (pick: (row: Row) => number): number => rows.reduce((total, row) => total + pick(row), 0);
    rows.push({ source: 'total', type: '-', size: sum((row) => row.size), used: sum((row) => row.used), avail: sum((row) => row.avail), target: '-' });
  }
  for (const line of table(rows, ctx.opts['human-readable'] === true, ctx.opts['print-type'] === true)) await ctx.stdout.write(`${line}\n`);
  return status;
}
