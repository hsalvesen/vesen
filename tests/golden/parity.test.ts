// Legacy parity: every golden output, rendered through the sanitising legacy shim, reads the same,
// uses the same colours, and keeps the same elements, attributes and style declarations as the
// raw HTML the old renderer injected.
import { describe, expect, it } from 'vitest';
import { sanitizeLegacyHtml } from '../../src/ui/legacy-html';
import { parseHtmlTranscript } from './format';

const GOLDENS = import.meta.glob<string>('./__snapshots__/legacy/*/*.html', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/** Every transcript golden; rendered-session holds component markup, not command output. */
const files = Object.keys(GOLDENS)
  .filter((path) => !path.includes('/rendered-session/'))
  .sort();

/** What the old renderer put in the page: the browser's own parse of the raw string. */
function rawFragment(html: string): DocumentFragment {
  const template = document.createElement('template');
  template.innerHTML = html;
  return template.content;
}

const COLOUR = /var\(--(?:theme|role)-[a-z-]+\)|#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi;

/** Every colour token in the fragment's styles, plus the classes the stylesheet colours. */
function colours(root: ParentNode): string[] {
  const found = new Set<string>();
  for (const element of Array.from(root.querySelectorAll('[style], [class]'))) {
    for (const match of (element.getAttribute('style') ?? '').matchAll(COLOUR)) found.add(match[0].toLowerCase());
    for (const name of (element.getAttribute('class') ?? '').split(/\s+/)) if (name) found.add(`.${name}`);
  }
  return [...found].sort();
}

/** Each element as its tag and attribute names, in document order. An empty style is no style. */
function shape(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('*'), (element) => {
    const names = Array.from(element.attributes)
      .filter((a) => !(a.name === 'style' && a.value.trim() === ''))
      .map((a) => a.name)
      .sort();
    return [element.localName, ...names].join(' ');
  });
}

/** Style declarations as a sorted list, so the rebuilt attribute compares with the original. */
function declarations(root: ParentNode): string[] {
  return Array.from(root.querySelectorAll('[style]'), (element) =>
    (element.getAttribute('style') ?? '')
      .split(';')
      .map((d) => d.trim().replace(/\s*:\s*/, ': '))
      .filter(Boolean)
      .join('; '),
  ).filter(Boolean);
}

describe('legacy parity through the sanitiser', () => {
  it('covers every golden transcript', () => {
    // 20 cases the same at every width, plus 6 recorded at each of the three widths.
    expect(files.length).toBeGreaterThanOrEqual(38);
  });

  it.each(files)('%s keeps its text and colours', (file) => {
    const steps = parseHtmlTranscript(GOLDENS[file] ?? '');
    expect(steps.length).toBeGreaterThan(0);
    for (const { line, html } of steps) {
      const raw = rawFragment(html);
      const sanitised = sanitizeLegacyHtml(html);
      expect(sanitised.textContent, `text of "${line}"`).toBe(raw.textContent);
      expect(colours(sanitised), `colours of "${line}"`).toEqual(colours(raw));
      expect(shape(sanitised), `elements of "${line}"`).toEqual(shape(raw));
      expect(declarations(sanitised), `styles of "${line}"`).toEqual(declarations(raw));
    }
  });
});

describe('legacy text colours', () => {
  // The bright-black slot is under 4.5:1 on most themes' backgrounds. It may colour a swatch of
  // block glyphs, but dim text uses the muted role (.out-muted) instead.
  it.each(files)('%s draws no text in bright black', (file) => {
    for (const { line, html } of parseHtmlTranscript(GOLDENS[file] ?? '')) {
      const dim = Array.from(sanitizeLegacyHtml(html).querySelectorAll('[style*="--theme-bright-black"]'));
      const text = dim.map((element) => (element.textContent ?? '').replace(/[█\s]/g, '')).filter(Boolean);
      expect(text, `"${line}"`).toEqual([]);
    }
  });
});
