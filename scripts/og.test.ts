import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BANNER_ROWS } from '../src/commands/lib/banner';
import { bannerArt } from './og.mjs';

describe('bannerArt', () => {
  it('reads the five rows of the logo from the banner command, quotes and backslashes as they are drawn', () => {
    const art = bannerArt(readFileSync(new URL('../src/commands/lib/banner.ts', import.meta.url), 'utf8'));
    expect(art.split('\n')).toEqual([...BANNER_ROWS]);
    expect(art).toContain("`88..8'");
    expect(art).not.toMatch(/[<>]/);
  });
});
