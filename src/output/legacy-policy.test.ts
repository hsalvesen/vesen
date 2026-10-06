import { describe, expect, it } from 'vitest';
import {
  LEGACY_CLASSES,
  filterLegacyClasses,
  filterLegacyStyle,
  isLegacyStyleProperty,
  legacyAttribute,
  legacyHref,
} from './legacy-policy';

describe('filterLegacyStyle', () => {
  it('keeps the declarations legacy output uses, rebuilt one per property', () => {
    expect(
      filterLegacyStyle('color: var(--theme-cyan); font-weight: bold;font-family: monospace ; margin-bottom: 8px'),
    ).toBe('color: var(--theme-cyan); font-weight: bold; font-family: monospace; margin-bottom: 8px');
    expect(filterLegacyStyle('position: relative; border-left: 4px solid var(--theme-purple); border-radius: 4px')).toBe(
      'position: relative; border-left: 4px solid var(--theme-purple); border-radius: 4px',
    );
    expect(filterLegacyStyle('position: absolute; inset: 0; background: var(--theme-cyan); opacity: 0.12')).toBe(
      'position: absolute; inset: 0; background: var(--theme-cyan); opacity: 0.12',
    );
    expect(filterLegacyStyle('color: #f69154; flex: 0 0 380px; max-width: calc(100% - 2px)')).toBe(
      'color: #f69154; flex: 0 0 380px; max-width: calc(100% - 2px)',
    );
  });

  it('lowercases property names and accepts every margin and padding side', () => {
    expect(filterLegacyStyle('COLOR: red; Margin-Top: 1px; padding-inline-start: 2px')).toBe(
      'color: red; margin-top: 1px; padding-inline-start: 2px',
    );
  });

  it.each([
    'background: url(https://example.com/x.png)',
    'background: URL( "javascript:alert(1)" )',
    'background-color: image-set("x.png" 1x)',
    'width: expression(alert(1))',
    'color: red\\;background:url(x)',
    'color: \\72 ed',
    'font-family: "a"',
    "font-family: 'a'",
    'color: red /* hidden */',
    'color: red !important',
    'color: <script>',
    'color: a{b}',
    'color: @import',
    'color: javascript:alert(1)',
    'color: element(#x)',
    'color: attr(title)',
    'position: fixed',
    'position: sticky',
    'behavior: url(x.htc)',
    '-moz-binding: url(x.xml#xss)',
    'z-index: 9999',
    'transform: scale(9)',
    'content: "x"',
    'top: 0',
  ])('drops %j', (style) => {
    expect(filterLegacyStyle(style)).toBe('');
  });

  it('keeps the safe declarations around a dropped one', () => {
    expect(filterLegacyStyle('color: red; background: url(x); font-weight: bold')).toBe('color: red; font-weight: bold');
  });

  it('cannot be split by a semicolon hidden in quotes or parentheses', () => {
    expect(filterLegacyStyle('font-family: "x;color: red"')).toBe('');
    expect(filterLegacyStyle('color: rgb(1;2;3)')).toBe('');
  });

  it('ignores declarations without a colon or a value', () => {
    expect(filterLegacyStyle('color; : red; color:; ;;')).toBe('');
  });
});

describe('isLegacyStyleProperty', () => {
  it('allows the inventory and nothing else', () => {
    for (const name of ['color', 'white-space', 'margin', 'padding-left', 'overflow-wrap', 'vertical-align']) {
      expect(isLegacyStyleProperty(name), name).toBe(true);
    }
    for (const name of ['top', 'z-index', 'background-image', 'margin-x', 'filter', 'cursor', 'pointer-events']) {
      expect(isLegacyStyleProperty(name), name).toBe(false);
    }
  });
});

describe('filterLegacyClasses', () => {
  it('keeps only the class names legacy output uses', () => {
    expect(filterLegacyClasses('theme-name is-current')).toBe('theme-name is-current');
    expect(filterLegacyClasses('  cathode-name  fixed inset-0 z-50 ')).toBe('cathode-name');
    expect(filterLegacyClasses('sr-only hidden')).toBe('');
    expect(filterLegacyClasses('art art-fit art-x')).toBe('art art-fit');
    expect([...LEGACY_CLASSES].sort()).toEqual(['art', 'art-fit', 'cathode-name', 'current-theme-name', 'is-current', 'theme-name']);
  });
});

describe('legacyHref', () => {
  it('keeps absolute http, https and mailto URLs only', () => {
    expect(legacyHref('https://github.com/hsalvesen/vesen')).toBe('https://github.com/hsalvesen/vesen');
    expect(legacyHref('mailto:has@salvesen.app')).toBe('mailto:has@salvesen.app');
    for (const href of ['javascript:alert(1)', ' javascript:alert(1)', 'data:text/html,x', '/relative', '//x.com', 'vbscript:x']) {
      expect(legacyHref(href), href).toBeNull();
    }
  });
});

describe('legacyAttribute', () => {
  it('passes style and class through their filters and drops what is left empty', () => {
    expect(legacyAttribute('style', 'color: red; top: 0')).toBe('color: red');
    expect(legacyAttribute('style', 'top: 0')).toBeNull();
    expect(legacyAttribute('class', 'theme-name evil')).toBe('theme-name');
    expect(legacyAttribute('class', 'evil')).toBeNull();
  });

  it('keeps the two data attributes with plain names', () => {
    expect(legacyAttribute('data-theme-name', 'swamphen')).toBe('swamphen');
    expect(legacyAttribute('data-cathode-name', 'vintage')).toBe('vintage');
    expect(legacyAttribute('data-theme-name', '"><img src=x onerror=alert(1)>')).toBeNull();
  });

  it('drops every other attribute', () => {
    for (const name of ['onclick', 'onerror', 'id', 'title', 'src', 'srcdoc', 'data-cmd', 'target', 'rel', 'href', 'formaction']) {
      expect(legacyAttribute(name, 'x'), name).toBeNull();
    }
  });
});
