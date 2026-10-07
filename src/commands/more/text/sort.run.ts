// The body of sort; its spec, in sort.ts, loads this the first time sort runs.

import { compareNames } from '../../../shell/glob';
import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { errorCode, reason } from '../../lib/files';
import { operands, optList, optOn, optString, quoted, splitRecords } from '../../lib/text-input';

export const doc: CommandDoc = {
  description:
    'Writes the lines of all FILEs, sorted, to standard output. With no FILE, or when FILE is -, it reads standard input. Lines are compared as the locale sorts text (en_US.UTF-8 here: case and punctuation count only to break ties), or by the code points of their characters when LC_ALL or LANG is C. Each -k KEYDEF sorts on part of the line: F[.C][OPTS][,F[.C][OPTS]] is a start and an end field, and character, counted from 1; the end defaults to the end of the line. OPTS are one-letter ordering options (bdfghiMnRrV) for that key alone. Lines whose keys are equal are compared whole, unless -s or -u is given. The sort is stable.',
  man: [
    {
      heading: 'FIELDS',
      body: 'Without -t, fields are separated by the empty string between a non-blank and a blank, so each field but the first keeps the blanks before it; -b drops them. With -t SEP, fields are separated by SEP, and two SEPs in a row make an empty field.',
    },
    { heading: 'EXIT STATUS', body: '0 on success, 1 when -c or -C finds the input out of order, 2 on trouble.' },
  ],
};

interface Ordering {
  numeric: boolean;
  general: boolean;
  human: boolean;
  month: boolean;
  version: boolean;
  random: boolean;
  fold: boolean;
  dictionary: boolean;
  printable: boolean;
  reverse: boolean;
  blanksStart: boolean;
  blanksEnd: boolean;
}

interface Key extends Ordering {
  readonly startField: number;
  readonly startChar: number;
  /** Infinity for the end of the line. */
  readonly endField: number;
  /** 0 for the end of the field. */
  readonly endChar: number;
}

const LETTERS: Readonly<Record<string, keyof Ordering>> = {
  b: 'blanksStart',
  d: 'dictionary',
  f: 'fold',
  g: 'general',
  h: 'human',
  i: 'printable',
  M: 'month',
  n: 'numeric',
  R: 'random',
  r: 'reverse',
  V: 'version',
};

function noOrdering(): Ordering {
  return {
    numeric: false,
    general: false,
    human: false,
    month: false,
    version: false,
    random: false,
    fold: false,
    dictionary: false,
    printable: false,
    reverse: false,
    blanksStart: false,
    blanksEnd: false,
  };
}

/** True when a key has no ordering options of its own, so it takes the global ones. */
function plain(o: Ordering): boolean {
  return !Object.values(o).some(Boolean);
}

/** The ordering options that cannot go together, in GNU's words. */
function incompatible(o: Ordering): string | null {
  const kinds = [o.numeric && 'n', o.general && 'g', o.human && 'h', o.month && 'M', o.version && 'V', o.random && 'R'].filter((k): k is string => k !== false);
  if (kinds.length > 1) return `options '-${kinds.join('')}' are incompatible`;
  return null;
}

/** Reads one -k KEYDEF; throws GNU's complaint. */
function readKey(spec: string): Key {
  const bad = (why: string): Error => new Error(`${why}: invalid field specification ${quoted(spec)}`);
  const match = /^(\d+)(?:\.(\d+))?([bdfghiMnRrV]*)(?:,(\d+)(?:\.(\d+))?([bdfghiMnRrV]*))?$/.exec(spec);
  if (match === null) {
    if (!/^\d/.test(spec)) throw new Error(`invalid number at field start: invalid count at start of ${quoted(spec)}`);
    throw bad('stray character in field spec');
  }
  const order = noOrdering();
  for (const letter of match[3] ?? '') order[LETTERS[letter] ?? 'reverse'] = true;
  for (const letter of match[6] ?? '') {
    if (letter === 'b') order.blanksEnd = true;
    else order[LETTERS[letter] ?? 'reverse'] = true;
  }
  const startField = Number(match[1]);
  if (startField === 0) throw bad('field number is zero');
  const startChar = match[2] === undefined ? 1 : Number(match[2]);
  if (startChar === 0) throw bad('character offset is zero');
  const endField = match[4] === undefined ? Infinity : Number(match[4]);
  if (endField === 0) throw bad('field number is zero');
  return { ...order, startField, startChar, endField, endChar: match[5] === undefined ? 0 : Number(match[5]) };
}

const BLANK = /[ \t]/;

/** Where field `n` (from 1) starts and ends in `line`. */
function fieldBounds(line: string, n: number, sep: string | null): [number, number] {
  let start = 0;
  if (sep !== null) {
    for (let k = 1; k < n; k += 1) {
      const next = line.indexOf(sep, start);
      if (next === -1) return [line.length, line.length];
      start = next + sep.length;
    }
    const end = line.indexOf(sep, start);
    return [start, end === -1 ? line.length : end];
  }
  // A field is the blanks before it and the non-blanks after them.
  let i = 0;
  for (let k = 1; k <= n; k += 1) {
    start = i;
    while (i < line.length && BLANK.test(line.charAt(i))) i += 1;
    while (i < line.length && !BLANK.test(line.charAt(i))) i += 1;
    if (k < n && i >= line.length) return [line.length, line.length];
  }
  return [start, i];
}

function skipBlanks(line: string, at: number, end: number): number {
  let i = at;
  while (i < end && BLANK.test(line.charAt(i))) i += 1;
  return i;
}

/** The text of a key in a line. */
function keyText(line: string, key: Key, sep: string | null): string {
  const [fieldStart, fieldEnd] = fieldBounds(line, key.startField, sep);
  const from = key.blanksStart ? skipBlanks(line, fieldStart, fieldEnd) : fieldStart;
  // As in GNU sort, a character offset may run past the end of its field.
  const start = Math.min(line.length, from + key.startChar - 1);
  let end = line.length;
  if (key.endField !== Infinity) {
    const [endStart, endEnd] = fieldBounds(line, key.endField, sep);
    if (key.endChar === 0) end = endEnd;
    else {
      const from = key.blanksEnd ? skipBlanks(line, endStart, endEnd) : endStart;
      end = Math.min(line.length, from + key.endChar);
    }
  }
  return end <= start ? '' : line.slice(start, end);
}

// ── Comparing ──────────────────────────────────────────────────────────────────────────────

/** -n: leading blanks, a sign, digits with thousands separators, a fraction; anything else is 0. */
export function numericValue(text: string): number {
  const match = /^[ \t]*(-?)([\d,]*)(?:\.(\d*))?/.exec(text);
  if (match === null) return 0;
  const digits = (match[2] ?? '').replace(/,/g, '');
  if (digits === '' && (match[3] ?? '') === '') return 0;
  const value = Number(`${digits || '0'}.${match[3] ?? ''}`);
  return match[1] === '-' ? -value : value;
}

const SI = 'KMGTPEZYRQ';

/** -h: a sign, then the SI suffix's power, then the number. */
function humanKey(text: string): [number, number] {
  const match = /^[ \t]*(-?)(\d*(?:\.\d*)?)([kKMGTPEZYRQ]?)/.exec(text);
  const value = Number(match?.[2] || '0') * (match?.[1] === '-' ? -1 : 1);
  const suffix = (match?.[3] ?? '').toUpperCase();
  const power = suffix === '' ? 0 : SI.indexOf(suffix) + 1;
  return [Math.sign(value) * (power + 1), value];
}

/** -g: what strtod reads, with no number before NaN before every number. */
function generalKey(text: string): [number, number] {
  const match = /^[ \t]*([+-]?(?:inf(?:inity)?|nan|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?))/i.exec(text);
  if (match === null) return [0, 0];
  const value = Number((match[1] ?? '').replace(/^([+-]?)inf(inity)?$/i, '$1Infinity'));
  return Number.isNaN(value) ? [1, 0] : [2, value];
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

function monthKey(text: string): number {
  return MONTHS.indexOf(text.trimStart().slice(0, 3).toUpperCase()) + 1;
}

/** -V: digits compared as numbers, other runs character by character, ~ before everything. */
export function versionCompare(a: string, b: string): number {
  const order = (c: string): number => {
    if (c === '~') return -1;
    if (c === '') return 0;
    if (/[A-Za-z]/.test(c)) return c.charCodeAt(0);
    return c.charCodeAt(0) + 256;
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    // Non-digit runs.
    while ((i < a.length && !/\d/.test(a.charAt(i))) || (j < b.length && !/\d/.test(b.charAt(j)))) {
      const ca = i < a.length && !/\d/.test(a.charAt(i)) ? a.charAt(i) : '';
      const cb = j < b.length && !/\d/.test(b.charAt(j)) ? b.charAt(j) : '';
      const diff = order(ca) - order(cb);
      if (diff !== 0) return diff;
      if (ca !== '') i += 1;
      if (cb !== '') j += 1;
    }
    // Digit runs, as numbers.
    let na = '';
    let nb = '';
    while (i < a.length && /\d/.test(a.charAt(i))) na += a.charAt(i++);
    while (j < b.length && /\d/.test(b.charAt(j))) nb += b.charAt(j++);
    na = na.replace(/^0+/, '');
    nb = nb.replace(/^0+/, '');
    if (na.length !== nb.length) return na.length - nb.length;
    if (na !== nb) return na < nb ? -1 : 1;
  }
  return 0;
}

function hash(text: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

type Collate = (a: string, b: string) => number;

function compareKey(a: string, b: string, o: Ordering, collate: Collate, salt: number): number {
  let diff: number;
  if (o.numeric) diff = Math.sign(numericValue(a) - numericValue(b));
  else if (o.human) {
    const [sa, va] = humanKey(a);
    const [sb, vb] = humanKey(b);
    diff = sa !== sb ? Math.sign(sa - sb) : Math.sign(va - vb);
  } else if (o.general) {
    const [ka, va] = generalKey(a);
    const [kb, vb] = generalKey(b);
    diff = ka !== kb ? ka - kb : Math.sign(va - vb);
  } else if (o.month) diff = monthKey(a) - monthKey(b);
  else if (o.version) diff = Math.sign(versionCompare(a, b));
  else {
    let x = a;
    let y = b;
    if (o.dictionary) {
      x = x.replace(/[^\p{L}\p{N} \t]/gu, '');
      y = y.replace(/[^\p{L}\p{N} \t]/gu, '');
    }
    if (o.printable) {
      x = x.replace(/[\x00-\x1f\x7f]/g, '');
      y = y.replace(/[\x00-\x1f\x7f]/g, '');
    }
    if (o.fold) {
      x = x.toUpperCase();
      y = y.toUpperCase();
    }
    if (o.random) {
      const hx = hash(x, salt);
      const hy = hash(y, salt);
      if (hx !== hy) return (hx < hy ? -1 : 1) * (o.reverse ? -1 : 1);
    }
    diff = x === y ? 0 : collate(x, y);
  }
  return o.reverse ? -diff : diff;
}

/** Code point order, for the C locale. */
const byCodePoint: Collate = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function localeCollate(ctx: CommandContext): Collate {
  const locale = ctx.env.get('LC_ALL') || ctx.env.get('LC_COLLATE') || ctx.env.get('LANG') || 'C';
  return locale === 'C' || locale === 'POSIX' || locale.startsWith('C.') ? byCodePoint : compareNames;
}

// ── Running ────────────────────────────────────────────────────────────────────────────────

export async function run(ctx: CommandContext): Promise<ExitCode> {
  const global = noOrdering();
  for (const [letter, field] of Object.entries(LETTERS)) {
    const long: Readonly<Record<string, string>> = {
      b: 'ignore-leading-blanks',
      d: 'dictionary-order',
      f: 'ignore-case',
      g: 'general-numeric-sort',
      h: 'human-numeric-sort',
      i: 'ignore-nonprinting',
      M: 'month-sort',
      n: 'numeric-sort',
      R: 'random-sort',
      r: 'reverse',
      V: 'version-sort',
    };
    if (optOn(ctx, long[letter] ?? '')) global[field] = true;
  }
  global.blanksEnd = global.blanksStart;
  const clash = incompatible(global);
  if (clash !== null) return ctx.usage(clash);

  const sepOpt = optString(ctx, 'field-separator');
  let sep: string | null = null;
  if (sepOpt !== undefined) {
    if (sepOpt === '') return ctx.fail('empty tab', 2);
    if (sepOpt === '\\0') sep = '\0';
    else if (Array.from(sepOpt).length > 1) return ctx.fail(`multi-character tab ${quoted(sepOpt)}`, 2);
    else sep = sepOpt;
  }

  const keys: Key[] = [];
  for (const spec of optList(ctx, 'key')) {
    let key: Key;
    try {
      key = readKey(spec);
    } catch (error) {
      return ctx.fail((error as Error).message, 2);
    }
    const own = noOrdering();
    for (const field of Object.keys(own) as (keyof Ordering)[]) own[field] = key[field];
    const merged: Key = plain(own) ? { ...key, ...global } : key;
    const keyClash = incompatible(merged);
    if (keyClash !== null) return ctx.usage(keyClash);
    keys.push(merged);
  }

  // Read every input first: -o may name one of them.
  const lines: string[] = [];
  const names: { name: string; from: number }[] = [];
  for (const file of operands(ctx)) {
    let text: string;
    if (file === '-') {
      text = await ctx.stdin.text();
    } else {
      try {
        text = ctx.fs.readFile(ctx.resolve(file));
      } catch (error) {
        const why = reason(error);
        return ctx.fail(errorCode(error) === 'EISDIR' ? `read failed: ${file}: ${why}` : `cannot read: ${file}: ${why}`, 2);
      }
    }
    names.push({ name: file, from: lines.length });
    for (const record of splitRecords(text)) lines.push(record.text);
  }

  const collate = localeCollate(ctx);
  const salt = Math.floor(ctx.clock.random() * 2 ** 31);
  const stable = optOn(ctx, 'stable');
  const unique = optOn(ctx, 'unique');
  const wholeKey: Key = { ...global, startField: 1, startChar: 1, endField: Infinity, endChar: 0 };
  const used = keys.length > 0 ? keys : [wholeKey];
  const decorated = lines.map((line) => ({ line, keys: used.map((key) => keyText(line, key, sep)) }));
  const compareKeys = (a: (typeof decorated)[number], b: (typeof decorated)[number]): number => {
    for (const [i, key] of used.entries()) {
      const diff = compareKey(a.keys[i] ?? '', b.keys[i] ?? '', key, collate, salt);
      if (diff !== 0) return diff;
    }
    return 0;
  };
  const compare = (a: (typeof decorated)[number], b: (typeof decorated)[number]): number => {
    const diff = compareKeys(a, b);
    if (diff !== 0 || stable || unique) return diff;
    // The last resort: the whole lines, as text, reversed with -r.
    const last = a.line === b.line ? 0 : collate(a.line, b.line);
    return global.reverse ? -last : last;
  };

  if (optOn(ctx, 'check') || optOn(ctx, 'quiet-check')) {
    for (let i = 1; i < decorated.length; i += 1) {
      const diff = compare(decorated[i - 1] as (typeof decorated)[number], decorated[i] as (typeof decorated)[number]);
      if (diff > 0 || (unique && diff === 0)) {
        if (optOn(ctx, 'check')) {
          const where = [...names].reverse().find((entry) => entry.from <= i) ?? { name: '-', from: 0 };
          await ctx.fail(`${where.name}:${i - where.from + 1}: disorder: ${decorated[i]?.line ?? ''}`, 1);
        }
        return 1;
      }
    }
    return 0;
  }

  decorated.sort(compare);
  let output = decorated;
  if (unique) output = decorated.filter((item, i) => i === 0 || compareKeys(decorated[i - 1] as (typeof decorated)[number], item) !== 0);
  let text = '';
  for (const item of output) text += `${item.line}\n`;

  const target = optString(ctx, 'output');
  if (target !== undefined && target !== '-') {
    try {
      ctx.fs.writeFile(ctx.resolve(target), text);
    } catch (error) {
      return ctx.fail(`open failed: ${target}: ${reason(error)}`, 2);
    }
    return 0;
  }
  await ctx.stdout.write(text);
  return 0;
}
