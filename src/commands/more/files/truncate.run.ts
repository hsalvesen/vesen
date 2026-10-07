// The body of truncate; its spec, in truncate.ts, loads this the first time truncate runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import type { Stat } from '../../../vfs/types';
import { byteLength } from '../../../vfs/vfs';
import { errorCode, reason } from '../../lib/files';

/** What --help, help and man say about truncate, besides its spec (truncate.ts). */
export const doc: CommandDoc = {
  description:
    "Sets the size of each FILE to SIZE bytes, creating it unless -c is given: a file made longer gains NUL bytes at the end, one made shorter loses its end. SIZE may start with + or - to add or take away, < or > for at most or at least, / or % to round down or up to a multiple. K, M and G (or KiB, MiB, GiB) are powers of 1024, and KB, MB and GB powers of 1000. vesen keeps files in 512 KiB at most, so a file cannot grow past that.",
  man: [{ heading: 'EXIT STATUS', body: '0 when every FILE was set to its size, 1 otherwise.' }],
};

type Op = '' | '+' | '-' | '<' | '>' | '/' | '%';

interface Size {
  readonly op: Op;
  readonly n: number;
}

const POWERS = 'KMGTPE';

/** SIZE as truncate reads it; null when it is not a number. */
export function parseSize(text: string): Size | null {
  const match = /^([+\-<>/%]?)\s*(\d+)(?:([KMGTPEkm])(iB|B)?)?$/.exec(text);
  if (match === null) return null;
  const unit = (match[3] ?? '').toUpperCase();
  const base = match[4] === 'B' ? 1000 : 1024;
  const n = Number(match[2]) * (unit === '' ? 1 : base ** (POWERS.indexOf(unit) + 1));
  return Number.isSafeInteger(n) ? { op: (match[1] ?? '') as Op, n } : null;
}

/** The size `size` gives a file of `current` bytes. */
function resize(size: Size, current: number): number {
  switch (size.op) {
    case '+':
      return current + size.n;
    case '-':
      return Math.max(0, current - size.n);
    case '<':
      return Math.min(current, size.n);
    case '>':
      return Math.max(current, size.n);
    case '/':
      return Math.floor(current / size.n) * size.n;
    case '%':
      return Math.ceil(current / size.n) * size.n;
    case '':
      return size.n;
  }
}

/** The first `bytes` bytes of `text`, ending on a whole character. */
function cut(text: string, bytes: number): string {
  let used = 0;
  let end = 0;
  for (const ch of text) {
    const width = byteLength(ch);
    if (used + width > bytes) break;
    used += width;
    end += ch.length;
  }
  return text.slice(0, end);
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const sizeText = typeof ctx.opts.size === 'string' ? ctx.opts.size : undefined;
  const reference = typeof ctx.opts.reference === 'string' ? ctx.opts.reference : undefined;
  if (sizeText === undefined && reference === undefined) return ctx.usage("you must specify either '--size' or '--reference'");
  if (ctx.args.length === 0) return ctx.usage('missing file operand');
  let size: Size | null = null;
  if (sizeText !== undefined) {
    size = parseSize(sizeText);
    if (size === null) return ctx.fail(`Invalid number: '${sizeText}'`);
    if ((size.op === '/' || size.op === '%') && size.n === 0) return ctx.fail('division by zero');
  }
  let referenceSize: number | null = null;
  if (reference !== undefined) {
    if (size !== null && size.op === '') return ctx.usage("you must specify a relative '--size' with '--reference'");
    try {
      referenceSize = ctx.fs.stat(ctx.resolve(reference)).size;
    } catch (error) {
      return ctx.fail(`cannot stat '${reference}': ${reason(error)}`);
    }
  }
  let status = 0;
  for (const typed of ctx.args) {
    if (ctx.signal.aborted) throw ctx.signal.reason;
    const path = ctx.resolve(typed);
    let stat: Stat | null = null;
    try {
      stat = ctx.fs.stat(path);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') {
        status = await ctx.fail(`cannot open '${typed}' for writing: ${reason(error)}`);
        continue;
      }
    }
    if (stat === null && ctx.opts['no-create'] === true) continue;
    if (stat?.type === 'directory') {
      status = await ctx.fail(`cannot open '${typed}' for writing: Is a directory`);
      continue;
    }
    const current = stat?.size ?? 0;
    const from = referenceSize ?? current;
    const target = size === null ? from : resize(size, from);
    const { used, quota } = ctx.fs.usage();
    try {
      if (stat !== null && !ctx.fs.access(path, 'w')) {
        status = await ctx.fail(`cannot open '${typed}' for writing: Permission denied`);
        continue;
      }
      // Checked before the NULs are made, so a size of 1G never builds a gigabyte of text.
      if (target - current > quota - used) {
        status = await ctx.fail(`failed to truncate '${typed}' at ${target} bytes: No space left on device`);
        continue;
      }
      if (stat !== null && target === current) continue;
      const text = stat === null || target === 0 ? '' : ctx.fs.readFile(path);
      ctx.fs.writeFile(path, target <= current ? cut(text, target) : text + '\0'.repeat(target - current));
    } catch (error) {
      const code = errorCode(error);
      status = await ctx.fail(code === 'ENOSPC' ? `failed to truncate '${typed}' at ${target} bytes: ${reason(error)}` : `cannot open '${typed}' for writing: ${reason(error)}`);
    }
  }
  return status;
}
