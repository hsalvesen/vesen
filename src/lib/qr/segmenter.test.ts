import { describe, expect, it } from 'vitest';
import { encodeText } from './encode';
import { segmentOptimally } from './segmenter';
import { detectMode, makeSegment, segmentBits } from './segments';
import type { Segment, SegmentMode } from './types';

const MODES: readonly SegmentMode[] = ['byte', 'alphanumeric', 'numeric'];

function allowed(ch: string, mode: SegmentMode): boolean {
  if (mode === 'byte') return true;
  if (mode === 'numeric') return /^[0-9]$/.test(ch);
  return /^[0-9A-Z $%*+\-./:]$/.test(ch);
}

/** The fewest bits any split into segments can reach, by trying every mode for every character. */
function exhaustiveBest(text: string, version: number): number {
  const chars = Array.from(text);
  let best = Infinity;
  const walk = (i: number, modes: SegmentMode[]): void => {
    if (i === chars.length) {
      const segs: Segment[] = [];
      let start = 0;
      for (let k = 1; k <= chars.length; k++) {
        if (k === chars.length || modes[k] !== modes[start]) {
          segs.push(makeSegment(chars.slice(start, k).join(''), modes[start]!));
          start = k;
        }
      }
      best = Math.min(best, segmentBits(segs, version));
      return;
    }
    for (const m of MODES) if (allowed(chars[i]!, m)) walk(i + 1, [...modes, m]);
  };
  walk(0, []);
  return best;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    return s >>> 8;
  };
}

describe('segmentOptimally', () => {
  it('matches an exhaustive search on 400 short mixed strings at each version band', { timeout: 60_000 }, () => {
    const alphabet = Array.from('aB1 9:Z.é0🦉');
    const next = lcg(18004);
    for (let c = 0; c < 400; c++) {
      const length = 1 + (c % 7);
      const text = Array.from({ length }, () => alphabet[next() % alphabet.length]!).join('');
      for (const version of [1, 10, 27]) {
        const segs = segmentOptimally(text, version);
        expect(segmentBits(segs, version), `${JSON.stringify(text)} at v${version}`).toBe(exhaustiveBest(text, version));
        expect(segs.map((s) => s.text).join('')).toBe(text);
      }
    }
  });

  it('is never longer than the best single mode', () => {
    const samples = [
      'https://www.vesen.app',
      'tel:+61412345678',
      'HTTPS://EXAMPLE.COM/ORDERS/1234567890',
      'WIFI:T:WPA;S:vesen;P:0123456789;;',
      'Gadigal Country, 2026',
      'Kia ora, Aotearoa! ā ē ī ō ū',
      '3141592653589793238462643383279',
      '',
    ];
    for (const text of samples) {
      for (const version of [1, 9, 10, 26, 27, 40]) {
        const single = segmentBits([makeSegment(text, detectMode(text))], version);
        expect(segmentBits(segmentOptimally(text, version), version)).toBeLessThanOrEqual(single);
      }
    }
  });

  it('splits a digit-heavy link into byte and numeric segments', () => {
    const segs = segmentOptimally('tel:+61412345678901234', 1);
    expect(segs.map((s) => s.mode)).toEqual(['byte', 'numeric']);
    expect(segs.map((s) => s.text)).toEqual(['tel:+', '61412345678901234']);
  });

  it('keeps astral code points whole', () => {
    const segs = segmentOptimally('🦉123456789012🦘', 1);
    expect(segs.map((s) => s.text).join('')).toBe('🦉123456789012🦘');
    expect(segs[0]).toMatchObject({ mode: 'byte', charCount: 4 });
    expect(segs.every((s) => !/[\uD800-\uDFFF]/.test(s.text) || s.mode === 'byte')).toBe(true);
  });

  it('lets the encoder pick a smaller version than one mode would', () => {
    // A phone link: the digits in numeric mode save enough bits to fit one version lower at level H.
    const text = 'tel:+61412345678';
    expect(encodeText(text, { ecc: 'H' }).version).toBeLessThan(encodeText(text, { ecc: 'H', mode: 'byte' }).version);
    expect(encodeText(text, { ecc: 'H' }).segments.map((s) => s.mode)).toEqual(['byte', 'numeric']);
  });
});
