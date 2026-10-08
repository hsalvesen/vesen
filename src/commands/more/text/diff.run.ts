// The body of diff; its spec, in diff.ts, loads this the first time diff runs. The changes are
// found with Myers' O(ND) algorithm, after the lines the files start and end with in common are
// set aside.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { basename } from '../../../vfs/path';
import { reason } from '../../lib/files';
import { statDate } from '../../lib/listing';
import { optList, optOn, quoted, readOperand, splitRecords, type Rec } from '../../lib/text-input';

export const doc: CommandDoc = {
  description:
    "Compares FILE1 and FILE2 line by line and prints what must change to make the first the second. By default each change is a line such as 2c2 or 3a4,5 followed by the old lines (<) and the new (>); -u prints the unified form instead, with the lines around each change as context. A FILE of - is standard input; a folder and a file compares the file with the one of the same name in the folder.",
  man: [
    {
      heading: 'NOTES',
      body: 'Very different files are compared up to a limit, past which the rest of the difference is shown as one change. Comparing two folders is not supported in vesen.',
    },
    { heading: 'EXIT STATUS', body: '0 when the inputs are the same, 1 when they differ, 2 for trouble.' },
  ],
};

/** The most differences followed exactly; past it, the middle is one change. */
const MAX_D = 1000;

export type Op = 'eq' | 'del' | 'ins';

/** The shortest edit script from `a` to `b`, as Myers finds it, for sequences of numbers. */
export function myers(a: readonly number[], b: readonly number[]): Op[] {
  // The common start and end need no search.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  const A = a.slice(start, endA);
  const B = b.slice(start, endB);
  const head: Op[] = Array<Op>(start).fill('eq');
  const tail: Op[] = Array<Op>(a.length - endA).fill('eq');
  const n = A.length;
  const m = B.length;
  // The frontier reaches at most MAX_D diagonals either way, so it is never larger than that,
  // however long the inputs are.
  const reach = Math.min(n + m, MAX_D);
  const offset = reach + 1;
  const v = new Int32Array(2 * reach + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= reach; d += 1) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0)) ? (v[offset + k + 1] ?? 0) : (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && A[x] === B[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
    if (found !== -1) break;
  }
  if (found === -1) {
    // Too different to follow exactly: everything between the common ends is one change.
    return [...head, ...Array<Op>(n).fill('del'), ...Array<Op>(m).fill('ins'), ...tail];
  }
  // Walk back through the saved frontiers.
  const ops: Op[] = [];
  let x = n;
  let y = m;
  for (let d = found; d > 0; d -= 1) {
    const saved = trace[d] as Int32Array;
    const at = (k: number): number => saved[k + d + 1] ?? 0;
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const prevX = at(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push('eq');
      x -= 1;
      y -= 1;
    }
    if (prevK === k + 1) {
      ops.push('ins');
      y -= 1;
    } else {
      ops.push('del');
      x -= 1;
    }
  }
  while (x > 0 && y > 0) {
    ops.push('eq');
    x -= 1;
    y -= 1;
  }
  ops.reverse();
  return [...head, ...ops, ...tail];
}

/** A run of changes: lines [i1, i2) of the old file become lines [j1, j2) of the new. */
export interface Change {
  readonly i1: number;
  readonly i2: number;
  readonly j1: number;
  readonly j2: number;
}

export function changes(ops: readonly Op[]): Change[] {
  const found: Change[] = [];
  let i = 0;
  let j = 0;
  let k = 0;
  while (k < ops.length) {
    if (ops[k] === 'eq') {
      i += 1;
      j += 1;
      k += 1;
      continue;
    }
    const i1 = i;
    const j1 = j;
    while (k < ops.length && ops[k] !== 'eq') {
      if (ops[k] === 'del') i += 1;
      else j += 1;
      k += 1;
    }
    found.push({ i1, i2: i, j1, j2: j });
  }
  return found;
}

const NO_NEWLINE = '\\ No newline at end of file\n';

interface Side {
  readonly lines: readonly Rec[];
  readonly label: string;
}

function show(side: Side, index: number, mark: string): string {
  const rec = side.lines[index] as Rec;
  return `${mark}${rec.text}\n${rec.nl ? '' : NO_NEWLINE}`;
}

const span = (from: number, to: number): string => (to - from <= 1 ? String(from + 1) : `${from + 1},${to}`);

export function normalFormat(a: Side, b: Side, found: readonly Change[]): string {
  let out = '';
  for (const c of found) {
    const dels = c.i2 > c.i1;
    const ins = c.j2 > c.j1;
    if (dels && ins) out += `${span(c.i1, c.i2)}c${span(c.j1, c.j2)}\n`;
    else if (dels) out += `${span(c.i1, c.i2)}d${c.j1}\n`;
    else out += `${c.i1}a${span(c.j1, c.j2)}\n`;
    for (let i = c.i1; i < c.i2; i += 1) out += show(a, i, '< ');
    if (dels && ins) out += '---\n';
    for (let j = c.j1; j < c.j2; j += 1) out += show(b, j, '> ');
  }
  return out;
}

const range = (start: number, length: number): string => (length === 0 ? `${start},0` : length === 1 ? String(start + 1) : `${start + 1},${length}`);

export function unifiedFormat(a: Side, b: Side, found: readonly Change[], context: number): string {
  let out = `--- ${a.label}\n+++ ${b.label}\n`;
  let g = 0;
  while (g < found.length) {
    // Changes whose context touches are one hunk.
    let last = g;
    while (last + 1 < found.length && (found[last + 1] as Change).i1 - (found[last] as Change).i2 <= 2 * context) last += 1;
    const first = found[g] as Change;
    const end = found[last] as Change;
    const aStart = Math.max(0, first.i1 - context);
    const aEnd = Math.min(a.lines.length, end.i2 + context);
    const bStart = first.j1 - (first.i1 - aStart);
    const bEnd = end.j2 + (aEnd - end.i2);
    out += `@@ -${range(aStart, aEnd - aStart)} +${range(bStart, bEnd - bStart)} @@\n`;
    let i = aStart;
    for (let k = g; k <= last; k += 1) {
      const c = found[k] as Change;
      for (; i < c.i1; i += 1) out += show(a, i, ' ');
      for (let x = c.i1; x < c.i2; x += 1) out += show(a, x, '-');
      for (let y = c.j1; y < c.j2; y += 1) out += show(b, y, '+');
      i = c.i2;
    }
    for (; i < aEnd; i += 1) out += show(a, i, ' ');
    g = last + 1;
  }
  return out;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const [first, second, extra] = ctx.args;
  if (first === undefined) return ctx.usage('missing operand');
  if (second === undefined) return ctx.usage(`missing operand after ${quoted(first)}`);
  if (extra !== undefined) return ctx.usage(`extra operand ${quoted(extra)}`);

  let stdinText: string | null = null;
  const read = async (name: string, other: string): Promise<{ text: string; mtime: number; shown: string } | null> => {
    if (name === '-') {
      stdinText ??= await readOperand(ctx, name);
      return stdinText === null ? null : { text: stdinText, mtime: ctx.clock.now(), shown: '-' };
    }
    let path = ctx.resolve(name);
    let shown = name;
    try {
      if (ctx.fs.stat(path).type === 'directory') {
        if (other === '-' || ctx.fs.stat(ctx.resolve(other)).type === 'directory') {
          await ctx.fail('comparing two folders is not supported in vesen', 2);
          return null;
        }
        shown = `${name.replace(/\/+$/, '')}/${basename(ctx.resolve(other))}`;
        path = ctx.resolve(shown);
      }
      return { text: ctx.fs.readFile(path), mtime: ctx.fs.stat(path).mtime, shown };
    } catch (error) {
      await ctx.fail(`${shown}: ${reason(error)}`, 2);
      return null;
    }
  };
  const left = await read(first, second);
  if (left === null) return 2;
  const right = await read(second, first);
  if (right === null) return 2;

  const fold = optOn(ctx, 'ignore-case');
  const allSpace = optOn(ctx, 'ignore-all-space');
  const spaceChange = optOn(ctx, 'ignore-space-change');
  const ids = new Map<string, number>();
  const id = (rec: Rec): number => {
    let key = rec.text;
    if (fold) key = key.toLowerCase();
    if (allSpace) key = key.replace(/\s+/g, '');
    else if (spaceChange) key = key.replace(/\s+$/, '').replace(/\s+/g, ' ');
    // A last line without a newline differs from the same line with one, as in GNU diff.
    if (!rec.nl) key += '\0';
    let n = ids.get(key);
    if (n === undefined) {
      n = ids.size;
      ids.set(key, n);
    }
    return n;
  };
  const a = splitRecords(left.text);
  const b = splitRecords(right.text);
  const found = changes(myers(a.map(id), b.map(id)));

  if (found.length === 0) {
    if (optOn(ctx, 'report-identical-files')) await ctx.stdout.write(`Files ${left.shown} and ${right.shown} are identical\n`);
    return 0;
  }
  if (optOn(ctx, 'brief')) {
    await ctx.stdout.write(`Files ${left.shown} and ${right.shown} differ\n`);
    return 1;
  }
  const unified = ctx.opts.unified ?? (optOn(ctx, 'u') ? 3 : undefined);
  if (unified !== undefined) {
    const labels = optList(ctx, 'label');
    const tz = ctx.clock.timeZone();
    const sideA: Side = { lines: a, label: labels[0] ?? `${left.shown}\t${statDate(left.mtime, tz)}` };
    const sideB: Side = { lines: b, label: labels[1] ?? `${right.shown}\t${statDate(right.mtime, tz)}` };
    await ctx.stdout.write(unifiedFormat(sideA, sideB, found, Math.max(0, Number(unified))));
    return 1;
  }
  await ctx.stdout.write(normalFormat({ lines: a, label: left.shown }, { lines: b, label: right.shown }, found));
  return 1;
}
