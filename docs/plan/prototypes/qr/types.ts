export type EccLevel = 'L' | 'M' | 'Q' | 'H';
export type MaskId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type Version = number; // 1..40, validated at boundaries
export type SegmentMode = 'numeric' | 'alphanumeric' | 'byte';
export interface Segment { readonly text: string; readonly mode: SegmentMode; readonly charCount: number; readonly bits: readonly number[]; }
export interface EncodeOptions { ecc?: EccLevel; minVersion?: Version; maxVersion?: Version; mask?: MaskId | 'auto'; boostEcc?: boolean; mode?: SegmentMode | 'auto'; }
export interface QrSymbol { readonly version: Version; readonly ecc: EccLevel; readonly mask: MaskId; readonly size: number; readonly modules: Uint8Array; readonly mode: SegmentMode; readonly dataBytes: number; readonly capacityBytes: number; }
export class QrCapacityError extends Error { constructor(readonly needBits: number, readonly maxBits: number, readonly ecc: EccLevel) { super(`data too long: needs ${needBits} bits, max ${maxBits} at ECC ${ecc}`); this.name = 'QrCapacityError'; } }
