import { afterEach, describe, expect, it } from 'vitest';
import { markCurrentCathode, markCurrentTheme } from './legacy-highlights';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('legacy highlights', () => {
  it('moves the theme marker in every earlier listing and renames fastfetch’s theme', () => {
    document.body.innerHTML = `
      <span class="theme-name is-current" data-theme-name="swamphen">swamphen</span>
      <span class="theme-name" data-theme-name="cockatoo">cockatoo</span>
      <span class="current-theme-name">swamphen</span>`;
    markCurrentTheme(document, 'cockatoo');

    const current = [...document.querySelectorAll('.theme-name.is-current')].map((el) => el.textContent);
    expect(current).toEqual(['cockatoo']);
    expect(document.querySelector('.current-theme-name')?.textContent).toBe('cockatoo');
  });

  it('moves the CRT marker', () => {
    document.body.innerHTML = `
      <span class="cathode-name is-current" data-cathode-name="scanlines">scanlines</span>
      <span class="cathode-name" data-cathode-name="off">off</span>`;
    markCurrentCathode(document, 'off');
    const current = [...document.querySelectorAll('.cathode-name.is-current')].map((el) => el.textContent);
    expect(current).toEqual(['off']);
  });
});
