import { describe, expect, it } from 'vitest';
import { CANONICAL_ORIGIN, canonicalRedirect } from './hosts';

const redirect = (href: string) => canonicalRedirect(new URL(href));

describe('canonicalRedirect', () => {
  it.each([
    'https://vesen.app/',
    'https://vesenterminal.web.app/',
    'https://vesenterminal.firebaseapp.com/',
    'http://vesen.app/',
    'https://VESEN.app/',
    'https://vesen.app./',
  ])('moves %s to the canonical origin', (href) => {
    expect(redirect(href)).toBe(`${CANONICAL_ORIGIN}/`);
  });

  it('keeps the path, query and hash', () => {
    expect(redirect('https://vesenterminal.web.app/README.md?debug=1&env=ig-ios#top')).toBe(
      'https://www.vesen.app/README.md?debug=1&env=ig-ios#top',
    );
  });

  it.each([
    'https://www.vesen.app/',
    'https://www.vesen.app/?debug=1',
    'https://vesenterminal--pr12-overhaul-a1b2c3d4.web.app/',
    'https://vesenterminal--staging-x9y8z7.firebaseapp.com/',
    'http://localhost:3000/',
    'http://127.0.0.1:4173/',
    'https://example.com/',
    'https://evil-vesen.app/',
    'https://vesen.app.example.com/',
  ])('leaves %s alone', (href) => {
    expect(redirect(href)).toBeNull();
  });
});
