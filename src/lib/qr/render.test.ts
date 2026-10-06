import { describe, expect, it } from 'vitest';
import { encodeText } from './encode';
import { toRaster, toRgba } from './render/raster';
import { toSvg, toSvgPath } from './render/svg';
import { textColumns, toText, type TextStyle } from './render/text';
import type { EccLevel, QrSymbol } from './types';

/** The legacy command's renderer (src/utils/commands/qr.ts before the swap), kept as the reference. */
function legacyRenderQRMatrix(matrix: boolean[][]): string {
  const size = matrix.length;
  const lines: string[] = [];
  for (let row = 0; row < size; row += 2) {
    let line = '';
    for (let col = 0; col < size; col++) {
      const top = matrix[row]![col]!;
      const bot = row + 1 < size ? matrix[row + 1]![col]! : false;
      if (top && bot) line += '█';
      else if (top && !bot) line += '▀';
      else if (!top && bot) line += '▄';
      else line += ' ';
    }
    lines.push(line);
  }
  return lines.join('\n');
}

function toBooleans(qr: QrSymbol): boolean[][] {
  return Array.from({ length: qr.size }, (_, y) => Array.from({ length: qr.size }, (_, x) => qr.modules[y * qr.size + x] === 1));
}

const SAMPLES: [string, EccLevel][] = [
  ['https://www.vesen.app', 'M'],
  ['HELLO WORLD', 'Q'],
  ['01234567', 'L'],
  ['Kia ora, Aotearoa — ā ē ī ō ū 🦉', 'H'],
  ['https://github.com/hsalvesen/vesen', 'M'],
  ['x'.repeat(300), 'M'],
];

/** Reads the path back into a set of dark modules, following the M/m/h commands. */
function modulesFromPath(d: string, size: number, margin: number): Uint8Array {
  const out = new Uint8Array(size * size);
  let x = 0;
  let y = 0;
  for (const [, cmd, a, b] of d.matchAll(/([Mmh])(-?[\d.]+)(?: (-?[\d.]+))?/g)) {
    const first = Number(a);
    if (cmd === 'M') {
      x = first;
      y = Number(b);
    } else if (cmd === 'm') {
      x += first;
      y += Number(b);
    } else {
      const row = y - 0.5 - margin;
      for (let i = 0; i < first; i++) out[row * size + (x - margin + i)] = 1;
      x += first;
    }
  }
  return out;
}

describe('text renderer', () => {
  it('draws exactly what the legacy half-block renderer drew', () => {
    for (const [text, ecc] of SAMPLES) {
      const qr = encodeText(text, { ecc });
      expect(toText(qr, { style: 'utf8i', margin: 0 }).join('\n')).toBe(legacyRenderQRMatrix(toBooleans(qr)));
    }
  });

  it('sizes the art from the module count and the quiet zone', () => {
    const qr = encodeText('vesen', { ecc: 'M' }); // 21 × 21
    for (const style of ['utf8', 'utf8i'] as const) {
      const lines = toText(qr, { style });
      expect(lines).toHaveLength(Math.ceil((21 + 4) / 2));
      for (const line of lines) expect(Array.from(line)).toHaveLength(25);
      expect(textColumns(qr, { style })).toBe(25);
    }
    const ascii = toText(qr, { style: 'ascii', margin: 1 });
    expect(ascii).toHaveLength(23);
    expect(ascii.every((l) => l.length === 46 && /^(##|  )+$/.test(l))).toBe(true);
    expect(textColumns(qr, { style: 'ascii', margin: 1 })).toBe(46);
  });

  it('is lossless: the art reads back to the symbol, in both polarities', () => {
    for (const [text, ecc] of SAMPLES) {
      const qr = encodeText(text, { ecc });
      for (const style of ['utf8', 'utf8i'] as TextStyle[]) {
        const margin = 2;
        const lines = toText(qr, { style, margin });
        const paintsDark = style === 'utf8i';
        for (let y = 0; y < qr.size; y++) {
          for (let x = 0; x < qr.size; x++) {
            const glyph = Array.from(lines[(y + margin) >> 1]!)[x + margin]!;
            const upper = (y + margin) % 2 === 0;
            const painted = glyph === '█' || glyph === (upper ? '▀' : '▄');
            expect(painted === paintsDark).toBe(qr.modules[y * qr.size + x] === 1);
          }
        }
      }
    }
  });

  it('paints the quiet zone in utf8 style and leaves it blank in utf8i', () => {
    const qr = encodeText('vesen');
    expect(toText(qr, { style: 'utf8', margin: 2 })[0]).toBe('█'.repeat(25));
    expect(toText(qr, { style: 'utf8i', margin: 2 })[0]).toBe(' '.repeat(25));
    expect(() => toText(qr, { style: 'utf8', margin: -1 })).toThrow(RangeError);
  });
});

describe('SVG renderer', () => {
  it('draws one stroked path whose runs read back to the symbol', () => {
    for (const [text, ecc] of SAMPLES) {
      const qr = encodeText(text, { ecc });
      for (const margin of [0, 4]) {
        expect(modulesFromPath(toSvgPath(qr, margin), qr.size, margin)).toEqual(qr.modules);
      }
    }
  });

  it('frames the code in a quiet zone, in module units, with crisp edges', () => {
    const qr = encodeText('https://www.vesen.app'); // 25 × 25
    const svg = toSvg(qr);
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 33 33" shape-rendering="crispEdges"/);
    expect(svg).toContain('<rect width="33" height="33" fill="#fff"/>');
    expect(svg.match(/<path /g)).toHaveLength(1);
    expect(svg).toContain('fill="none" stroke-width="1" stroke="#000"');
    expect(svg).toContain('aria-hidden="true"');
    expect(toSvg(qr, { margin: 0 })).toContain('viewBox="0 0 25 25"');
  });

  it('escapes the title and palette, and can draw with theme variables', () => {
    const qr = encodeText('vesen');
    const svg = toSvg(qr, { title: `QR <u>x</u> & "quotes" 'too'`, palette: { ink: '#123"', paper: '<p>' } });
    expect(svg).toContain('role="img" aria-label="QR &lt;u&gt;x&lt;/u&gt; &amp; &quot;quotes&quot; &#39;too&#39;"');
    expect(svg).toContain('<title>QR &lt;u&gt;x&lt;/u&gt; &amp; &quot;quotes&quot; &#39;too&#39;</title>');
    expect(svg).toContain('stroke="#123&quot;"');
    expect(svg).toContain('fill="&lt;p&gt;"');
    expect(svg).not.toMatch(/<u>|<p>/);
    const themed = toSvg(qr, { palette: 'css-vars' });
    expect(themed).toContain('style="fill:var(--role-qr-paper,#fff)"');
    expect(themed).toContain('style="stroke:var(--role-qr-ink,#000)"');
  });

  it('contains only numbers and path commands in the path data', () => {
    const d = toSvgPath(encodeText('Kia ora 🦉', { ecc: 'H' }));
    expect(d).toMatch(/^M\d+ \d+\.5h\d+(m-?\d+ -?\d+h\d+)*$/);
  });
});

describe('raster renderer', () => {
  it('scales modules and adds the quiet zone', () => {
    const qr = encodeText('vesen'); // 21 × 21
    const r = toRaster(qr, { scale: 3, margin: 4 });
    expect(r.width).toBe((21 + 8) * 3);
    expect(r.height).toBe(r.width);
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        const mx = Math.floor(x / 3) - 4;
        const my = Math.floor(y / 3) - 4;
        const inside = mx >= 0 && my >= 0 && mx < 21 && my < 21;
        const expected = inside ? qr.modules[my * 21 + mx] : 0;
        if (r.dark[y * r.width + x] !== expected) throw new Error(`pixel ${x},${y}`);
      }
    }
  });

  it('writes opaque RGBA in the chosen colours', () => {
    const qr = encodeText('vesen');
    const { width, height, data } = toRgba(qr, { scale: 1, margin: 0, ink: [10, 20, 30], paper: [250, 240, 230] });
    expect(data.length).toBe(width * height * 4);
    // The top-left module is the corner of a finder pattern, so it is dark.
    expect(Array.from(data.subarray(0, 4))).toEqual([10, 20, 30, 255]);
    expect(Array.from(data.subarray(7 * 4, 7 * 4 + 4))).toEqual([250, 240, 230, 255]);
    expect(() => toRaster(qr, { scale: 0 })).toThrow(RangeError);
  });
});
