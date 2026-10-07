// The hashing service sha1sum, sha256sum and sha512sum reach through ctx.digest: WebCrypto's
// digests, and a clear failure where the page has none.
import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { toHex } from '../lib/md5';
import { createDigest, NO_WEBCRYPTO } from './digest';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('createDigest', () => {
  it('hashes with WebCrypto', async () => {
    const digest = createDigest(webcrypto.subtle as SubtleCrypto);
    expect(toHex(await digest.hash('SHA-256', bytes('abc')))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(toHex(await digest.hash('SHA-1', bytes('abc')))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(await digest.hash('SHA-512', bytes(''))).toHaveLength(64);
  });

  it('hashes a view of a larger buffer as just its bytes', async () => {
    const digest = createDigest(webcrypto.subtle as SubtleCrypto);
    const view = bytes('xxabcxx').subarray(2, 5);
    expect(toHex(await digest.hash('SHA-256', view))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('rejects with a reason where the page has no WebCrypto', async () => {
    await expect(createDigest(null).hash('SHA-256', bytes('abc'))).rejects.toThrow(NO_WEBCRYPTO);
  });
});
