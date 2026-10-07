// How the build names its stock Worker, and how the command reaches the client.
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { findBoundaryViolations } from '../../../scripts/check-boundaries.mjs';
import { getMarket, marketBackend, provideMarket, stockApiBase, type Market } from './port';

afterEach(() => provideMarket(null));

const fake = (): Market => ({
  backend: 'interim',
  quote: async () => ({ ok: false, error: { code: 'not_configured' } }),
  search: async () => ({ ok: true, hits: [], from: 'local' }),
  recent: () => [],
});

describe('stockApiBase', () => {
  it('takes an http or https base, without its trailing slash', () => {
    expect(stockApiBase('https://vesen-stock.example.workers.dev/')).toBe('https://vesen-stock.example.workers.dev');
    expect(stockApiBase(' https://api.vesen.app/stock ')).toBe('https://api.vesen.app/stock');
    expect(stockApiBase('http://localhost:8787')).toBe('http://localhost:8787');
  });

  it('treats unset, empty (an unset CI variable) and anything else as none', () => {
    for (const raw of [undefined, '', '   ', 'vesen-stock.workers.dev', 'javascript:alert(1)', 'https://a b', 'https://x.test?q=1']) {
      expect(stockApiBase(raw), String(raw)).toBeNull();
    }
  });

  it('chooses the interim proxy in a build without one, as the tests are', () => {
    expect(marketBackend()).toBe('interim');
  });

  it('is DOM-free, so command code may import it', () => {
    const source = readFileSync(new URL('./port.ts', import.meta.url), 'utf8');
    expect(findBoundaryViolations(source, 'src/services/market/port.ts')).toEqual([]);
  });
});

describe('the provider', () => {
  it('gives null until a client is provided, then the one client', async () => {
    expect(getMarket()).toBeNull();
    const load = vi.fn(async () => fake());
    provideMarket(load);
    const first = await getMarket();
    expect(await getMarket()).toBe(first);
    expect(load).toHaveBeenCalledTimes(1);
    provideMarket(null);
    expect(getMarket()).toBeNull();
  });

  it('tries a failed load again next time', async () => {
    const market = fake();
    const load = vi.fn().mockRejectedValueOnce(new Error('chunk')).mockResolvedValue(market);
    provideMarket(load);
    await expect(getMarket()).rejects.toThrow('chunk');
    expect(await getMarket()).toBe(market);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
