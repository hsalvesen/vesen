import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bannerArt } from './og.mjs';

describe('bannerArt', () => {
  it('reads the six rows of the banner from the banner command, without its markup', () => {
    const art = bannerArt(readFileSync(new URL('../src/commands/lib/banner.ts', import.meta.url), 'utf8'));
    const rows = art.split('\n');
    expect(rows).toHaveLength(6);
    expect(rows[0]).toBe('██╗   ██╗███████╗███████╗███████╗███╗   ██╗');
    expect(art).not.toMatch(/[<>]/);
  });
});
