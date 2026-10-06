// cathode: trial a CRT (cathode ray tube) effect, and choose how much of it the device draws.
// The mode is the look; the quality (auto, full, lite or off) overrides the tier the device would
// get, and `cathode ls` says which tier is in force and why. The current mode's marker is live,
// so it moves in every earlier listing (F030).

import { defineCommand, type ArgSpec, type EnumValue, type ValueContext } from '../../shell/types';

function modeValues(context?: ValueContext): readonly EnumValue[] {
  return (context?.appearance?.cathodeModes() ?? []).map((mode) => ({ value: mode.name, summary: mode.summary }));
}

function qualityValues(context?: ValueContext): readonly EnumValue[] {
  return (context?.appearance?.cathodeQualities() ?? []).map((value) => ({ value }));
}

const MODE: ArgSpec = { name: 'VARIATION', source: { kind: 'enum', values: modeValues, caseInsensitive: true } };

export default defineCommand({
  name: 'cathode',
  category: 'portfolio',
  summary: 'trial a retro CRT display effect',
  synopsis: ['cathode ls', 'cathode set VARIATION', 'cathode VARIATION', 'cathode off', 'cathode quality [QUALITY]'],
  description:
    "Draws the terminal as a cathode ray tube would: scanlines, phosphor glow, flicker. 'cathode ls' lists the variations and the quality in force. The quality, auto unless you choose, is how much of the effect the device draws: full on a desktop, lite on phones and in-app browsers, off when the system asks for less motion or more contrast.",
  subcommands: {
    ls: { summary: 'list the variations, and the quality in force' },
    set: { summary: 'turn on the effect VARIATION', args: [MODE] },
    off: { summary: 'turn the effect off' },
    quality: {
      summary: 'choose how much of the effect to draw: auto, full, lite or off',
      args: [{ name: 'QUALITY', source: { kind: 'enum', values: qualityValues, caseInsensitive: true }, optional: true }],
    },
  },
  args: [{ ...MODE, optional: true }],
  examples: [
    { line: 'cathode ls', offline: true },
    { line: 'cathode set vintage', note: 'the full retro set', offline: true },
    { line: 'cathode quality lite', note: 'a lighter effect', offline: true },
    { line: 'cathode off', offline: true },
  ],
  seeAlso: ['theme'],
  load: () => import('./cathode.run'),
});
