// The view model of a QR code on the screen (the `qr-card` component block and the full-screen
// Present mode), and the words both say about it. Built by the qr command; read by
// ui/components/QrCard.svelte and ui/apps/QrPresenter.svelte. Pure, so the copy is tested in Node.
import { replaceUnsafe } from '../unsafe-text';
import { MAX_VERSION } from './tables';
import { isEccLevel, isMaskId, type EccLevel, type MaskId } from './types';
import type { TextStyle } from './render/text';

/** How the code is drawn: an SVG card (the default) or text art. */
export type QrDisplay = 'svg' | TextStyle;

export interface QrViewOptions {
  readonly type: QrDisplay;
  /** CSS pixels per module (-s N), or 'fit' for the device's default. */
  readonly size: number | 'fit';
  /** The quiet zone in modules: 4 for the card and exports, 2 for text art, unless -m. */
  readonly margin: number;
  /** -f: Present mode opens as the code is drawn. */
  readonly fullscreen: boolean;
}

export interface QrView {
  /** Exactly what was encoded. */
  readonly payload: string;
  /** A link opens when scanned; anything else is read as text. Sets the hint and Copy's label. */
  readonly kind: 'link' | 'text';
  /** Modules on a side, without the quiet zone. */
  readonly size: number;
  /** Row-major, `size * size`, 1 = dark. */
  readonly modules: Uint8Array;
  readonly version: number;
  readonly ecc: EccLevel;
  /** The level asked for; `ecc` is higher when it was raised for free. */
  readonly requestedEcc: EccLevel;
  readonly mask: MaskId;
  /** The payload's length in UTF-8 bytes. */
  readonly bytes: number;
  /** The data capacity of this version and level, in bytes (codewords). */
  readonly capacity: number;
  readonly options: QrViewOptions;
  /** A dim note after the payload on the head line, such as 'added https://'. */
  readonly note?: string;
  /** Dim lines under the meta line: tips and warnings. */
  readonly tips: readonly string[];
}

/** `v3 · 29×29 · EC M · 34/42 B · mask 2` */
export function metaLine(view: Pick<QrView, 'version' | 'size' | 'ecc' | 'bytes' | 'capacity' | 'mask'>): string {
  return `v${view.version} · ${view.size}×${view.size} · EC ${view.ecc} · ${view.bytes}/${view.capacity} B · mask ${view.mask}`;
}

/** Said when the level was raised: the meta line's title. */
export function raisedNote(view: Pick<QrView, 'ecc' | 'requestedEcc'>): string | undefined {
  if (view.ecc === view.requestedEcc) return undefined;
  return `Error correction raised from ${view.requestedEcc} to ${view.ecc} for free; -e ${view.requestedEcc} keeps ${view.requestedEcc}.`;
}

/** The payload as one line of text: line breaks shown as ⏎, other controls as U+FFFD. */
export function displayPayload(payload: string): string {
  return replaceUnsafe(payload.replace(/\r?\n/g, '⏎'));
}

/** `text` cut to `max` characters in the middle, so both its start and its end show. */
export function middleEllipsis(text: string, max: number): string {
  const chars = Array.from(text);
  if (chars.length <= max) return text;
  if (max <= 1) return '…';
  const head = Math.ceil((max - 1) / 2);
  const tail = Math.floor((max - 1) / 2);
  return `${chars.slice(0, head).join('')}…${tail > 0 ? chars.slice(chars.length - tail).join('') : ''}`;
}

/** What scanning does, under the code. */
export function cardHint(o: { kind: QrView['kind']; touch: boolean; vintage: boolean }): string {
  if (o.touch) return 'Tap the code for full screen, then let a friend scan it';
  const base = o.kind === 'link' ? 'Scan with your phone camera to open the link' : 'Scan with your phone camera to read the text';
  // The vintage filter keeps the code under the CRT glass; full screen is the clean way to scan.
  return o.vintage ? `${base}, or click it for a clean full-screen view` : base;
}

/** The file a saved code goes to: `qr-vesen.app.png`. */
export function qrFileName(view: Pick<QrView, 'payload' | 'kind'>, extension: 'png' | 'svg'): string {
  let stem = '';
  if (view.kind === 'link') {
    const host = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:@]+)/i.exec(view.payload)?.[1];
    if (host !== undefined) stem = host.toLowerCase().replace(/^www\./, '');
  }
  if (stem === '') stem = view.payload.toLowerCase();
  stem = stem
    .replace(/^[a-z][a-z0-9+.-]*:(?:\/\/)?/, '')
    .replace(/[^a-z0-9.-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 40)
    .replace(/[-.]+$/, '');
  return `qr-${stem === '' ? 'code' : stem}.${extension}`;
}

const QR_TYPES: readonly string[] = ['svg', 'utf8', 'utf8i', 'ascii'];

/**
 * `value` as a QrView when it has every field a view needs, or null. A component block's props
 * come only from the qr command, but the card checks them before it draws.
 */
export function asQrView(value: unknown): QrView | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const options = v.options as Record<string, unknown> | undefined;
  const size = v.size;
  const ok =
    typeof v.payload === 'string' &&
    (v.kind === 'link' || v.kind === 'text') &&
    typeof size === 'number' &&
    Number.isInteger(size) &&
    size >= 21 &&
    size <= 17 + 4 * MAX_VERSION &&
    v.modules instanceof Uint8Array &&
    v.modules.length === size * size &&
    typeof v.version === 'number' &&
    isEccLevel(v.ecc) &&
    isEccLevel(v.requestedEcc) &&
    isMaskId(v.mask) &&
    typeof v.bytes === 'number' &&
    typeof v.capacity === 'number' &&
    Array.isArray(v.tips) &&
    typeof options === 'object' &&
    options !== null &&
    QR_TYPES.includes(String(options.type)) &&
    (options.size === 'fit' || typeof options.size === 'number') &&
    typeof options.margin === 'number' &&
    Number.isInteger(options.margin) &&
    options.margin >= 0;
  return ok ? (value as QrView) : null;
}
