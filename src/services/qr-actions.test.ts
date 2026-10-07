// Saving, sharing and copying a QR code, with stand-ins for the browser: downloads are Blobs whose
// URLs are revoked after 30 s, shares carry the PNG, copies fall back, and in-app browsers are
// never asked to download.
import { describe, expect, it, vi } from 'vitest';
import { encodeText, type QrView } from '../lib/qr';
import { canShareFiles, copy, download, exportScale, pageClipboard, pngFor, qrEnv, REVOKE_MS, save, share, svgFor, type QrActionHost } from './qr-actions';

function viewOf(text: string, kind: QrView['kind'] = 'link'): QrView {
  const qr = encodeText(text, { ecc: 'M' });
  return {
    payload: text,
    kind,
    size: qr.size,
    modules: qr.modules,
    version: qr.version,
    ecc: qr.ecc,
    requestedEcc: qr.requestedEcc,
    mask: qr.mask,
    bytes: text.length,
    capacity: qr.capacityBits / 8,
    options: { type: 'svg', size: 'fit', margin: 4, fullscreen: false },
    tips: [],
  };
}

const view = viewOf('https://vesen.app');

/** A page with just enough DOM for a download: a body that records the links clicked in it. */
function fakePage() {
  const clicked: { href: string; download: string; rel: string }[] = [];
  const timers: { run: () => void; ms: number }[] = [];
  const urls = { createObjectURL: vi.fn((blob: Blob) => `blob:test/${blob.type}`), revokeObjectURL: vi.fn() };
  const body = { append: vi.fn() };
  const document = {
    body,
    createElement: () => {
      const link = { href: '', download: '', rel: '', style: { display: '' }, click: () => clicked.push({ href: link.href, download: link.download, rel: link.rel }), remove: vi.fn() };
      return link;
    },
  } as unknown as Document;
  const host: QrActionHost = { document, URL: urls, setTimeout: (run, ms) => timers.push({ run, ms }) };
  return { host, clicked, timers, urls, body };
}

describe('exports', () => {
  it('are black on white with the standard quiet zone, about 512 pixels across', () => {
    expect(exportScale({ size: 25 })).toBe(16);
    expect(exportScale({ size: 177 })).toBe(4);
    expect(exportScale({ size: 21 })).toBe(18);
    expect(Array.from(pngFor(view).subarray(1, 4), (c) => String.fromCharCode(c)).join('')).toBe('PNG');
    const svg = svgFor(view);
    expect(svg).toContain('fill="#fff"');
    expect(svg).toContain('stroke="#000"');
    expect(svg).toContain(`viewBox="0 0 ${view.size + 8} ${view.size + 8}"`);
    expect(svg).toContain('<title>QR code for https://vesen.app</title>');
  });

  it('escape the payload in the SVG title', () => {
    expect(svgFor(viewOf('<u>"x"</u>', 'text'))).toContain('<title>QR code for &lt;u&gt;&quot;x&quot;&lt;/u&gt;</title>');
  });
});

describe('download', () => {
  it('clicks a download link to a Blob, and revokes its URL after 30 s', () => {
    const page = fakePage();
    expect(download(page.host, 'svg', 'qr-vesen.app.svg', 'image/svg+xml')).toBe(true);
    expect(page.clicked).toEqual([{ href: 'blob:test/image/svg+xml', download: 'qr-vesen.app.svg', rel: 'noopener' }]);
    expect(page.urls.revokeObjectURL).not.toHaveBeenCalled();
    expect(page.timers.map((t) => t.ms)).toEqual([REVOKE_MS]);
    expect(REVOKE_MS).toBe(30_000);
    page.timers[0]!.run();
    expect(page.urls.revokeObjectURL).toHaveBeenCalledWith('blob:test/image/svg+xml');
  });

  it('says false where there is no page', () => {
    expect(download({}, 'x', 'x.txt', 'text/plain')).toBe(false);
  });
});

describe('save', () => {
  it('saves a PNG or an SVG named after the host', () => {
    const page = fakePage();
    expect(save(page.host, view, 'png', { inApp: false })).toBe('Saved qr-vesen.app.png');
    expect(save(page.host, view, 'svg', { inApp: false })).toBe('Saved qr-vesen.app.svg');
    expect(page.clicked.map((c) => c.download)).toEqual(['qr-vesen.app.png', 'qr-vesen.app.svg']);
  });

  it('never tries to download in an in-app browser, and says how to save there', () => {
    const page = fakePage();
    expect(save(page.host, view, 'png', { inApp: true })).toBe("Saving isn't available in this app. Tap the code, then press and hold to save.");
    expect(page.clicked).toEqual([]);
  });
});

describe('share', () => {
  it('hands the share sheet the PNG', async () => {
    const shared = vi.fn(async (_data: ShareData) => {});
    const host: QrActionHost = { navigator: { share: shared, canShare: () => true } };
    expect(await share(host, view)).toBe('Shared.');
    const data = shared.mock.calls[0]![0];
    const file = data.files?.[0];
    expect(file?.name).toBe('qr-vesen.app.png');
    expect(file?.type).toBe('image/png');
    expect(new Uint8Array(await file!.arrayBuffer())).toEqual(pngFor(view));
  });

  it('says nothing when the visitor cancels, and what to do when sharing fails', async () => {
    const cancelled: QrActionHost = { navigator: { share: () => Promise.reject(new DOMException('no', 'AbortError')), canShare: () => true } };
    expect(await share(cancelled, view)).toBe('');
    const refused: QrActionHost = { navigator: { share: () => Promise.reject(new DOMException('no', 'NotAllowedError')), canShare: () => true } };
    expect(await share(refused, view)).toBe("Couldn't share here. Press and hold the code to save it.");
    expect(await share({ navigator: { share: vi.fn(), canShare: () => false } }, view)).toBe("Couldn't share here. Press and hold the code to save it.");
    expect(await share({}, view)).toBe("Couldn't share here. Press and hold the code to save it.");
  });

  it('is offered only where files can be shared', () => {
    expect(canShareFiles(undefined)).toBe(false);
    expect(canShareFiles({ share: vi.fn() })).toBe(false);
    expect(canShareFiles({ share: vi.fn(), canShare: () => true })).toBe(true);
    expect(canShareFiles({ share: vi.fn(), canShare: () => { throw new TypeError('no'); } })).toBe(false);
  });
});

describe('copy', () => {
  it('copies the payload', async () => {
    const write = vi.fn(async () => true);
    expect(await copy(view, write)).toBe('Copied.');
    expect(write).toHaveBeenCalledWith('https://vesen.app');
  });

  it("uses the page's clipboard, and says how to copy by hand when nothing works", async () => {
    const writeText = vi.fn(async () => {});
    expect(await copy(view, pageClipboard({ navigator: { clipboard: { writeText } } }))).toBe('Copied.');
    expect(writeText).toHaveBeenCalledWith('https://vesen.app');
    const denied = pageClipboard({ navigator: { clipboard: { writeText: () => Promise.reject(new Error('denied')) } } });
    expect(await copy(view, denied)).toBe("Couldn't copy here. Press and hold the link to copy it.");
    expect(await copy(viewOf('hello', 'text'), pageClipboard({}))).toBe("Couldn't copy here. Press and hold the text to copy it.");
    expect(await copy(view, () => Promise.reject(new Error('no')))).toBe("Couldn't copy here. Press and hold the link to copy it.");
  });
});

describe('qrEnv', () => {
  it('knows an in-app browser, a touch screen and the share sheet', () => {
    const instagram =
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0.0';
    const coarse = ((query: string) => ({ matches: query === '(pointer: coarse)' })) as unknown as Window['matchMedia'];
    expect(qrEnv({ navigator: { userAgent: instagram, share: vi.fn(), canShare: () => true }, matchMedia: coarse })).toEqual({
      touch: true,
      inApp: true,
      canShareFiles: true,
    });
    expect(qrEnv({ navigator: { userAgent: 'Mozilla/5.0 (Macintosh)' } })).toEqual({ touch: false, inApp: false, canShareFiles: false });
  });
});
