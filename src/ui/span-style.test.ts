import { describe, expect, it } from 'vitest';
import { PALETTE, ROLES } from '../output/model';
import { ROLE_FALLBACK, cssColour, spanClasses, spanCss } from './span-style';

describe('cssColour', () => {
  it('reads palette colours from --theme-*', () => {
    expect(cssColour('brightBlue')).toBe('var(--theme-bright-blue)');
  });

  it('reads roles from --role-* with a palette fallback for every role', () => {
    expect(cssColour('error')).toBe('var(--role-error, var(--theme-red))');
    for (const role of ROLES) {
      expect(PALETTE).toContain(ROLE_FALLBACK[role]);
      expect(cssColour(role)).toMatch(new RegExp(`^var\\(--role-${role}, var\\(--theme-[a-z-]+\\)\\)$`));
    }
  });
});

describe('spanClasses and spanCss', () => {
  it('map text attributes to classes and colours to declarations', () => {
    expect(spanClasses({ bold: true, italic: true, strike: true })).toBe('b i s');
    expect(spanClasses(undefined)).toBe('');
    expect(spanCss({ fg: 'cyan', bg: 'black' })).toBe('color: var(--theme-cyan); background-color: var(--theme-black)');
    expect(spanCss({ bold: true })).toBeUndefined();
    expect(spanCss(undefined)).toBeUndefined();
  });

  it('swaps colours for inverse, defaulting to the theme foreground and background', () => {
    expect(spanCss({ inverse: true })).toBe('color: var(--theme-background); background-color: var(--theme-foreground)');
    expect(spanCss({ fg: 'ok', inverse: true })).toBe(
      'color: var(--theme-background); background-color: var(--role-ok, var(--theme-green))',
    );
  });
});
