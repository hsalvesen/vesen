import { afterEach, describe, expect, it } from 'vitest';
import { activeContent, xssCorpus } from '../../tests/support/xss';
import { LEGACY_TAGS } from '../output/legacy-policy';
import { legacyHtml, sanitizeLegacyHtml } from './legacy-html';

/** Sanitises into a live, attached element, the way the renderer does. */
function render(html: string): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  host.append(sanitizeLegacyHtml(html));
  return host;
}

afterEach(() => {
  document.body.replaceChildren();
  delete window.__x;
});

describe('sanitizeLegacyHtml: the XSS corpus', () => {
  it.each(xssCorpus())('plants nothing active: %s', async (payload) => {
    const host = render(payload);
    // Give any handler that slipped through a chance to run.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(activeContent(host)).toEqual([]);
    expect(window.__x).toBeUndefined();
    for (const element of Array.from(host.querySelectorAll('*'))) {
      expect(LEGACY_TAGS.has(element.localName), `<${element.localName}>`).toBe(true);
    }
  });

  it('keeps the visible text of a removed element, and drops script and style text', () => {
    expect(render('<h1>My <b>Portfolio</b></h1>').innerHTML).toBe('My <b>Portfolio</b>');
    expect(render('a<script>window.__x=1</script>b<style>p{}</style>c').textContent).toBe('abc');
  });

  it('reads markup the parser hides in raw text as text, never as elements', () => {
    const host = render('<noscript><p title="</noscript><img src=x onerror=window.__x=1>">');
    expect(host.querySelector('img')).toBeNull();
  });

  it('drops comments', () => {
    expect(render('a<!-- <img src=x onerror=window.__x=1> -->b').innerHTML).toBe('ab');
  });
});

describe('sanitizeLegacyHtml: what legacy output keeps', () => {
  it('keeps allowed tags, classes, data names and safe styles exactly', () => {
    const html =
      '<span class="theme-name is-current" data-theme-name="swamphen">swamphen</span>' +
      '<div style="position: relative; border-left: 4px solid var(--theme-cyan)"><br><pre>x</pre></div>';
    expect(render(html).innerHTML).toBe(
      '<span class="theme-name is-current" data-theme-name="swamphen">swamphen</span>' +
        '<div style="position: relative; border-left: 4px solid var(--theme-cyan)"><br><pre>x</pre></div>',
    );
  });

  it('opens http, https and mailto links in a new tab without an opener', () => {
    const link = render('<a href="https://github.com/hsalvesen/vesen" target="_self" rel="opener">repo</a>').querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://github.com/hsalvesen/vesen');
    expect(link?.getAttribute('target')).toBe('_blank');
    expect(link?.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('keeps a link with an unsafe href as plain text inside an inert <a>', () => {
    const link = render('<a href="javascript:window.__x=1">x</a>').querySelector('a');
    expect(link?.hasAttribute('href')).toBe(false);
    expect(link?.textContent).toBe('x');
  });

  it('keeps leading whitespace and every newline, as the old renderer did', () => {
    expect(render('\n  <span>a</span>\n\nb  ').innerHTML).toBe('\n  <span>a</span>\n\nb  ');
  });

  it('strips unknown classes and styles but keeps the element and its text', () => {
    expect(render('<span class="fixed inset-0" style="position: fixed; top: 0">x</span>').innerHTML).toBe('<span>x</span>');
  });

  it('flattens absurdly deep nesting into text instead of recursing without end', () => {
    const deep = '<span>'.repeat(500) + 'deep' + '</span>'.repeat(500);
    const host = render(deep);
    expect(host.textContent).toBe('deep');
    expect(host.querySelectorAll('span').length).toBeLessThanOrEqual(64);
  });
});

describe('use:legacyHtml', () => {
  it('renders the sanitised fragment and replaces it on update', () => {
    const node = document.createElement('div');
    const action = legacyHtml(node, '<b onclick="window.__x=1">one</b>');
    expect(node.innerHTML).toBe('<b>one</b>');
    if (!action || !action.update) throw new Error('legacyHtml must be updatable');
    action.update('<i>two</i>');
    expect(node.innerHTML).toBe('<i>two</i>');
  });
});
