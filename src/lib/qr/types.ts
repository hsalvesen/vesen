// Types for the in-house QR encoder (ISO/IEC 18004:2015, model 2, versions 1-40).
// Framework-free and DOM-free; the only platform API the encoder uses is TextEncoder.

/** Error-correction level: the share of the symbol that can be damaged and still read (7, 15, 25, 30%). */
export type EccLevel = 'L' | 'M' | 'Q' | 'H';

/** One of the eight data masks of ISO 18004 section 7.8.2. */
export type MaskId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Segment modes the encoder supports. Kanji, ECI and structured append are left out. */
export type SegmentMode = 'numeric' | 'alphanumeric' | 'byte';

/** A QR version, 1 to 40; validated where it enters the encoder. */
export type Version = number;

/** A run of text encoded in one mode, with its data bits (no header). */
export interface Segment {
  readonly mode: SegmentMode;
  /** The characters this segment encodes. */
  readonly text: string;
  /** The character count field: digits, alphanumeric characters, or UTF-8 bytes. */
  readonly charCount: number;
  readonly bits: readonly number[];
}

/** Scores a masked symbol; lower is better. Row-major modules, 1 = dark. */
export type PenaltyFn = (modules: Uint8Array, size: number) => number;

export interface EncodeOptions {
  /** Error-correction level. Default 'M'. */
  ecc?: EccLevel;
  /** Raise the level while the data still fits the chosen version. Default false. */
  boostEcc?: boolean;
  /** Use exactly this version; throws QrCapacityError when the data does not fit. */
  version?: Version;
  /** Smallest version to consider (qrencode's -v). Default 1. Ignored when `version` is set. */
  minVersion?: Version;
  /** Largest version to consider. Default 40. Ignored when `version` is set. */
  maxVersion?: Version;
  /** Force a mask; 'auto' (the default) picks the lowest ISO penalty, ties going to the lowest id. */
  mask?: MaskId | 'auto';
  /** 'optimal' (the default) splits text into the shortest mix of modes; a mode forces one segment. */
  mode?: 'optimal' | SegmentMode;
  /** Test seam: score masks with another penalty. Production code never sets it. */
  penalty?: PenaltyFn;
}

/** An encoded symbol. `modules` is row-major, `size * size` long, 1 = dark, with no quiet zone. */
export interface QrSymbol {
  readonly version: Version;
  readonly size: number;
  /** The level actually used, after any boost. */
  readonly ecc: EccLevel;
  readonly requestedEcc: EccLevel;
  readonly mask: MaskId;
  readonly segments: readonly { readonly mode: SegmentMode; readonly charCount: number }[];
  /** Header and data bits, before the terminator and padding. */
  readonly dataBits: number;
  /** Data capacity of this version and level, in bits. */
  readonly capacityBits: number;
  readonly modules: Uint8Array;
}

const ORDER: readonly EccLevel[] = ['L', 'M', 'Q', 'H'];

/** The data does not fit any allowed version at the requested level. */
export class QrCapacityError extends Error {
  /** UTF-8 length of the text that did not fit. */
  readonly bytes: number;
  readonly needBits: number;
  readonly maxBits: number;
  readonly ecc: EccLevel;
  /** Byte-mode capacity of the largest allowed version at each level, for the error message. */
  readonly maxBytes: Readonly<Record<EccLevel, number>>;

  constructor(o: { bytes: number; needBits: number; maxBits: number; ecc: EccLevel; maxBytes: Record<EccLevel, number> }) {
    super(`too long for a QR code: ${o.bytes} bytes; level ${o.ecc} holds ${o.maxBytes[o.ecc]}`);
    this.name = 'QrCapacityError';
    this.bytes = o.bytes;
    this.needBits = o.needBits;
    this.maxBits = o.maxBits;
    this.ecc = o.ecc;
    this.maxBytes = Object.freeze({ ...o.maxBytes });
  }
}

export function isEccLevel(value: unknown): value is EccLevel {
  return typeof value === 'string' && ORDER.indexOf(value as EccLevel) !== -1;
}

export function isMaskId(value: unknown): value is MaskId {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 7;
}
