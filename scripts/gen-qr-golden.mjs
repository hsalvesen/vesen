#!/usr/bin/env node
// Writes tests/fixtures/qr-golden.json: about 300 QR symbols made by the `qrcode` package, each
// stored as its parameters and a SHA-256 of its modules, plus 8 small symbols in full.
// src/lib/qr/golden.test.ts re-encodes every entry with the in-house encoder, pinning the same
// segments, version and mask, so the fixture keeps guarding the encoder once `qrcode` is gone.
//
// The fixture is frozen. Regenerate it only when this script changes, with qrcode@1.5.4
// resolvable from the repository (for example after `npm install --no-save qrcode@1.5.4`):
//   node scripts/gen-qr-golden.mjs
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePayload } from './qr-golden-payloads.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tests/fixtures/qr-golden.json');
const require = createRequire(import.meta.url);

/** @type {any} */
const QR = require('qrcode');
/** @type {any} */
const Version = require('qrcode/lib/core/version.js');
/** @type {any} */
const Mode = require('qrcode/lib/core/mode.js');
/** @type {any} */
const ECLevel = require('qrcode/lib/core/error-correction-level.js');
/** @type {string} */
const ORACLE = `qrcode@${require('qrcode/package.json').version}`;

/** @typedef {'L' | 'M' | 'Q' | 'H'} EccLevel */
/** @typedef {'numeric' | 'alphanumeric' | 'byte'} SegmentMode */
/** @typedef {import('./qr-golden-payloads.mjs').PayloadSpec} PayloadSpec */
/** @typedef {import('./qr-golden-payloads.mjs').AlphabetName} AlphabetName */
/**
 * A segment's mode and its length in UTF-16 code units of the payload.
 * @typedef {[SegmentMode, number]} SegmentSpec
 */
/**
 * @typedef {{ name: string, payload: PayloadSpec, segments: SegmentSpec[], ecc: EccLevel, version: number,
 *   mask: number, sha256: string }} Entry
 */
/** @typedef {Omit<Entry, 'sha256'> & { rows: string[] }} MatrixEntry */
/** @typedef {{ version: number, maskPattern: number, modules: { size: number, data: Uint8Array },
 *   segments: { mode: { id: string }, data: string | Uint8Array }[] }} QrcodeSymbol */

/** @type {readonly EccLevel[]} */
const LEVELS = ['L', 'M', 'Q', 'H'];
/** @type {readonly SegmentMode[]} */
const MODES = ['numeric', 'alphanumeric', 'byte'];
/** @type {Record<SegmentMode, AlphabetName>} */
const ALPHABET_FOR = { numeric: 'digits', alphanumeric: 'alnum', byte: 'url' };
/** @type {Record<string, SegmentMode>} */
const MODE_FROM_ID = { Numeric: 'numeric', Alphanumeric: 'alphanumeric', Byte: 'byte' };

/** @param {SegmentMode} mode */
function qrcodeMode(mode) {
  return mode === 'numeric' ? Mode.NUMERIC : mode === 'alphanumeric' ? Mode.ALPHANUMERIC : Mode.BYTE;
}

/**
 * Characters of `mode` that exactly fill version `v` at level `ecc`.
 * @param {number} v
 * @param {EccLevel} ecc
 * @param {SegmentMode} mode
 * @returns {number}
 */
function capacity(v, ecc, mode) {
  return Version.getCapacity(v, ECLevel[ecc], qrcodeMode(mode));
}

/**
 * Cuts the payload into the pinned segments.
 * @param {string} text
 * @param {SegmentSpec[]} segments
 * @returns {{ data: string, mode: SegmentMode }[]}
 */
function cut(text, segments) {
  let at = 0;
  const parts = segments.map(([mode, length]) => {
    const data = text.slice(at, at + length);
    at += length;
    return { data, mode };
  });
  if (at !== text.length) throw new Error(`segments cover ${at} of ${text.length} code units`);
  return parts;
}

/**
 * The segments qrcode chose, as modes and lengths in the payload's code units.
 * @param {QrcodeSymbol} symbol
 * @param {string} text
 * @returns {SegmentSpec[]}
 */
function segmentsOf(symbol, text) {
  const decoder = new TextDecoder();
  let joined = '';
  /** @type {SegmentSpec[]} */
  const out = symbol.segments.map((seg) => {
    const mode = MODE_FROM_ID[seg.mode.id];
    if (!mode) throw new Error(`unexpected qrcode mode ${seg.mode.id}`);
    const data = typeof seg.data === 'string' ? seg.data : decoder.decode(seg.data);
    joined += data;
    return /** @type {SegmentSpec} */ ([mode, data.length]);
  });
  if (joined !== text) throw new Error(`qrcode's segments do not spell ${JSON.stringify(text)}`);
  return out;
}

/** @param {Uint8Array} modules */
function sha256(modules) {
  return createHash('sha256').update(modules).digest('hex');
}

/**
 * Each row of modules as hex, most significant bit first, padded with light modules to whole digits.
 * @param {{ size: number, data: Uint8Array }} modules
 * @returns {string[]}
 */
function hexRows({ size, data }) {
  /** @type {string[]} */
  const rows = [];
  for (let y = 0; y < size; y++) {
    let bits = '';
    for (let x = 0; x < size; x++) bits += data[y * size + x] ? '1' : '0';
    bits = bits.padEnd(Math.ceil(size / 4) * 4, '0');
    let hex = '';
    for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
    rows.push(hex);
  }
  return rows;
}

/**
 * Builds one symbol with qrcode. Pinned segments are passed as they are; otherwise qrcode splits
 * the text itself. A missing version or mask is left to qrcode.
 * @param {string} name
 * @param {PayloadSpec} payload
 * @param {EccLevel} ecc
 * @param {{ segments?: SegmentSpec[], version?: number, mask?: number }} [pin]
 * @returns {{ entry: Entry, symbol: QrcodeSymbol }}
 */
function make(name, payload, ecc, pin = {}) {
  const text = makePayload(payload);
  const input = pin.segments ? cut(text, pin.segments) : text;
  /** @type {QrcodeSymbol} */
  const symbol = QR.create(input, {
    errorCorrectionLevel: ecc,
    ...(pin.version === undefined ? {} : { version: pin.version }),
    ...(pin.mask === undefined ? {} : { maskPattern: pin.mask }),
  });
  const segments = pin.segments ?? segmentsOf(symbol, text);
  const entry = { name, payload, segments, ecc, version: symbol.version, mask: symbol.maskPattern, sha256: sha256(symbol.modules.data) };
  return { entry, symbol };
}

/**
 * Pinned segments from literal parts.
 * @param {[SegmentMode, string][]} parts
 * @returns {{ payload: string, segments: SegmentSpec[] }}
 */
function pinned(parts) {
  return {
    payload: parts.map(([, text]) => text).join(''),
    segments: parts.map(([mode, text]) => /** @type {SegmentSpec} */ ([mode, text.length])),
  };
}

/** @type {Entry[]} */
const entries = [];

// Every version and level, filled to capacity in one mode, at a forced mask. The modes and
// masks rotate so each version sees all three modes and each mask appears at every level.
for (let v = 1; v <= 40; v++) {
  LEVELS.forEach((ecc, e) => {
    const mode = /** @type {SegmentMode} */ (MODES[(v + e) % 3]);
    const mask = (v * 3 + e) % 8;
    const length = capacity(v, ecc, mode);
    const payload = { seed: v * 100 + e, length, alphabet: ALPHABET_FOR[mode] };
    entries.push(make(`full ${mode} v${v}-${ecc} mask ${mask}`, payload, ecc, { segments: [[mode, length]], version: v, mask }).entry);
  });
}

// About half full, so terminator and pad codewords appear, at every other version.
for (let v = 2; v <= 40; v += 2) {
  const ecc = /** @type {EccLevel} */ (LEVELS[(v / 2) % 4]);
  const mode = /** @type {SegmentMode} */ (MODES[(v / 2) % 3]);
  const length = Math.max(1, Math.floor(capacity(v, ecc, mode) / 2) + 1);
  const mask = (v + 1) % 8;
  const payload = { seed: 3000 + v, length, alphabet: ALPHABET_FOR[mode] };
  entries.push(make(`half ${mode} v${v}-${ecc} mask ${mask}`, payload, ecc, { segments: [[mode, length]], version: v, mask }).entry);
}

// One byte past a version's capacity: qrcode moves to the next version and picks the mask.
for (const v of [1, 9, 10, 26, 27, 39]) {
  LEVELS.forEach((ecc, e) => {
    const length = capacity(v, ecc, 'byte') + 1;
    const payload = { seed: 5000 + v * 10 + e, length, alphabet: /** @type {AlphabetName} */ ('url') };
    entries.push(make(`byte v${v}-${ecc} capacity plus one`, payload, ecc, { segments: [['byte', length]] }).entry);
  });
}

// Every mask on a small and a version-7 symbol.
for (let mask = 0; mask < 8; mask++) {
  entries.push(make(`HELLO WORLD 1-Q mask ${mask}`, 'HELLO WORLD', 'Q', { segments: [['alphanumeric', 11]], version: 1, mask }).entry);
  const text = 'https://www.vesen.app/?q=0123456789';
  entries.push(make(`v7-M mask ${mask}`, text, 'M', { segments: [['byte', text.length]], version: 7, mask }).entry);
}

// Real-world text, split and masked by qrcode itself.
const REALISTIC = [
  'https://www.vesen.app',
  'vesen.app',
  'https://github.com/hsalvesen/vesen',
  'https://www.instagram.com/vesen.app/',
  'mailto:has@salvesen.app',
  'tel:+61412345678',
  'sms:+61412345678?body=Kia%20ora',
  'geo:-33.8688,151.2093',
  'WIFI:T:WPA;S:vesen;P:correct horse battery staple;;',
  'BEGIN:VCARD\nVERSION:3.0\nFN:Has Salvesen\nURL:https://www.vesen.app\nEND:VCARD',
  'otpauth://totp/vesen:has?secret=JBSWY3DPEHPK3PXP&issuer=vesen',
  'HELLO WORLD',
  '01234567',
  '3141592653589793238462643383279502884197',
  'HTTPS://WWW.VESEN.APP/QR',
  'Gadigal Country',
  'Kia ora, Aotearoa',
  'Māori macrons: ā ē ī ō ū',
  'owl 🦉 kangaroo 🦘',
  '終端機 テスト 中文',
  '€100 ☕ café',
  'a',
  '0',
  ' ',
  'https://www.wikipedia.org/wiki/Computer_terminal',
  'https://explainshell.com/explain?cmd=ls+-la',
  'ORDER 12345678901234567890 SHIPPED',
  'v1.2.0',
  'Order #A-1029: 3 × flat white, 1 × long black — total $14.50',
  'https://www.vesen.app/?utm_source=instagram&utm_medium=bio&utm_campaign=2026-10',
];
REALISTIC.forEach((text, i) => {
  for (const ecc of [LEVELS[i % 4], LEVELS[(i + 2) % 4]]) {
    const level = /** @type {EccLevel} */ (ecc);
    entries.push(make(`auto ${level} ${JSON.stringify(text).slice(1, 41)}`, text, level).entry);
  }
});

// Mixed segments pinned to a given split, with qrcode choosing version and mask.
const MIXED = [
  pinned([['byte', 'tel:+'], ['numeric', '61412345678901234']]),
  pinned([['alphanumeric', 'HTTPS://VESEN.APP/'], ['numeric', '20261006'], ['byte', '?q=ā']]),
  pinned([['numeric', '0123'], ['alphanumeric', 'ABC'], ['byte', 'xyz'], ['numeric', '456789']]),
  pinned([['byte', '🦉'], ['numeric', '123456789012'], ['byte', '🦘']]),
  pinned([['alphanumeric', 'ORDER '], ['numeric', '12345678901234567890'], ['alphanumeric', ' SHIPPED']]),
];
MIXED.forEach(({ payload, segments }, i) => {
  for (const ecc of [LEVELS[i % 4], LEVELS[(i + 1) % 4]]) {
    const level = /** @type {EccLevel} */ (ecc);
    entries.push(make(`mixed ${level} ${JSON.stringify(payload).slice(1, 41)}`, payload, level, { segments }).entry);
  }
});

// Small symbols kept whole, so a failure shows exactly which modules differ.
/** @type {[string, EccLevel][]} */
const SMALL = [
  ['HELLO WORLD', 'Q'],
  ['01234567', 'M'],
  ['https://www.vesen.app', 'M'],
  ['vesen', 'L'],
  ['Kia ora, Aotearoa', 'H'],
  ['tel:+61412345678', 'Q'],
  ['https://github.com/hsalvesen/vesen', 'M'],
  ['owl 🦉', 'H'],
];
/** @type {MatrixEntry[]} */
const matrices = SMALL.map(([text, ecc]) => {
  const { entry, symbol } = make(`matrix ${ecc} ${text}`, text, ecc);
  const { name, payload, segments, version, mask } = entry;
  return { name, payload, segments, ecc: entry.ecc, version, mask, rows: hexRows(symbol.modules) };
});

const line = (/** @type {unknown} */ value) => JSON.stringify(value);
const json = [
  '{',
  `  "about": ${line('QR symbols made by ' + ORACLE + ', checked by src/lib/qr/golden.test.ts. Written by scripts/gen-qr-golden.mjs; do not edit by hand.')},`,
  `  "oracle": ${line(ORACLE)},`,
  `  "hash": ${line('SHA-256 of the modules, one byte (0 or 1) per module, row-major, no quiet zone')},`,
  `  "segments": ${line('[mode, length in UTF-16 code units of the payload], in order')},`,
  '  "entries": [',
  entries.map((e) => `    ${line(e)}`).join(',\n'),
  '  ],',
  '  "matrices": [',
  matrices
    .map(({ rows, ...m }) => `    {\n      ${line(m).slice(1, -1)},\n      "rows": [\n${rows.map((r) => `        ${line(r)}`).join(',\n')}\n      ]\n    }`)
    .join(',\n'),
  '  ]',
  '}',
  '',
].join('\n');

writeFileSync(OUT, json);
console.log(`wrote ${entries.length} entries and ${matrices.length} matrices to ${OUT.slice(ROOT.length + 1)}`);
