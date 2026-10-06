import { describe, expect, it } from 'vitest';
import { escapeHtml } from './escape';

describe('escapeHtml', () => {
  it('neutralises markup in text content', () => {
    expect(escapeHtml('<img src=x onerror="alert(1)"> & more')).toBe(
      '&lt;img src=x onerror="alert(1)"&gt; &amp; more',
    );
  });

  it('escapes an existing entity again, so it shows literally', () => {
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });

  it('leaves plain text alone', () => {
    expect(escapeHtml('Weather report: Oslo +9(7) °C')).toBe('Weather report: Oslo +9(7) °C');
  });
});
