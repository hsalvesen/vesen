export class BitBuffer {
  readonly bits: number[] = [];
  get length() { return this.bits.length; }
  push(value: number, len: number): void { if (len < 0 || len > 31 || value >>> len !== 0) throw new RangeError('value out of range'); for (let i = len - 1; i >= 0; i--) this.bits.push((value >>> i) & 1); }
  append(bits: readonly number[]): void { for (const b of bits) this.bits.push(b); }
  toBytes(): Uint8Array { const out = new Uint8Array(this.bits.length >>> 3); this.bits.forEach((b, i) => { out[i >>> 3] |= b << (7 - (i & 7)); }); return out; }
}
