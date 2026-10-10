// Which line height a piece of art is drawn at (styles/terminal.css). Art drawn with box-drawing
// and block characters, or braille, is made of cells that must touch, so its rows are drawn at
// line height 1 and a block in one row meets the block below it. Art drawn with letters and
// punctuation (cowsay's animals, sl's train) is text: at line height 1 its rows look squashed, so
// it keeps the terminal's line height.

/** Box drawing (U+2500–257F), block elements (U+2580–259F) and braille (U+2800–28FF). */
const CELL_ART = /[─-▟⠀-⣿]/;

export type ArtClass = 'art-block' | 'art-glyph';

/** `art-block` for art whose rows must touch, `art-glyph` for art drawn with the glyphs of text. */
export function artClass(text: string): ArtClass {
  return CELL_ART.test(text) ? 'art-block' : 'art-glyph';
}
