// qr's options, read the way qrencode and GNU getopt_long read them: -eH, -e H, --ec=H, --ec H, a
// unique prefix of a long name (--full), options before or after the text, and `--` to end them.
// qr takes its words unparsed (rawArgs), so it can say what went wrong in its own words: an
// unknown option with a did-you-mean, a value out of range, and text that starts with '-'.

import type { EccLevel, MaskId, QrDisplay } from '../../lib/qr';

export interface QrArgs {
  /** The words to encode, in order. */
  readonly operands: readonly string[];
  /** -e: unset means M, raised for free when it fits. */
  readonly ec?: EccLevel;
  /** -s: CSS pixels per module, or 'fit' for the device's default. */
  readonly size: number | 'fit';
  /** -m: the quiet zone; unset means 4 for the card, 2 for text art. */
  readonly margin?: number;
  readonly type: QrDisplay;
  /** -v: the smallest version to use. */
  readonly minVersion?: number;
  readonly mask?: MaskId;
  /** -8: every character as a byte. */
  readonly eightBit: boolean;
  readonly fullscreen: boolean;
  /** --text or --url, whichever came last. */
  readonly force?: 'text' | 'url';
}

export type QrParse =
  | { readonly kind: 'args'; readonly args: QrArgs }
  | { readonly kind: 'help' }
  /** A usage error, worded without the `qr: ` prefix. */
  | { readonly kind: 'error'; readonly message: string };

type Key = 'ec' | 'size' | 'margin' | 'type' | 'version' | 'mask' | 'eightBit' | 'fullscreen' | 'text' | 'url' | 'help';

interface OptionDef {
  readonly short?: string;
  readonly long: string;
  readonly key: Key;
  readonly value: boolean;
}

/** Every option qr reads, help included. The spec (portfolio/qr.ts) lists them for help and Tab. */
export const QR_OPTIONS: readonly OptionDef[] = [
  { short: 'e', long: 'ec', key: 'ec', value: true },
  { short: 'l', long: 'level', key: 'ec', value: true },
  { short: 's', long: 'size', key: 'size', value: true },
  { short: 'm', long: 'margin', key: 'margin', value: true },
  { short: 't', long: 'type', key: 'type', value: true },
  { short: 'v', long: 'symversion', key: 'version', value: true },
  { long: 'mask', key: 'mask', value: true },
  { short: '8', long: '8bit', key: 'eightBit', value: false },
  { short: 'f', long: 'fullscreen', key: 'fullscreen', value: false },
  { long: 'text', key: 'text', value: false },
  { long: 'url', key: 'url', value: false },
  { short: 'h', long: 'help', key: 'help', value: false },
];

export const QR_TYPES: readonly QrDisplay[] = ['svg', 'utf8', 'utf8i', 'ascii'];

const LEVELS: Readonly<Record<string, EccLevel>> = {
  l: 'L',
  low: 'L',
  m: 'M',
  medium: 'M',
  q: 'Q',
  quartile: 'Q',
  h: 'H',
  high: 'H',
};

export const SIZE_RANGE = { min: 1, max: 32 } as const;
export const MARGIN_RANGE = { min: 0, max: 10 } as const;

class Problem extends Error {}

/** The edit distance between two short words, for did-you-mean. */
function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length]!;
}

/**
 * The long option `name` is nearest to, within two edits, or undefined. Of two as near, the one
 * that starts with the same letter: --sz means --size, not --ec.
 */
function nearestLong(name: string): string | undefined {
  const typed = name.toLowerCase();
  let best: { long: string; score: number } | undefined;
  for (const option of QR_OPTIONS) {
    const d = distance(typed, option.long);
    if (d > 2) continue;
    const score = d * 2 + (option.long.charAt(0) === typed.charAt(0) ? 0 : 1);
    if (best === undefined || score < best.score) best = { long: option.long, score };
  }
  return best?.long;
}

function unknownLong(name: string, spelled: string): Problem {
  const near = nearestLong(name);
  return new Problem(near === undefined ? `unknown option '${spelled}'` : `unknown option '${spelled}'. Did you mean '--${near}'?`);
}

/** The option a long name (or a unique prefix of one) names. */
function findLong(name: string): OptionDef {
  const exact = QR_OPTIONS.find((option) => option.long === name);
  if (exact) return exact;
  const matches = name === '' ? [] : QR_OPTIONS.filter((option) => option.long.startsWith(name));
  if (matches.length === 1 && matches[0]) return matches[0];
  if (matches.length > 1) {
    const names = matches.map((option) => `'--${option.long}'`);
    throw new Problem(`ambiguous option '--${name}': ${names.slice(0, -1).join(', ')} or ${names[names.length - 1] ?? ''}`);
  }
  throw unknownLong(name, `--${name}`);
}

/** True for a word qr reads as options: -x clusters and --names, not -5°C or -12. */
function optionLike(word: string): boolean {
  if (word.startsWith('--')) return /^--[A-Za-z0-9][A-Za-z0-9-]*(?:=[\s\S]*)?$/.test(word);
  if (!/^-[A-Za-z0-9]+$/.test(word)) return false;
  // A digit after the dash is a number, except qrencode's -8 (alone or before letters: -8f).
  return !/^-\d/.test(word) || /^-8[A-Za-z]*$/.test(word);
}

interface Draft {
  operands: string[];
  ec?: EccLevel;
  size: number | 'fit';
  margin?: number;
  type: QrDisplay;
  minVersion?: number;
  mask?: MaskId;
  eightBit: boolean;
  fullscreen: boolean;
  force?: 'text' | 'url';
  help: boolean;
}

function whole(value: string, min: number, max: number): number | null {
  if (!/^\d{1,3}$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

/** Stores option `option`, spelled `spelled`, with `value` (undefined when the words ran out). */
function apply(draft: Draft, option: OptionDef, spelled: string, value: string | undefined): void {
  const got = value === undefined || value === '' ? '' : ` (got '${value}')`;
  switch (option.key) {
    case 'ec': {
      const key = (value ?? '').toLowerCase();
      const level = Object.prototype.hasOwnProperty.call(LEVELS, key) ? LEVELS[key] : undefined;
      if (level === undefined) throw new Problem(`'${spelled}' needs one of L, M, Q, H${got}`);
      draft.ec = level;
      return;
    }
    case 'size': {
      if (value !== undefined && value.toLowerCase() === 'fit') {
        draft.size = 'fit';
        return;
      }
      const n = value === undefined ? null : whole(value, SIZE_RANGE.min, SIZE_RANGE.max);
      if (n === null) throw new Problem(`'${spelled}' needs a number from ${SIZE_RANGE.min} to ${SIZE_RANGE.max} or 'fit'`);
      draft.size = n;
      return;
    }
    case 'margin': {
      const n = value === undefined ? null : whole(value, MARGIN_RANGE.min, MARGIN_RANGE.max);
      if (n === null) throw new Problem(`'${spelled}' needs a number from ${MARGIN_RANGE.min} to ${MARGIN_RANGE.max}`);
      draft.margin = n;
      return;
    }
    case 'type': {
      const type = QR_TYPES.find((t) => t === value?.toLowerCase());
      if (type === undefined) throw new Problem(`'${spelled}' needs one of ${QR_TYPES.join(', ')}${got}`);
      draft.type = type;
      return;
    }
    case 'version': {
      const n = value === undefined ? null : whole(value, 1, 40);
      if (n === null) throw new Problem(`'${spelled}' needs a version from 1 to 40`);
      draft.minVersion = n;
      return;
    }
    case 'mask': {
      const n = value === undefined ? null : whole(value, 0, 7);
      if (n === null) throw new Problem(`${spelled} needs a number from 0 to 7`);
      draft.mask = n as MaskId;
      return;
    }
    case 'eightBit':
      draft.eightBit = true;
      return;
    case 'fullscreen':
      draft.fullscreen = true;
      return;
    case 'text':
      draft.force = 'text';
      return;
    case 'url':
      draft.force = 'url';
      return;
    case 'help':
      draft.help = true;
      return;
  }
}

function readWords(words: readonly string[]): Draft {
  const draft: Draft = { operands: [], size: 'fit', type: 'svg', eightBit: false, fullscreen: false, help: false };
  let i = 0;
  let optionsEnded = false;
  while (i < words.length) {
    const word = words[i] ?? '';
    i += 1;
    if (optionsEnded || word === '-' || !word.startsWith('-')) {
      draft.operands.push(word);
      continue;
    }
    if (word === '--') {
      optionsEnded = true;
      continue;
    }
    if (!optionLike(word)) throw new Problem(`to encode text that starts with '-', put -- first: qr -- ${word}`);

    if (word.startsWith('--')) {
      const eq = word.indexOf('=');
      const name = eq === -1 ? word.slice(2) : word.slice(2, eq);
      const option = findLong(name.toLowerCase());
      const spelled = `--${option.long}`;
      if (!option.value) {
        if (eq !== -1) throw new Problem(`'${spelled}' takes no value`);
        apply(draft, option, spelled, undefined);
        continue;
      }
      if (eq !== -1) {
        apply(draft, option, spelled, word.slice(eq + 1));
        continue;
      }
      const value = words[i];
      if (value !== undefined) i += 1;
      apply(draft, option, spelled, value);
      continue;
    }

    // `-size` for `--size`: the name of a long option written with one dash.
    const single = word.slice(1).toLowerCase();
    if (single.length > 1 && QR_OPTIONS.some((option) => option.long === single)) {
      throw new Problem(`unknown option '${word}'. Did you mean '--${single}'?`);
    }

    // A cluster of short options: -8f, -eH, -e H.
    for (let k = 1; k < word.length; k += 1) {
      const c = word.charAt(k);
      const option = QR_OPTIONS.find((o) => o.short === c);
      if (option === undefined) throw new Problem(`unknown option '-${c}'`);
      const spelled = `-${c}`;
      if (!option.value) {
        apply(draft, option, spelled, undefined);
        continue;
      }
      const attached = word.slice(k + 1);
      if (attached !== '') {
        apply(draft, option, spelled, attached);
      } else {
        const value = words[i];
        if (value !== undefined) i += 1;
        apply(draft, option, spelled, value);
      }
      break;
    }
  }
  return draft;
}

/** Reads qr's words (everything after `qr`). */
export function parseQrArgs(words: readonly string[]): QrParse {
  let draft: Draft;
  try {
    draft = readWords(words);
  } catch (error) {
    if (error instanceof Problem) {
      // --help anywhere among the options is still help, as the kernel promises.
      const end = words.indexOf('--');
      const options = end === -1 ? words : words.slice(0, end);
      if (options.includes('--help') || options.includes('-h')) return { kind: 'help' };
      return { kind: 'error', message: error.message };
    }
    throw error;
  }
  if (draft.help) return { kind: 'help' };
  const args: QrArgs = {
    operands: draft.operands,
    size: draft.size,
    type: draft.type,
    eightBit: draft.eightBit,
    fullscreen: draft.fullscreen,
    ...(draft.ec === undefined ? {} : { ec: draft.ec }),
    ...(draft.margin === undefined ? {} : { margin: draft.margin }),
    ...(draft.minVersion === undefined ? {} : { minVersion: draft.minVersion }),
    ...(draft.mask === undefined ? {} : { mask: draft.mask }),
    ...(draft.force === undefined ? {} : { force: draft.force }),
  };
  return { kind: 'args', args };
}
