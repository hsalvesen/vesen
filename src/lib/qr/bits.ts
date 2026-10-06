/** An append-only sequence of bits, most significant bit first. */
export class BitBuffer {
  readonly bits: number[] = [];

  get length(): number {
    return this.bits.length;
  }

  /** Appends the low `len` bits of `value`. */
  push(value: number, len: number): void {
    if (len < 0 || len > 31 || value >>> len !== 0) throw new RangeError(`${value} does not fit in ${len} bits`);
    for (let i = len - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }

  append(bits: readonly number[]): void {
    for (const b of bits) this.bits.push(b);
  }

  /** Packs whole bytes; a trailing partial byte is dropped. */
  toBytes(): Uint8Array {
    const out = new Uint8Array(this.bits.length >>> 3);
    for (let i = 0; i < out.length * 8; i++) {
      if (this.bits[i]) out[i >>> 3] = out[i >>> 3]! | (1 << (7 - (i & 7)));
    }
    return out;
  }
}
