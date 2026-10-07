// The in-house QR encoder and its renderers. Import from here, not from the individual modules.
export { encodeSegments, encodeText } from './encode';
export { applyMask, maskBit, penaltyIso, penaltyScore, type PenaltyBreakdown } from './mask';
export { segmentOptimally } from './segmenter';
export { ALPHANUMERIC_CHARSET, detectMode, isAlphanumeric, isNumeric, makeSegment, segmentBits } from './segments';
export {
  dataCodewords,
  ECC_ORDER,
  isVersion,
  MAX_VERSION,
  maxPayloadBytes,
  maxPayloadChars,
  MIN_VERSION,
  symbolSize,
} from './tables';
export {
  isEccLevel,
  isMaskId,
  QrCapacityError,
  type EccLevel,
  type EncodeOptions,
  type MaskId,
  type PenaltyFn,
  type QrSymbol,
  type Segment,
  type SegmentMode,
  type Version,
} from './types';
export { toRaster, toRgba, type Raster, type RasterOptions, type RgbaRaster, type Rgb } from './render/raster';
export { toSvg, toSvgPath, type SvgOptions, type SvgPalette } from './render/svg';
export { textColumns, toText, type TextOptions, type TextStyle } from './render/text';
export { adler32, base64, crc32, pngDataUrl, pngScanlines, toPng, zlibStored, type PngOptions } from './render/png';
export { DENSE_PX, formatPx, moduleSize, type ModuleSize, type ModuleSizeOptions } from './render/layout';
export {
  asQrView,
  cardHint,
  displayPayload,
  metaLine,
  middleEllipsis,
  qrFileName,
  raisedNote,
  type QrDisplay,
  type QrView,
  type QrViewOptions,
} from './view';
