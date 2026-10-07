// qr: a QR code for a link or text, made in the browser by vesen's own encoder (src/lib/qr). On
// the terminal it is a card (ui/components/QrCard.svelte) with Present mode one tap away; into a
// pipe or a file it is text art. Its options follow qrencode's. It reads its words itself
// (rawArgs), so its errors can say what was meant; the flags here are for help and Tab.

import type { RawArgsSpec } from '../../shell/flags';
import { defineCommand, type CommandSpec, type EnumValue, type RunnerChoice } from '../../shell/types';

const levels = (): readonly EnumValue[] => [
  { value: 'L', summary: 'survives 7% damage' },
  { value: 'M', summary: 'survives 15% damage' },
  { value: 'Q', summary: 'survives 25% damage' },
  { value: 'H', summary: 'survives 30% damage' },
];

const types = (): readonly EnumValue[] => [
  { value: 'svg', summary: 'a card to scan (the default)' },
  { value: 'utf8', summary: 'half-block text art' },
  { value: 'utf8i', summary: 'text art, inverted' },
  { value: 'ascii', summary: '## for each dark module' },
];

const masks = (): readonly EnumValue[] => ['0', '1', '2', '3', '4', '5', '6', '7'].map((value) => ({ value }));

const spec: CommandSpec & RawArgsSpec & RunnerChoice = {
  name: 'qr',
  category: 'portfolio',
  summary: 'draw a QR code for a URL or text',
  synopsis: ['qr [OPTION]... [--] TEXT...'],
  rawArgs: true,
  flags: [
    {
      short: 'e',
      long: 'ec',
      value: { name: 'LEVEL', source: { kind: 'enum', values: levels, caseInsensitive: true } },
      description: 'error correction, L, M, Q or H; M unless set, raised for free when it fits',
    },
    { short: 'l', long: 'level', value: { name: 'LEVEL', source: { kind: 'enum', values: levels, caseInsensitive: true } }, description: 'the same as -e' },
    { short: 's', long: 'size', value: { name: 'N', source: { kind: 'free', placeholder: 'N|fit' } }, description: 'pixels per module, 1 to 32, or fit' },
    { short: 'm', long: 'margin', value: { name: 'N', source: { kind: 'free', placeholder: 'N' } }, description: 'the quiet zone in modules, 0 to 10; 4, or 2 for text' },
    { short: 't', long: 'type', value: { name: 'TYPE', source: { kind: 'enum', values: types, caseInsensitive: true } }, description: 'the style: svg, utf8, utf8i or ascii' },
    { short: 'v', long: 'symversion', value: { name: 'N', source: { kind: 'free', placeholder: 'N' } }, description: 'the smallest version to use, 1 to 40' },
    { long: 'mask', value: { name: 'N', source: { kind: 'enum', values: masks } }, description: 'use mask N, 0 to 7' },
    { short: '8', long: '8bit', description: 'encode every character as bytes' },
    { short: 'f', long: 'fullscreen', description: 'show the code full screen' },
    { long: 'text', description: 'encode exactly what you typed' },
    { long: 'url', description: 'read it as a link, adding https://' },
  ],
  args: [{ name: 'TEXT', source: { kind: 'examples' }, variadic: true }],
  examples: [
    { line: 'qr vesen.app', note: 'share this terminal', offline: true },
    { line: 'qr https://tldr.sh', offline: true },
    { line: 'qr explainshell.com', offline: true },
    { line: 'qr -e H mailto:has@salvesen.app', note: 'an email code that survives damage', offline: true },
    { line: 'qr -t utf8 hello', note: 'text art you can copy', offline: true },
    { line: 'qr -f vesen.app', note: 'full screen, to show a friend' },
  ],
  seeAlso: ['open', 'repo'],
  load: () => import('./qr.run'),
};

export default defineCommand(spec);
