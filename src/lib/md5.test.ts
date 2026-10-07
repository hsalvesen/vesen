// MD5 against the test suite in RFC 1321, appendix A.5, and a few lengths around the padding.
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { md5, toHex } from './md5';

const hex = (text: string): string => toHex(md5(new TextEncoder().encode(text)));

describe('md5', () => {
  it.each([
    ['', 'd41d8cd98f00b204e9800998ecf8427e'],
    ['a', '0cc175b9c0f1b6a831c399e269772661'],
    ['abc', '900150983cd24fb0d6963f7d28e17f72'],
    ['message digest', 'f96b697d7cb7938d525a2f31aaf161d0'],
    ['abcdefghijklmnopqrstuvwxyz', 'c3fcd3d76192e4007dfb496cca67e13b'],
    ['ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 'd174ab98d277d9f5a5611c2c9f419d9f'],
    ['12345678901234567890123456789012345678901234567890123456789012345678901234567890', '57edf4a22be3c955ac49da2e2107b67a'],
  ])('MD5 ("%s") = %s', (input, expected) => {
    expect(hex(input)).toBe(expected);
  });

  it('agrees with Node for every length across the padding boundaries', () => {
    for (let n = 0; n <= 200; n += 1) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 31 + n) & 0xff);
      expect(toHex(md5(bytes)), `length ${n}`).toBe(createHash('md5').update(bytes).digest('hex'));
    }
  });
});
