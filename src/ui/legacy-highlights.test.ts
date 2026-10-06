// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { markCurrentThemeName } from './legacy-highlights';

describe('the legacy fastfetch theme name', () => {
  it('follows the theme in every earlier listing', () => {
    document.body.innerHTML = '<span class="current-theme-name">swamphen</span><span class="current-theme-name">swamphen</span>';
    markCurrentThemeName(document, 'cockatoo');
    expect([...document.querySelectorAll('.current-theme-name')].map((el) => el.textContent)).toEqual(['cockatoo', 'cockatoo']);
  });
});
