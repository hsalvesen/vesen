// Saving, sharing and copying a QR code (docs/plan/06-qr.md, "Present mode and actions"), for the
// card (ui/components/QrCard.svelte) and Present mode (ui/apps/QrPresenter.svelte). Exports are
// always black on white, whatever the theme. A save is a Blob download whose URL is revoked after
// 30 s; a share hands the PNG to the system share sheet; a copy uses the page's clipboard
// (services/clipboard.ts: the Clipboard API, then execCommand). Every one runs inside the
// visitor's tap, and each says what happened in the words the status line under the code shows.
//
// The device is read here from platform/env, as App reads it for its link policy, rather than
// through ui/links.ts: a card's chunk that imported that context would pull Svelte's runtime out
// of the first paint's chunk into one of its own.

import { qrFileName, toPng, toSvg, type QrView } from '../lib/qr';
import { coarsePointer, detectInApp } from '../platform/env';
import { createClipboard } from './clipboard';

/** How long a download's object URL lives: long enough for any browser to start the download. */
export const REVOKE_MS = 30_000;

/** How long a status message stays. */
export const STATUS_MS = 4000;

/** What the actions may do on this device. Detection only hides what cannot work. */
export interface QrEnv {
  /** A touch screen: the phone layout and hint. */
  readonly touch: boolean;
  /** An in-app browser (Instagram, Facebook, TikTok), where downloads do nothing. */
  readonly inApp: boolean;
  /** The share sheet takes image files. */
  readonly canShareFiles: boolean;
}

type ShareNavigator = {
  readonly share?: (data: ShareData) => Promise<void>;
  readonly canShare?: (data: ShareData) => boolean;
};

/** The browser objects the actions use; a test passes stand-ins. */
export interface QrActionHost {
  readonly document?: Document;
  readonly navigator?: ShareNavigator & {
    readonly userAgent?: string;
    readonly clipboard?: { writeText?(text: string): Promise<void> };
  };
  readonly URL?: { createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void };
  readonly setTimeout?: (run: () => void, ms: number) => unknown;
  readonly matchMedia?: Window['matchMedia'];
}

/** The page's own objects, or none outside a browser. */
export function browserHost(): QrActionHost {
  if (typeof window === 'undefined') return {};
  return {
    document: window.document,
    navigator: window.navigator,
    URL: window.URL,
    setTimeout: (run, ms) => window.setTimeout(run, ms),
    ...(typeof window.matchMedia === 'function' ? { matchMedia: window.matchMedia.bind(window) } : {}),
  };
}

/** Pixels per module for an exported PNG: about 512 pixels across, 4 to 24 a module. */
export function exportScale(view: Pick<QrView, 'size'>): number {
  return Math.min(24, Math.max(4, Math.ceil(512 / (view.size + 8))));
}

/** The code as a PNG file: black on white, with the standard 4-module quiet zone. */
export function pngFor(view: Pick<QrView, 'size' | 'modules'>): Uint8Array<ArrayBuffer> {
  return toPng(view, { scale: exportScale(view), margin: 4 });
}

/** The code as an SVG file: black on white, with the standard 4-module quiet zone. */
export function svgFor(view: Pick<QrView, 'size' | 'modules' | 'payload'>): string {
  return toSvg(view, { margin: 4, title: `QR code for ${view.payload}` });
}

/** True when the share sheet takes an image file here. */
export function canShareFiles(nav: ShareNavigator | undefined): boolean {
  if (typeof nav?.share !== 'function' || typeof nav.canShare !== 'function' || typeof File !== 'function') return false;
  try {
    return nav.canShare({ files: [new File([new Uint8Array([0x89])], 'qr.png', { type: 'image/png' })] });
  } catch {
    return false;
  }
}

/** What this device allows. */
export function qrEnv(host: QrActionHost = browserHost()): QrEnv {
  return {
    touch: coarsePointer(host.matchMedia === undefined ? undefined : { matchMedia: host.matchMedia }),
    inApp: detectInApp(host.navigator?.userAgent ?? '') !== null,
    canShareFiles: canShareFiles(host.navigator),
  };
}

/** The page's clipboard: the Clipboard API, then execCommand. */
export function pageClipboard(host: QrActionHost = browserHost()): (text: string) => Promise<boolean> {
  const clipboard = createClipboard(host);
  return (text) => clipboard.copy(text);
}

/** Starts a download of `data` as `name`. False where the page cannot. */
export function download(host: QrActionHost, data: BlobPart, name: string, type: string): boolean {
  const doc = host.document;
  const urls = host.URL;
  if (doc?.body == null || urls === undefined) return false;
  try {
    const url = urls.createObjectURL(new Blob([data], { type }));
    const link = doc.createElement('a');
    link.href = url;
    link.download = name;
    link.rel = 'noopener';
    link.style.display = 'none';
    doc.body.append(link);
    link.click();
    link.remove();
    const later = host.setTimeout ?? ((run: () => void, ms: number) => setTimeout(run, ms));
    later(() => urls.revokeObjectURL(url), REVOKE_MS);
    return true;
  } catch {
    return false;
  }
}

/** Saves the code as a PNG (or an SVG) and says how it went. */
export function save(host: QrActionHost, view: QrView, format: 'png' | 'svg', env: Pick<QrEnv, 'inApp'>): string {
  const name = qrFileName(view, format);
  // In an in-app browser a download goes nowhere, so it is not tried.
  const saved = !env.inApp && (format === 'png' ? download(host, pngFor(view), name, 'image/png') : download(host, svgFor(view), name, 'image/svg+xml'));
  return saved ? `Saved ${name}` : "Saving isn't available in this app. Tap the code, then press and hold to save.";
}

/** Offers the code to the share sheet: a status to show, or '' when the visitor cancelled. */
export async function share(host: QrActionHost, view: QrView): Promise<string> {
  const nav = host.navigator;
  const failed = "Couldn't share here. Press and hold the code to save it.";
  if (typeof nav?.share !== 'function' || typeof File !== 'function') return failed;
  try {
    const file = new File([pngFor(view)], qrFileName(view, 'png'), { type: 'image/png' });
    if (typeof nav.canShare === 'function' && !nav.canShare({ files: [file] })) return failed;
    await nav.share({ files: [file], title: 'QR code' });
    return 'Shared.';
  } catch (error) {
    // A cancelled share sheet is the visitor's choice, not a failure.
    return (error as { name?: unknown } | null)?.name === 'AbortError' ? '' : failed;
  }
}

/** Copies the payload with `write`, the page's clipboard, and says how it went. */
export async function copy(view: Pick<QrView, 'payload' | 'kind'>, write: (text: string) => Promise<boolean>): Promise<string> {
  let copied = false;
  try {
    copied = await write(view.payload);
  } catch {
    copied = false;
  }
  if (copied) return 'Copied.';
  return `Couldn't copy here. Press and hold the ${view.kind === 'link' ? 'link' : 'text'} to copy it.`;
}
