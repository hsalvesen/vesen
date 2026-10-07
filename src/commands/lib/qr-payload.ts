// What qr encodes for what was typed (docs/plan/06-qr.md, "Payload rules"):
//
// - a bare host, optionally with a port and a path (`vesen.app`, `localhost:5173/x`), with an
//   alphabetic top-level domain or localhost, gains https:// once `new URL()` accepts it;
// - a known scheme is kept as typed (http, https, mailto, tel, sms, geo, WIFI:, BEGIN:VCARD,
//   otpauth and any `scheme://`); javascript: and vbscript: are refused;
// - the name of a file here (`README.md`) is encoded as the name, with a tip;
// - an email address stays text, with a tip to use mailto:, and a phone number stays text, with
//   a tip to use tel:;
// - anything with whitespace, or like v1.2.0, 3.14 or 'e.g.', is literal text;
// - --text and --url force the choice.

export type PayloadKind = 'link' | 'text';

export interface Payload {
  /** Exactly what is encoded. */
  readonly value: string;
  /** A link opens when scanned; anything else is read as text. */
  readonly kind: PayloadKind;
  /** A dim note on the head line. */
  readonly note?: string;
  /** A dim tip under the code. */
  readonly tip?: string;
}

export interface PayloadOptions {
  readonly force?: 'text' | 'url';
  /** True when `name` is a file or folder here. */
  readonly fileExists?: (name: string) => boolean;
}

/** Why a payload is not encoded; `usage` when the options asked for what cannot be. */
export interface PayloadError {
  readonly error: string;
  readonly usage?: boolean;
}

/** The note on a link that gained https://. */
export const HTTPS_NOTE = 'added https:// · --text encodes exactly what you typed';

const SCHEME = /^([a-z][a-z0-9+.-]*):/i;

/** Schemes kept as typed, as phones read them, besides any `scheme://`. */
const KNOWN_SCHEMES: ReadonlySet<string> = new Set([
  'http',
  'https',
  'mailto',
  'tel',
  'sms',
  'smsto',
  'mms',
  'geo',
  'wifi',
  'begin',
  'otpauth',
  'otpauth-migration',
  'mecard',
  'matmsg',
  'bitcoin',
  'facetime',
  'facetime-audio',
  'market',
  'spotify',
  'whatsapp',
]);

/** Schemes whose codes hold data a phone reads (a network, a contact, a key), not a link to open. */
const DATA_SCHEMES: ReadonlySet<string> = new Set(['wifi', 'begin', 'mecard', 'matmsg', 'otpauth', 'otpauth-migration']);

const REFUSED = /^[\s\u0000-\u001f]*(javascript|vbscript)\s*:/i;

/** A host name label: letters (any script), digits and inner hyphens. */
const LABEL = '[\\p{L}\\p{N}](?:[\\p{L}\\p{N}-]{0,61}[\\p{L}\\p{N}])?';

/** A bare host with an alphabetic top-level domain, or localhost; then an optional port and path. */
const BARE_HOST = new RegExp(`^(?:(?:${LABEL}\\.)+\\p{L}{2,63}|localhost)(?::\\d{1,5})?(?:[/?#][^\\s]*)?$`, 'iu');

const EMAIL = /^[^\s@:/]+@[^\s@:/]+\.[^\s@:/]+$/;

/** Version numbers and decimals: v1.2.0, 3.14, 1.2.3. */
const VERSION_LIKE = /^v?\d+(?:\.\d+)+$/i;

/** Digits with the separators people write phone numbers with, and an optional leading +. */
const PHONE = /^\+?[\d\s().-]+$/;

function digits(text: string): string {
  return text.replace(/\D/g, '');
}

/** True for something written as a phone number: 8 to 15 digits, and not a date or a decimal. */
function phoneLike(text: string): boolean {
  if (!PHONE.test(text)) return false;
  const count = digits(text).length;
  if (count < 8 || count > 15) return false;
  // Dates, decimals and IPv4 addresses are written with digits too.
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text) || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(text)) return false;
  return !/^\d+\.\d+$/.test(text);
}

/** `https://` + `text` when it is a bare host `new URL()` reads as one; otherwise null. */
function asBareHost(text: string): string | null {
  if (!BARE_HOST.test(text)) return null;
  try {
    const url = new URL(`https://${text}`);
    return url.protocol === 'https:' && url.hostname !== '' ? `https://${text}` : null;
  } catch {
    return null;
  }
}

/** What `raw` encodes as, or why it will not be encoded. */
export function classifyPayload(raw: string, o: PayloadOptions = {}): Payload | PayloadError {
  // A javascript: or vbscript: link is refused however it is asked for, --text included. Prose
  // that only starts with the word ('JavaScript: The Good Parts') has spaces, so it is text, as
  // anything with spaces is; asked for as a link with --url, it is refused all the same.
  const refused = REFUSED.exec(raw);
  if (refused && (o.force === 'url' || !/\s/.test(raw.trim()))) return { error: `won't encode ${refused[1]!.toLowerCase()}: links` };

  if (o.force === 'text') return { value: raw, kind: 'text' };

  const scheme = SCHEME.exec(raw)?.[1]?.toLowerCase();
  const isScheme = scheme !== undefined && (KNOWN_SCHEMES.has(scheme) || raw.slice(scheme.length + 1).startsWith('//'));

  if (o.force === 'url') {
    if (isScheme) return { value: raw, kind: 'link' };
    const url = asBareHost(raw);
    if (url !== null) return { value: url, kind: 'link', note: HTTPS_NOTE };
    return { error: `--url needs a link, such as vesen.app (got '${raw}')`, usage: true };
  }

  if (isScheme) return { value: raw, kind: DATA_SCHEMES.has(scheme ?? '') ? 'text' : 'link' };

  if (o.fileExists?.(raw) === true) {
    return { value: raw, kind: 'text', tip: `tip: ${raw} is a file here; this code contains the name, not the contents` };
  }
  if (EMAIL.test(raw)) return { value: raw, kind: 'text', tip: `tip: use qr mailto:${raw} for a tap-to-email code` };
  if (phoneLike(raw)) {
    const number = (raw.trim().startsWith('+') ? '+' : '') + digits(raw);
    return { value: raw, kind: 'text', tip: `tip: use qr tel:${number} for a tap-to-call code` };
  }
  if (/\s/.test(raw) || VERSION_LIKE.test(raw)) return { value: raw, kind: 'text' };

  const url = asBareHost(raw);
  if (url !== null) return { value: url, kind: 'link', note: HTTPS_NOTE };
  return { value: raw, kind: 'text' };
}
