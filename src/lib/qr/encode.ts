// The encoder: version choice, optional EC boost, padding, Reed-Solomon blocks and interleaving,
// placement and mask choice (ISO 18004 sections 7.3 to 7.9).
import { BitBuffer } from './bits';
import { rsRemainder } from './gf256';
import { applyMask, penaltyScore } from './mask';
import { WorkGrid } from './matrix';
import { segmentOptimally } from './segmenter';
import { makeSegment, segmentBits, utf8Bytes, writeSegments } from './segments';
import {
  dataCodewords,
  ecBlocks,
  ecCodewordsPerBlock,
  ECC_ORDER,
  isVersion,
  MAX_VERSION,
  maxPayloadBytes,
  MIN_VERSION,
  totalCodewords,
  versionBand,
} from './tables';
import {
  isEccLevel,
  isMaskId,
  QrCapacityError,
  type EccLevel,
  type EncodeOptions,
  type MaskId,
  type QrSymbol,
  type Segment,
  type Version,
} from './types';

/** Splits data codewords into blocks, appends each block's EC codewords and interleaves them (section 7.6). */
export function addEccAndInterleave(data: Uint8Array, v: Version, ecc: EccLevel): Uint8Array {
  const numBlocks = ecBlocks(v, ecc);
  const ecLen = ecCodewordsPerBlock(v, ecc);
  const raw = totalCodewords(v);
  if (data.length !== dataCodewords(v, ecc)) throw new RangeError('wrong number of data codewords');
  // Short blocks come first; long blocks hold one more data codeword.
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);

  const blocks: Uint8Array[] = [];
  for (let b = 0, k = 0; b < numBlocks; b++) {
    const len = shortLen - ecLen + (b < numShort ? 0 : 1);
    const dat = data.subarray(k, k + len);
    k += len;
    const block = new Uint8Array(shortLen + 1);
    // A short block leaves a gap at shortLen - ecLen, which interleaving skips.
    block.set(dat, 0);
    block.set(rsRemainder(dat, ecLen), shortLen + 1 - ecLen);
    blocks.push(block);
  }

  const out = new Uint8Array(raw);
  let o = 0;
  for (let i = 0; i <= shortLen; i++) {
    for (let b = 0; b < numBlocks; b++) {
      if (i === shortLen - ecLen && b < numShort) continue;
      out[o++] = blocks[b]![i]!;
    }
  }
  return out;
}

interface VersionRange {
  min: Version;
  max: Version;
}

function versionRange(opts: EncodeOptions): VersionRange {
  if (opts.version !== undefined) {
    if (!isVersion(opts.version)) throw new RangeError(`version must be an integer from 1 to 40 (got ${opts.version})`);
    return { min: opts.version, max: opts.version };
  }
  const min = opts.minVersion ?? MIN_VERSION;
  const max = opts.maxVersion ?? MAX_VERSION;
  if (!isVersion(min) || !isVersion(max) || min > max) {
    throw new RangeError(`version range must lie within 1 to 40 (got ${min} to ${max})`);
  }
  return { min, max };
}

function requestedEcc(opts: EncodeOptions): EccLevel {
  const ecc = opts.ecc ?? 'M';
  if (!isEccLevel(ecc)) throw new RangeError(`ecc must be L, M, Q or H (got ${String(ecc)})`);
  return ecc;
}

function capacityError(segs: readonly Segment[], range: VersionRange, ecc: EccLevel): QrCapacityError {
  let bytes = 0;
  for (const s of segs) bytes += utf8Bytes(s.text).length;
  return new QrCapacityError({
    bytes,
    needBits: segmentBits(segs, range.max),
    maxBits: dataCodewords(range.max, ecc) * 8,
    ecc,
    maxBytes: {
      L: maxPayloadBytes('L', range.max),
      M: maxPayloadBytes('M', range.max),
      Q: maxPayloadBytes('Q', range.max),
      H: maxPayloadBytes('H', range.max),
    },
  });
}

/** Builds the symbol for segments that fit version `v` at level `ecc`. */
function buildSymbol(segs: readonly Segment[], v: Version, ecc: EccLevel, opts: EncodeOptions): QrSymbol {
  const used = segmentBits(segs, v);
  let level = ecc;
  if (opts.boostEcc) {
    for (let i = ECC_ORDER.indexOf(level) + 1; i < ECC_ORDER.length; i++) {
      const stronger = ECC_ORDER[i]!;
      if (used <= dataCodewords(v, stronger) * 8) level = stronger;
    }
  }

  const capacity = dataCodewords(v, level) * 8;
  const bb = new BitBuffer();
  writeSegments(bb, segs, v);
  // Terminator of up to four zero bits, zero bits to a byte boundary, then alternating pad codewords.
  bb.push(0, Math.min(4, capacity - bb.length));
  bb.push(0, (8 - (bb.length % 8)) % 8);
  for (let pad = 0xec; bb.length < capacity; pad ^= 0xec ^ 0x11) bb.push(pad, 8);

  const grid = new WorkGrid(v);
  grid.drawFunctionPatterns();
  grid.placeCodewords(addEccAndInterleave(bb.toBytes(), v, level));

  let mask: MaskId;
  const forced = opts.mask;
  if (forced !== undefined && forced !== 'auto') {
    if (!isMaskId(forced)) throw new RangeError(`mask must be an integer from 0 to 7 (got ${String(forced)})`);
    mask = forced;
  } else {
    const score = opts.penalty ?? penaltyScore;
    const unmasked = grid.modules.slice();
    let best = Infinity;
    mask = 0;
    for (let m = 0; m < 8; m++) {
      const candidate = m as MaskId;
      grid.modules.set(unmasked);
      applyMask(grid.modules, grid.fn, grid.size, candidate);
      // Score with the real format bits in place, as the standard requires.
      grid.drawFormat(level, candidate);
      const p = score(grid.modules, grid.size);
      if (p < best) {
        best = p;
        mask = candidate;
      }
    }
    grid.modules.set(unmasked);
  }
  applyMask(grid.modules, grid.fn, grid.size, mask);
  grid.drawFormat(level, mask);

  return Object.freeze({
    version: v,
    size: grid.size,
    ecc: level,
    requestedEcc: ecc,
    mask,
    segments: Object.freeze(segs.map((s) => Object.freeze({ mode: s.mode, charCount: s.charCount }))),
    dataBits: used,
    capacityBits: capacity,
    modules: grid.modules,
  });
}

/** Encodes a fixed list of segments in the smallest version that fits. */
export function encodeSegments(segs: readonly Segment[], opts: EncodeOptions = {}): QrSymbol {
  const ecc = requestedEcc(opts);
  const range = versionRange(opts);
  for (let v = range.min; v <= range.max; v++) {
    if (segmentBits(segs, v) <= dataCodewords(v, ecc) * 8) return buildSymbol(segs, v, ecc, opts);
  }
  throw capacityError(segs, range, ecc);
}

/**
 * Encodes text in the smallest version that fits. By default the text is split into the
 * shortest mix of numeric, alphanumeric and UTF-8 byte segments for each candidate version.
 */
export function encodeText(text: string, opts: EncodeOptions = {}): QrSymbol {
  const ecc = requestedEcc(opts);
  const range = versionRange(opts);
  const mode = opts.mode ?? 'optimal';

  if (mode !== 'optimal') {
    return encodeSegments([makeSegment(text, mode)], opts);
  }

  // The best split depends only on the character count widths, which change at versions 10 and 27.
  const byBand = new Map<number, Segment[]>();
  let last: Segment[] = [];
  for (let v = range.min; v <= range.max; v++) {
    const band = versionBand(v);
    let segs = byBand.get(band);
    if (!segs) {
      segs = segmentOptimally(text, v);
      byBand.set(band, segs);
    }
    last = segs;
    if (segmentBits(segs, v) <= dataCodewords(v, ecc) * 8) return buildSymbol(segs, v, ecc, opts);
  }
  throw capacityError(last, range, ecc);
}
