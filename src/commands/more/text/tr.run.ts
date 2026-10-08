// The body of tr; its spec, in tr.ts, loads this the first time tr runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { pacer, quoted } from '../../lib/text-input';

export const doc: CommandDoc = {
  description:
    'Copies standard input to standard output, translating, squeezing or deleting characters. Each STRING is a set of characters: a character, an escape such as \\n, \\t or \\NNN (octal), a range such as a-z, a class such as [:alpha:], [=c=] for c, or in STRING2 [c*N] for N copies of c and [c*] for as many as STRING1 needs. When translating, each character of STRING1 becomes the character at the same place in STRING2, whose last character repeats as needed.',
  man: [
    {
      heading: 'CLASSES',
      body: '[:alnum:] [:alpha:] [:blank:] [:cntrl:] [:digit:] [:graph:] [:lower:] [:print:] [:punct:] [:space:] [:upper:] [:xdigit:]. When translating, only [:lower:] and [:upper:] may appear in STRING2, opposite each other in STRING1, to change case.',
    },
    { heading: 'EXIT STATUS', body: '0 on success, 1 for a bad STRING or a wrong number of them.' },
  ],
};

const range = (from: number, to: number): string[] => {
  const chars: string[] = [];
  for (let c = from; c <= to; c += 1) chars.push(String.fromCodePoint(c));
  return chars;
};

const CLASSES: Readonly<Record<string, () => string[]>> = {
  alnum: () => [...range(48, 57), ...range(65, 90), ...range(97, 122)],
  alpha: () => [...range(65, 90), ...range(97, 122)],
  blank: () => ['\t', ' '],
  cntrl: () => [...range(0, 31), '\x7f'],
  digit: () => range(48, 57),
  graph: () => range(33, 126),
  lower: () => range(97, 122),
  print: () => range(32, 126),
  punct: () => [...range(33, 47), ...range(58, 64), ...range(91, 96), ...range(123, 126)],
  space: () => ['\t', '\n', '\v', '\f', '\r', ' '],
  upper: () => range(65, 90),
  xdigit: () => [...range(48, 57), ...range(65, 70), ...range(97, 102)],
};

const ESCAPES: Readonly<Record<string, string>> = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v', '\\': '\\' };

/** One piece of a set as written. */
type Piece =
  | { readonly t: 'char'; readonly c: string }
  | { readonly t: 'class'; readonly name: string }
  | { readonly t: 'repeat'; readonly c: string; readonly n: number | null };

/** Reads a character at `i`, escapes included. */
function readChar(s: string, i: number): { c: string; next: number } {
  if (s.charAt(i) === '\\' && i + 1 < s.length) {
    const octal = /^[0-7]{1,3}/.exec(s.slice(i + 1));
    if (octal !== null) return { c: String.fromCharCode(parseInt(octal[0], 8) & 0xff), next: i + 1 + octal[0].length };
    const d = s.charAt(i + 1);
    return { c: ESCAPES[d] ?? d, next: i + 2 };
  }
  const c = String.fromCodePoint(s.codePointAt(i) ?? 0);
  return { c, next: i + c.length };
}

/** Parses a STRING into pieces; throws GNU's complaint. */
export function parseSet(s: string, second: boolean): Piece[] {
  const pieces: Piece[] = [];
  let i = 0;
  while (i < s.length) {
    if (s.charAt(i) === '[') {
      const cls = /^\[:([a-z]+):\]/.exec(s.slice(i));
      if (cls !== null) {
        const name = cls[1] ?? '';
        if (CLASSES[name] === undefined) throw new Error(`invalid character class ${quoted(name)}`);
        pieces.push({ t: 'class', name });
        i += cls[0].length;
        continue;
      }
      const eq = /^\[=(.)=\]/u.exec(s.slice(i));
      if (eq !== null) {
        pieces.push({ t: 'char', c: eq[1] ?? '' });
        i += eq[0].length;
        continue;
      }
      if (second) {
        const inner = readChar(s, i + 1);
        const rep = /^\*(\d*)\]/.exec(s.slice(inner.next));
        if (rep !== null && inner.next > i + 1) {
          const digits = rep[1] ?? '';
          const n = digits === '' ? null : digits.startsWith('0') ? parseInt(digits, 8) : Number(digits);
          if (Number.isNaN(n)) throw new Error(`invalid repeat count ${quoted(digits)} in [c*n] construct`);
          pieces.push({ t: 'repeat', c: inner.c, n: n === 0 ? null : n });
          i = inner.next + rep[0].length;
          continue;
        }
      }
    }
    const start = readChar(s, i);
    if (s.charAt(start.next) === '-' && start.next + 1 < s.length) {
      const end = readChar(s, start.next + 1);
      const from = start.c.codePointAt(0) ?? 0;
      const to = end.c.codePointAt(0) ?? 0;
      if (to < from) {
        throw new Error(`range-endpoints of ${quoted(`${s.slice(i, end.next)}`)} are in reverse collating sequence order`);
      }
      for (const c of range(from, to)) pieces.push({ t: 'char', c });
      i = end.next;
      continue;
    }
    pieces.push({ t: 'char', c: start.c });
    i = start.next;
  }
  return pieces;
}

/**
 * The characters of a set, with [c*] filled to `fill` characters. A [c*N] is cut short where
 * nothing could read the rest: past STRING1's length (`fill`) and the 256 places a complement
 * maps; its character stays where it is, so the set's last character is the same. So
 * [x*1000000000] costs no more than [x*300].
 */
export function expand(pieces: readonly Piece[], fill = 0): string[] {
  const fixed = pieces.reduce((n, p) => n + (p.t === 'char' ? 1 : p.t === 'class' ? (CLASSES[p.name]?.() ?? []).length : (p.n ?? 0)), 0);
  const most = Math.max(fill, 256) + 1;
  const chars: string[] = [];
  for (const p of pieces) {
    if (p.t === 'char') chars.push(p.c);
    else if (p.t === 'class') chars.push(...(CLASSES[p.name]?.() ?? []));
    else for (let k = Math.min(p.n ?? Math.max(0, fill - fixed), most); k > 0; k -= 1) chars.push(p.c);
  }
  return chars;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const complement = ctx.opts.complement === true;
  const del = ctx.opts.delete === true;
  const squeeze = ctx.opts['squeeze-repeats'] === true;
  const truncate = ctx.opts['truncate-set1'] === true;
  const [first, second, extra] = ctx.args;
  const translating = !del && second !== undefined;
  if (first === undefined) return ctx.usage(del || squeeze ? 'missing operand' : 'missing operand');
  if (!del && !squeeze && second === undefined) {
    return ctx.usage(`missing operand after ${quoted(first)}\nTwo strings must be given when translating.`);
  }
  if (del && !squeeze && second !== undefined) {
    return ctx.usage(`extra operand ${quoted(second)}\nOnly one string may be given when deleting without squeezing repeats.`);
  }
  if (extra !== undefined) return ctx.usage(`extra operand ${quoted(extra)}`);

  let set1: string[];
  let pieces2: Piece[] = [];
  try {
    set1 = expand(parseSet(first, false));
    if (second !== undefined) pieces2 = parseSet(second, translating);
  } catch (error) {
    return ctx.fail((error as Error).message);
  }
  if (translating && pieces2.some((p) => p.t === 'class' && p.name !== 'upper' && p.name !== 'lower')) {
    return ctx.fail("when translating, the only character classes that may appear in\nstring2 are 'upper' and 'lower'");
  }
  const in1 = new Set(set1);
  const inSet1 = (c: string): boolean => in1.has(c) !== complement;

  // The translation table.
  const map = new Map<string, string>();
  let fallback: string | null = null;
  if (translating) {
    let set2 = expand(pieces2, set1.length);
    if (set2.length === 0) return ctx.fail('when not truncating set1, string2 must be non-empty');
    if (complement) {
      // The complement in code point order, as far as it goes; past it, the last of STRING2.
      fallback = set2[set2.length - 1] ?? null;
      const rest = range(0, 255).filter((c) => !in1.has(c));
      rest.forEach((c, k) => map.set(c, set2[Math.min(k, set2.length - 1)] ?? ''));
    } else {
      if (truncate) set1 = set1.slice(0, set2.length);
      else if (set2.length < set1.length) set2 = [...set2, ...Array<string>(set1.length - set2.length).fill(set2[set2.length - 1] ?? '')];
      set1.forEach((c, k) => map.set(c, set2[k] ?? c));
    }
  }
  const squeezeSet = new Set(squeeze ? (second !== undefined ? expand(pieces2, set1.length) : set1) : []);
  const inSqueeze = (c: string): boolean => (second === undefined && complement ? !squeezeSet.has(c) : squeezeSet.has(c));

  const breathe = pacer(ctx);
  let last: string | null = null;
  for await (const chunk of ctx.stdin.chunks()) {
    let out = '';
    for (const ch of chunk) {
      if (del && inSet1(ch)) continue;
      let c = ch;
      if (translating) c = map.get(ch) ?? (complement && !in1.has(ch) && fallback !== null ? fallback : ch);
      if (squeeze && c === last && inSqueeze(c)) continue;
      out += c;
      last = c;
    }
    if (out !== '') await ctx.stdout.write(out);
    await breathe();
  }
  return 0;
}
