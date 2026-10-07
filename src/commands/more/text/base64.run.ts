// The body of base64; its spec, in base64.ts, loads this the first time base64 runs.

import type { CommandContext, CommandDoc, ExitCode } from '../../../shell/types';
import { optOn, optString, quoted, readOperand } from '../../lib/text-input';

export const doc: CommandDoc = {
  description:
    'Encodes FILE, or standard input, in base64 and writes it to standard output, in lines of 76 characters; with -d, decodes it instead. Text is encoded as UTF-8. Decoding skips new lines, and with -i any other character outside the alphabet.',
  man: [
    {
      heading: 'NOTES',
      body: 'Files in vesen hold text, so decoded bytes that are not UTF-8 are shown as the replacement character �.',
    },
    { heading: 'EXIT STATUS', body: '0 on success, 1 when the input cannot be read or is not valid base64.' },
  ],
};

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function encodeBytes(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET.charAt((n >> 18) & 63) + ALPHABET.charAt((n >> 12) & 63);
    out += b === undefined ? '=' : ALPHABET.charAt((n >> 6) & 63);
    out += c === undefined ? '=' : ALPHABET.charAt(n & 63);
  }
  return out;
}

/**
 * The bytes of base64 text, and whether all of it was valid. As GNU base64 does, what decodes
 * before a mistake is kept, so the caller can write it before saying the input is invalid.
 */
export function decodeText(text: string, ignoreGarbage: boolean): { bytes: Uint8Array; valid: boolean } {
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  let padding = 0;
  const done = (valid: boolean): { bytes: Uint8Array; valid: boolean } => ({ bytes: new Uint8Array(bytes), valid });
  for (const ch of text) {
    if (ch === '\n' || ch === '\r') continue;
    if (ch === '=') {
      padding += 1;
      continue;
    }
    const index = ALPHABET.indexOf(ch);
    if (index === -1 || padding > 0) {
      if (ignoreGarbage && index === -1) continue;
      return done(false);
    }
    value = ((value << 6) | index) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  // Leftover bits must come with the padding that ends a group; a lone character is not valid.
  if (bits === 6 || padding > 2) return done(false);
  if (!ignoreGarbage && bits > 0 && padding === 0) return done(false);
  return done(true);
}

function wrap(text: string, cols: number): string {
  if (text === '') return '';
  if (cols === 0) return `${text}\n`;
  let out = '';
  for (let i = 0; i < text.length; i += cols) out += `${text.slice(i, i + cols)}\n`;
  return out;
}

export async function run(ctx: CommandContext): Promise<ExitCode> {
  if (ctx.args.length > 1) return ctx.usage(`extra operand ${quoted(ctx.args[1] ?? '')}`);
  const rawCols = optString(ctx, 'wrap') ?? '76';
  if (!/^\d+$/.test(rawCols)) return ctx.fail(`invalid wrap size: ${quoted(rawCols)}`);
  const text = await readOperand(ctx, ctx.args[0] ?? '-');
  if (text === null) return 1;
  if (optOn(ctx, 'decode')) {
    const { bytes, valid } = decodeText(text, optOn(ctx, 'ignore-garbage'));
    if (bytes.length > 0) await ctx.stdout.write(new TextDecoder().decode(bytes));
    return valid ? 0 : ctx.fail('invalid input');
  }
  await ctx.stdout.write(wrap(encodeBytes(new TextEncoder().encode(text)), Number(rawCols)));
  return 0;
}
