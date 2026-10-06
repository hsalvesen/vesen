import { describe, expect, it } from 'vitest';
import { colourRuns, htmlRuns, htmlToMarkup, readStyle } from './convert-content.mjs';

describe('convert-content', () => {
  it('turns theme spans into {colour} markup, and doubles a literal {', () => {
    expect(htmlToMarkup('Type <span style="color: var(--theme-cyan);">help</span> {now}')).toBe('Type {cyan}help{/} {{now}');
    expect(htmlToMarkup('<span style="color: var(--theme-bright-blue); font-weight: bold; font-size: 1em;">╔═╗</span>')).toBe(
      '{brightBlue,bold}╔═╗{/}',
    );
    expect(htmlToMarkup('a &lt;b&gt; &amp; c')).toBe('a <b> & c');
  });

  it('draws nested spans as the browser does, and ignores a stray </span>', () => {
    const html =
      '<span style="color: var(--theme-white);">later <span style="color: var(--theme-bright-cyan); font-weight: bold;">bash</span>, and</span> plain</span> end';
    expect(htmlRuns(html)).toEqual([
      { colour: 'white', bold: false, text: 'later ' },
      { colour: 'brightCyan', bold: true, text: 'bash' },
      { colour: 'white', bold: false, text: ', and' },
      { colour: null, bold: false, text: ' plain' },
      { colour: null, bold: false, text: ' end' },
    ]);
    expect(colourRuns(html)).toEqual([
      ['var(--theme-white)', false, 'later '],
      ['var(--theme-bright-cyan)', true, 'bash'],
      ['var(--theme-white)', false, ', and'],
      [null, false, ' plain end'],
    ]);
  });

  it('refuses anything the markup cannot say', () => {
    expect(() => readStyle('color: red')).toThrow('unsupported colour');
    expect(() => readStyle('text-decoration: underline')).toThrow('unsupported style');
    expect(() => htmlRuns('<b>bold</b>')).toThrow('unsupported tag');
  });
});
