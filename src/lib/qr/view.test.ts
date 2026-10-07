// The card's geometry and words: module sizes snapped to device pixels, the 375 px acceptance
// range, the meta line, the payload as shown, the hints and the saved file names.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { encodeText } from './encode';
import { formatPx, moduleSize } from './render/layout';
import { asQrView, cardHint, displayPayload, metaLine, middleEllipsis, qrFileName, raisedNote, type QrView } from './view';

describe('moduleSize', () => {
  it('draws 8 CSS pixels a module on a desktop when there is room', () => {
    expect(moduleSize(37, 1200, 1, { cap: 8 })).toEqual({ px: 8, clamped: false, dense: false });
    expect(moduleSize(37, 1200, 2, { cap: 8 }).px * 37).toBe(296);
  });

  it('shrinks to fit, in whole device pixels', () => {
    const sized = moduleSize(33, 296, 3, { cap: 10 });
    expect(sized.px * 3).toBe(26);
    expect(sized.px * 33).toBeLessThanOrEqual(296);
  });

  it('takes a requested size over the cap, and says when it had to shrink it', () => {
    expect(moduleSize(29, 1200, 1, { cap: 8, requested: 12 })).toEqual({ px: 12, clamped: false, dense: false });
    expect(moduleSize(29, 200, 1, { cap: 8, requested: 12 })).toMatchObject({ px: 6, clamped: true });
  });

  it('flags modules under 3 pixels as dense, and never goes below one device pixel', () => {
    expect(moduleSize(185, 300, 1, { cap: 8 })).toMatchObject({ px: 1, dense: true });
    expect(moduleSize(185, 10, 2, { cap: 8 }).px).toBe(0.5);
  });

  it('keeps to the cap when the room is not known yet', () => {
    expect(moduleSize(33, 0, 2, { cap: 10 }).px).toBe(10);
  });

  it('never exceeds the room and always lands on device pixels', () => {
    fc.assert(
      fc.property(fc.integer({ min: 21, max: 197 }), fc.integer({ min: 200, max: 3000 }), fc.constantFrom(1, 1.5, 2, 2.625, 3), (total, room, dpr) => {
        const { px } = moduleSize(total, room, dpr, { cap: 8 });
        const device = px * dpr;
        expect(Math.abs(device - Math.round(device))).toBeLessThan(1e-9);
        if (px > 1 / dpr) expect(px * total).toBeLessThanOrEqual(room + 1e-9);
      }),
    );
  });

  it('puts every v1 to v3 code between 264 and 296 px on a 375 px phone (296 px of room)', () => {
    for (const dpr of [1, 2, 2.625, 3]) {
      for (const size of [21, 25, 29]) {
        const total = size + 8;
        const side = moduleSize(total, 296, dpr, { cap: 10 }).px * total;
        expect(side, `v${(size - 17) / 4} at ${dpr}x`).toBeGreaterThanOrEqual(264);
        expect(side).toBeLessThanOrEqual(296);
      }
    }
    // A v1 code takes the 10-pixel cap.
    expect(moduleSize(29, 296, 3, { cap: 10 }).px * 29).toBe(290);
  });

  it('formats a size for a note', () => {
    expect(formatPx(8)).toBe('8');
    expect(formatPx(26 / 3)).toBe('8.7');
  });
});

function viewOf(text: string, extra: Partial<QrView> = {}): QrView {
  const qr = encodeText(text, { ecc: 'M', boostEcc: true });
  return {
    payload: text,
    kind: 'link',
    size: qr.size,
    modules: qr.modules,
    version: qr.version,
    ecc: qr.ecc,
    requestedEcc: qr.requestedEcc,
    mask: qr.mask,
    bytes: new TextEncoder().encode(text).length,
    capacity: qr.capacityBits / 8,
    options: { type: 'svg', size: 'fit', margin: 4, fullscreen: false },
    tips: [],
    ...extra,
  };
}

describe('the words on the card', () => {
  it('writes the meta line as v3 · 29×29 · EC M · 34/44 B · mask 2', () => {
    // 44 data codewords: version 3 holds 70, and level M spends 26 on error correction.
    const qr = encodeText('https://github.com/hsalvesen/vesen', { ecc: 'M', mask: 2 });
    expect(metaLine({ version: qr.version, size: qr.size, ecc: qr.ecc, bytes: 34, capacity: qr.capacityBits / 8, mask: qr.mask })).toBe(
      'v3 · 29×29 · EC M · 34/44 B · mask 2',
    );
  });

  it('says when the level was raised for free', () => {
    const view = viewOf('https://vesen.app');
    expect(view.ecc).toBe('Q');
    expect(raisedNote(view)).toBe('Error correction raised from M to Q for free; -e M keeps M.');
    expect(raisedNote({ ecc: 'M', requestedEcc: 'M' })).toBeUndefined();
  });

  it('shows line breaks and controls, and hides nothing', () => {
    expect(displayPayload('BEGIN:VCARD\nEND:VCARD')).toBe('BEGIN:VCARD⏎END:VCARD');
    expect(displayPayload('a\u0007b\u202ec')).toBe('a\ufffdb\ufffdc');
    expect(displayPayload('<u>x</u>')).toBe('<u>x</u>');
  });

  it('cuts long payloads in the middle', () => {
    expect(middleEllipsis('https://www.wikipedia.org/wiki/Computer_terminal', 21)).toBe('https://ww…r_terminal');
    expect(middleEllipsis('short', 10)).toBe('short');
    expect(middleEllipsis('🦉🦉🦉🦉🦉', 3)).toBe('🦉…🦉');
    expect(middleEllipsis('abc', 1)).toBe('…');
  });

  it('hints at what scanning does, and at full screen on a phone and in vintage mode', () => {
    expect(cardHint({ kind: 'link', touch: false, vintage: false })).toBe('Scan with your phone camera to open the link');
    expect(cardHint({ kind: 'text', touch: false, vintage: false })).toBe('Scan with your phone camera to read the text');
    expect(cardHint({ kind: 'link', touch: true, vintage: false })).toBe('Tap the code for full screen, then let a friend scan it');
    expect(cardHint({ kind: 'link', touch: false, vintage: true })).toContain('full-screen');
  });

  it('names saved files after the host or the text', () => {
    expect(qrFileName({ payload: 'https://vesen.app', kind: 'link' }, 'png')).toBe('qr-vesen.app.png');
    expect(qrFileName({ payload: 'https://www.wikipedia.org/wiki/X', kind: 'link' }, 'svg')).toBe('qr-wikipedia.org.svg');
    expect(qrFileName({ payload: 'mailto:has@salvesen.app', kind: 'link' }, 'png')).toBe('qr-has-salvesen.app.png');
    expect(qrFileName({ payload: 'Hello, world!', kind: 'text' }, 'png')).toBe('qr-hello-world.png');
    expect(qrFileName({ payload: '🦉', kind: 'text' }, 'png')).toBe('qr-code.png');
    expect(qrFileName({ payload: '../../etc/passwd', kind: 'text' }, 'png')).toBe('qr-etc-passwd.png');
  });
});

describe('asQrView', () => {
  it('accepts a view the command built, and nothing malformed', () => {
    const view = viewOf('https://vesen.app');
    expect(asQrView(view)).toBe(view);
    expect(asQrView(null)).toBeNull();
    expect(asQrView({ ...view, modules: [1, 0] })).toBeNull();
    expect(asQrView({ ...view, size: 22 })).toBeNull();
    expect(asQrView({ ...view, ecc: 'X' })).toBeNull();
    expect(asQrView({ ...view, options: { ...view.options, type: 'html' } })).toBeNull();
    expect(asQrView({ ...view, options: { ...view.options, margin: -1 } })).toBeNull();
  });
});
