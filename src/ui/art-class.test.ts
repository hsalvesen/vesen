// Which line height each kind of art gets: block art's rows touch, glyph art keeps the
// terminal's line height.
import { describe, expect, it } from 'vitest';
import { BANNER_ART, BANNER_ART_COMPACT } from '../commands/lib/banner';
import { INK } from '../commands/lib/block-font';
import { COWS } from '../commands/lib/cows';
import { trainFrame } from '../commands/lib/train';
import { logoFor } from '../commands/system/fastfetch.logos';
import { artClass } from './art-class';

describe('artClass', () => {
  it('draws art made of block elements with its rows touching', () => {
    expect(artClass('██\n██')).toBe('art-block');
    expect(artClass(BANNER_ART)).toBe('art-block');
    expect(artClass(BANNER_ART_COMPACT)).toBe('art-block');
    // figlet's ink, and a text-mode QR code's half blocks.
    expect(artClass(` ${INK}${INK} \n${INK}  ${INK}`)).toBe('art-block');
    expect(artClass('▀▄▀▄\n▄▀▄▀')).toBe('art-block');
    // The quadrants and shades too.
    expect(artClass('▗▟▙▖\n▝▜▛▘')).toBe('art-block');
    expect(artClass('░▒▓')).toBe('art-block');
  });

  it('draws box-drawing and braille art with its rows touching', () => {
    expect(artClass('├── a\n└── b')).toBe('art-block');
    expect(artClass('┌─┐\n│ │\n└─┘')).toBe('art-block');
    expect(artClass('⠋⠙⠹')).toBe('art-block');
  });

  it('draws art made of letters and punctuation at the terminal line height', () => {
    expect(artClass(' /\\_/\\\n( o.o )\n > ^ <')).toBe('art-glyph');
    for (const cow of COWS) expect(artClass(cow.art), cow.name).toBe('art-glyph');
    expect(artClass(trainFrame(0))).toBe('art-glyph');
    expect(artClass('')).toBe('art-glyph');
    // Geometric shapes and arrows alone are glyphs of text, not cells of a block.
    expect(artClass('● ○ ◆ → ↑')).toBe('art-glyph');
  });

  it('draws every fastfetch logo as block art', () => {
    for (const os of ['macOS', 'iOS', 'Android', 'Windows', 'Linux', 'unknown']) {
      expect(artClass(logoFor(os).art), os).toBe('art-block');
    }
  });
});
