// What md5sum, sha1sum, sha256sum and sha512sum share, as GNU's do: one line a FILE (`HASH  NAME`,
// or with --tag `ALGO (NAME) = HASH`), and --check to verify such lines. The SHA family comes from
// the browser's WebCrypto through ctx.digest; MD5, which WebCrypto lacks, from src/lib/md5.ts.
// Text is hashed as its UTF-8 bytes.

import { md5, toHex } from '../../lib/md5';
import type { DigestAlgorithm } from '../../services/types';
import type { CommandContext, CommandDoc, ExitCode } from '../../shell/types';
import { errorCode, reason } from './files';
import { operands, optOn } from './text-input';

export type ChecksumAlgorithm = DigestAlgorithm | 'MD5';

/** The name --tag prints and --check reads: MD5, SHA1, SHA256, SHA512. */
function tagName(algorithm: ChecksumAlgorithm): string {
  return algorithm.replace('-', '');
}

/** How many hex digits the hash has. */
function hexLength(algorithm: ChecksumAlgorithm): number {
  return { MD5: 32, 'SHA-1': 40, 'SHA-256': 64, 'SHA-384': 96, 'SHA-512': 128 }[algorithm];
}

export function checksumDoc(algorithm: ChecksumAlgorithm, bits: number): CommandDoc {
  const name = tagName(algorithm);
  return {
    description: `Prints the ${name} (${bits}-bit) checksum of each FILE, as hexadecimal followed by two spaces and the name, or reads such lines with -c and checks them. With no FILE, or when FILE is -, it reads standard input. Text is hashed as UTF-8, so the same text gives the same checksum as on Linux.`,
    man: [
      ...(algorithm === 'MD5'
        ? [{ heading: 'NOTES', body: 'MD5 is broken as a protection against tampering; use it only to compare files. It is computed in vesen, as browsers do not offer it.' }]
        : [{ heading: 'NOTES', body: "The hash is computed by the browser's WebCrypto, which pages served over https have." }]),
      { heading: 'EXIT STATUS', body: '0 on success; 1 when a FILE could not be read or, with -c, a checksum did not match.' },
    ],
  };
}

/** The hashing service failed: no WebCrypto on this page. */
class DigestFailed extends Error {}

async function hash(ctx: CommandContext, algorithm: ChecksumAlgorithm, text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  if (algorithm === 'MD5') return toHex(md5(bytes));
  try {
    return toHex(await ctx.digest.hash(algorithm, bytes));
  } catch (error) {
    if (ctx.signal.aborted) throw error;
    throw new DigestFailed(error instanceof Error ? error.message : String(error));
  }
}

/** A name with a backslash or a new line is escaped, and its line starts with a backslash. */
function escapeName(name: string): { name: string; escaped: boolean } {
  if (!/[\\\n\r]/.test(name)) return { name, escaped: false };
  return { name: name.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r'), escaped: true };
}

async function readInput(ctx: CommandContext, file: string): Promise<string | null> {
  if (file === '-') return ctx.stdin.text();
  try {
    return ctx.fs.readFile(ctx.resolve(file));
  } catch (error) {
    errorCode(error);
    await ctx.fail(`${file}: ${reason(error)}`);
    return null;
  }
}

async function check(ctx: CommandContext, algorithm: ChecksumAlgorithm): Promise<ExitCode> {
  const quiet = optOn(ctx, 'quiet');
  const status = optOn(ctx, 'status');
  const name = tagName(algorithm);
  const size = hexLength(algorithm);
  const plain = new RegExp(`^(\\\\)?([0-9a-fA-F]{${size}}) [ *](.+)$`);
  const tagged = new RegExp(`^(\\\\)?${name} \\((.+)\\) = ([0-9a-fA-F]{${size}})$`);
  let result = 0;
  for (const list of operands(ctx)) {
    const text = await readInput(ctx, list);
    if (text === null) {
      result = 1;
      continue;
    }
    let good = 0;
    let bad = 0;
    let mismatched = 0;
    let unreadable = 0;
    for (const line of text.split('\n')) {
      if (line === '') continue;
      const m = plain.exec(line);
      const t = m === null ? tagged.exec(line) : null;
      if (m === null && t === null) {
        bad += 1;
        continue;
      }
      good += 1;
      const escaped = (m?.[1] ?? t?.[1]) === '\\';
      let file = m !== null ? (m[3] ?? '') : (t?.[2] ?? '');
      if (escaped) file = file.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c === 'r' ? '\r' : c));
      const expected = (m !== null ? m[2] : t?.[3])?.toLowerCase() ?? '';
      let content: string;
      try {
        content = file === '-' ? await ctx.stdin.text() : ctx.fs.readFile(ctx.resolve(file));
      } catch (error) {
        unreadable += 1;
        if (!status) {
          await ctx.fail(`${file}: ${reason(error)}`);
          await ctx.stdout.write(`${file}: FAILED open or read\n`);
        }
        continue;
      }
      const ok = (await hash(ctx, algorithm, content)) === expected;
      if (!ok) mismatched += 1;
      if (!status && (!ok || !quiet)) await ctx.stdout.write(`${file}: ${ok ? 'OK' : 'FAILED'}\n`);
    }
    if (good === 0) {
      await ctx.fail(`${list === '-' ? 'standard input' : list}: no properly formatted ${name} checksum lines found`);
      result = 1;
      continue;
    }
    const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
    if (!status) {
      if (bad > 0) await ctx.fail(`WARNING: ${plural(bad, 'line is', 'lines are')} improperly formatted`, 0);
      if (unreadable > 0) await ctx.fail(`WARNING: ${plural(unreadable, 'listed file', 'listed files')} could not be read`, 0);
      if (mismatched > 0) await ctx.fail(`WARNING: ${plural(mismatched, 'computed checksum', 'computed checksums')} did NOT match`, 0);
    }
    if (mismatched > 0 || unreadable > 0) result = 1;
  }
  return result;
}

/** Runs one of the checksum commands. */
export async function runChecksum(ctx: CommandContext, algorithm: ChecksumAlgorithm): Promise<ExitCode> {
  try {
    if (optOn(ctx, 'check')) return await check(ctx, algorithm);
    let status = 0;
    const tag = optOn(ctx, 'tag');
    const binary = optOn(ctx, 'binary');
    for (const file of operands(ctx)) {
      const text = await readInput(ctx, file);
      if (text === null) {
        status = 1;
        continue;
      }
      const sum = await hash(ctx, algorithm, text);
      const { name, escaped } = escapeName(file);
      const line = tag ? `${tagName(algorithm)} (${name}) = ${sum}` : `${sum} ${binary ? '*' : ' '}${name}`;
      await ctx.stdout.write(`${escaped ? '\\' : ''}${line}\n`);
    }
    return status;
  } catch (error) {
    if (error instanceof DigestFailed) return ctx.fail(error.message);
    throw error;
  }
}