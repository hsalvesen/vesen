// The frozen golden fixture: symbols the `qrcode` package made, re-encoded here with the same
// segments, version and mask. It needs no QR library, so it keeps guarding the encoder after the
// package is removed. Regenerate the fixture only with scripts/gen-qr-golden.mjs.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { makePayload, type PayloadSpec } from '../../../scripts/qr-golden-payloads.mjs';
import { encodeSegments } from './encode';
import { makeSegment } from './segments';
import { ECC_ORDER } from './tables';
import type { EccLevel, MaskId, QrSymbol, Segment, SegmentMode } from './types';

interface GoldenSymbol {
  name: string;
  payload: PayloadSpec;
  segments: [SegmentMode, number][];
  ecc: EccLevel;
  version: number;
  mask: MaskId;
}

interface Fixture {
  oracle: string;
  entries: (GoldenSymbol & { sha256: string })[];
  matrices: (GoldenSymbol & { rows: string[] })[];
}

const fixture = JSON.parse(
  readFileSync(new URL('../../../tests/fixtures/qr-golden.json', import.meta.url), 'utf8'),
) as Fixture;

function encode(g: GoldenSymbol): QrSymbol {
  const text = makePayload(g.payload);
  let at = 0;
  const segs: Segment[] = g.segments.map(([mode, length]) => {
    const seg = makeSegment(text.slice(at, at + length), mode);
    at += length;
    return seg;
  });
  expect(at, g.name).toBe(text.length);
  return encodeSegments(segs, { ecc: g.ecc, version: g.version, mask: g.mask });
}

function sha256(modules: Uint8Array): string {
  return createHash('sha256').update(modules).digest('hex');
}

function hexRows(qr: QrSymbol): string[] {
  const rows: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    let bits = '';
    for (let x = 0; x < qr.size; x++) bits += qr.modules[y * qr.size + x] ? '1' : '0';
    bits = bits.padEnd(Math.ceil(qr.size / 4) * 4, '0');
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    rows.push(hex);
  }
  return rows;
}

describe(`golden symbols from ${fixture.oracle}`, () => {
  it('covers every version, level, mode and mask', () => {
    expect(fixture.entries.length).toBeGreaterThanOrEqual(250);
    expect(new Set(fixture.entries.map((e) => e.version)).size).toBe(40);
    expect([...new Set(fixture.entries.map((e) => e.ecc))].sort()).toEqual([...ECC_ORDER].sort());
    expect(new Set(fixture.entries.map((e) => e.mask)).size).toBe(8);
    expect(new Set(fixture.entries.flatMap((e) => e.segments.map(([mode]) => mode))).size).toBe(3);
    expect(fixture.entries.some((e) => e.segments.length > 1)).toBe(true);
  });

  it('re-encodes every entry module for module', { timeout: 60_000 }, () => {
    const mismatches = fixture.entries.filter((e) => sha256(encode(e).modules) !== e.sha256).map((e) => e.name);
    expect(mismatches).toEqual([]);
  });

  it.each(fixture.matrices)('re-encodes $name in full', (m) => {
    const qr = encode(m);
    expect(qr.version).toBe(m.version);
    expect(hexRows(qr)).toEqual(m.rows);
  });
});
