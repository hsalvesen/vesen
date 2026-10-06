// The small modules: origins, rate limits, the cache, downsampling, config and time zones.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TtlCache, quoteLifetime } from '../src/cache';
import { DEFAULT_USER_AGENT, configFromEnv, providerOrder } from '../src/config';
import { corsHeaders, originPattern, originPolicy } from '../src/cors';
import { downsample, type Point } from '../src/downsample';
import { TokenBucketLimiter, rateLimitKey } from '../src/ratelimit';
import { zoneAbbreviation, zonedTimeToEpoch } from '../src/time';

describe('origins', () => {
  const policy = configFromEnv({}).origins;

  it('allows vesen.app, its preview channels and localhost on any port', () => {
    for (const origin of [
      'https://www.vesen.app',
      'https://vesen.app',
      'https://vesenterminal--pr12-a1b2c3.web.app',
      'http://localhost:3000',
      'http://localhost:4173',
      'http://localhost',
      'http://127.0.0.1:8787',
    ]) {
      expect(policy.classify(origin), origin).toBe('allowed');
    }
  });

  it('denies look-alikes, other schemes and the opaque origin', () => {
    for (const origin of [
      'https://evil.example',
      'https://vesen.app.evil.com',
      'https://www.vesen.app.evil.com',
      'http://www.vesen.app',
      'https://evilvesen.app',
      'https://vesenterminal--x.web.app.evil.com',
      'https://vesenterminal--a.b.web.app',
      'https://notvesenterminal--x.web.app',
      'http://localhost.evil.com',
      'http://localhost:3000.evil.com',
      'null',
      '',
    ]) {
      expect(policy.classify(origin), origin).toBe('denied');
    }
  });

  it('treats a request with no Origin as anonymous', () => {
    expect(policy.classify(null)).toBe('anonymous');
  });

  it('builds anchored patterns from globs', () => {
    expect(originPattern('https://vesenterminal--*.web.app').source).toBe('^https:\\/\\/vesenterminal--[a-z0-9-]+\\.web\\.app$');
    expect(originPolicy(' https://a.example/ , ').classify('https://a.example')).toBe('allowed');
  });

  it('echoes allowed and denied origins but never invents one', () => {
    expect(corsHeaders('https://www.vesen.app', 'allowed')).toMatchObject({ 'Access-Control-Allow-Origin': 'https://www.vesen.app', Vary: 'Origin' });
    expect(corsHeaders('https://evil.example', 'denied')['Access-Control-Allow-Origin']).toBe('https://evil.example');
    expect(corsHeaders(null, 'anonymous')['Access-Control-Allow-Origin']).toBeUndefined();
    expect(corsHeaders('null', 'denied')['Access-Control-Allow-Origin']).toBeUndefined();
  });
});

describe('config', () => {
  it('defaults to Yahoo then Cboe, adding Finnhub only with a key', () => {
    expect(configFromEnv({}).providers).toEqual(['yahoo', 'cboe']);
    expect(configFromEnv({ FINNHUB_KEY: 'k' }).providers).toEqual(['yahoo', 'cboe', 'finnhub']);
    expect(providerOrder('cboe, yahoo, nasdaq, cboe', false)).toEqual(['cboe', 'yahoo']);
    expect(providerOrder('finnhub,yahoo', false)).toEqual(['yahoo']);
    expect(providerOrder('', true)).toEqual(['yahoo', 'cboe', 'finnhub']);
  });

  it('keeps the vesen User-Agent unless a printable one is configured', () => {
    expect(configFromEnv({}).userAgent).toBe(DEFAULT_USER_AGENT);
    expect(configFromEnv({ UPSTREAM_UA: 'bad\nagent' }).userAgent).toBe(DEFAULT_USER_AGENT);
    expect(configFromEnv({ UPSTREAM_UA: 'Mozilla/5.0 (test)' }).userAgent).toBe('Mozilla/5.0 (test)');
  });
});

describe('TokenBucketLimiter', () => {
  it('allows a burst of 30 a minute, then says when to retry', () => {
    const limiter = new TokenBucketLimiter({ capacity: 30, periodSec: 60 });
    for (let i = 0; i < 30; i += 1) expect(limiter.take('ip', 0).ok).toBe(true);
    expect(limiter.take('ip', 0)).toEqual({ ok: false, retryAfterSec: 2 });
    // One token refills every 2 s.
    expect(limiter.take('ip', 2000).ok).toBe(true);
    expect(limiter.take('ip', 2000).ok).toBe(false);
    expect(limiter.take('other', 0).ok).toBe(true);
  });

  it('counts an IPv4 address as itself', () => {
    expect(rateLimitKey('198.51.100.7')).toBe('198.51.100.7');
    expect(rateLimitKey('unknown')).toBe('unknown');
  });

  it('counts an IPv6 address by its /64, however it is written', () => {
    const key = '2001:db8:85a3:12::/64';
    for (const ip of [
      '2001:db8:85a3:12::1',
      '2001:0DB8:85A3:0012:ffff:ffff:ffff:fffe',
      '2001:db8:85a3:12:0:0:0:0',
      '2001:db8:85a3:12:abcd::',
      '2001:db8:85a3:12::1%eth0',
    ]) {
      expect(rateLimitKey(ip), ip).toBe(key);
    }
    expect(rateLimitKey('2001:db8:85a3:13::1')).toBe('2001:db8:85a3:13::/64');
    expect(rateLimitKey('::1')).toBe('0:0:0:0::/64');
    expect(rateLimitKey('fe80::1:2:3:4')).toBe('fe80:0:0:0::/64');
  });

  it('counts an IPv4-mapped IPv6 address as its IPv4 address', () => {
    expect(rateLimitKey('::ffff:198.51.100.7')).toBe('198.51.100.7');
    expect(rateLimitKey('::ffff:c633:6407')).toBe('198.51.100.7');
  });

  it('keeps a value that is not an address as it is', () => {
    for (const ip of ['1::2::3', '2001:db8::1::', '2001:db8:0:0:0:0:0:0:1', 'g::1', '::ffff:300.1.1.1', '1:2:3:4:5:6:7']) {
      expect(rateLimitKey(ip), ip).toBe(ip);
    }
  });

  it('forgets the least recently used keys beyond its limit', () => {
    const limiter = new TokenBucketLimiter({ capacity: 1, periodSec: 60, maxKeys: 2 });
    limiter.take('a', 0);
    limiter.take('b', 0);
    limiter.take('c', 0);
    expect(limiter.size).toBe(2);
    // "a" was dropped, so it starts with a full bucket again.
    expect(limiter.take('a', 0).ok).toBe(true);
  });
});

describe('TtlCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T03:30:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('serves fresh, then stale, then nothing', () => {
    const cache = new TtlCache<string>();
    cache.set('k', 'v', Date.now(), { freshMs: 60_000, staleMs: 86_400_000 });
    expect(cache.get('k', Date.now())).toMatchObject({ value: 'v', fresh: true });
    vi.advanceTimersByTime(61_000);
    expect(cache.get('k', Date.now())).toMatchObject({ value: 'v', fresh: false });
    vi.advanceTimersByTime(86_400_000);
    expect(cache.get('k', Date.now())).toBeNull();
    expect(cache.size).toBe(0);
  });

  it('evicts the least recently used entry', () => {
    const cache = new TtlCache<number>(2);
    const life = { freshMs: 1000, staleMs: 1000 };
    cache.set('a', 1, Date.now(), life);
    cache.set('b', 2, Date.now(), life);
    cache.get('a', Date.now());
    cache.set('c', 3, Date.now(), life);
    expect(cache.get('b', Date.now())).toBeNull();
    expect(cache.get('a', Date.now())?.value).toBe(1);
  });

  it('runs one load for concurrent callers and a new one afterwards', async () => {
    const cache = new TtlCache<number>();
    let loads = 0;
    const load = async (): Promise<number> => {
      loads += 1;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return loads;
    };
    const both = Promise.all([cache.coalesce('k', load), cache.coalesce('k', load)]);
    await vi.advanceTimersByTimeAsync(100);
    expect(await both).toEqual([1, 1]);
    const again = cache.coalesce('k', load);
    await vi.advanceTimersByTimeAsync(100);
    expect(await again).toBe(2);
  });

  it('keeps quotes 60 s while a market moves and 300 s otherwise, stale for a day', () => {
    expect(quoteLifetime('open')).toEqual({ freshMs: 60_000, staleMs: 86_400_000 });
    expect(quoteLifetime('always_open').freshMs).toBe(60_000);
    expect(quoteLifetime('closed').freshMs).toBe(300_000);
    expect(quoteLifetime('pre').freshMs).toBe(300_000);
    expect(quoteLifetime('post').freshMs).toBe(300_000);
  });
});

describe('downsample', () => {
  const wave: Point[] = Array.from({ length: 500 }, (_, i) => [i * 60, Math.sin(i / 20) * 10 + (i === 250 ? 50 : 0)]);

  it('keeps short series as they are', () => {
    expect(downsample(wave.slice(0, 50), 120)).toEqual(wave.slice(0, 50));
  });

  it('keeps the first and last points and the spikes, in order', () => {
    const sampled = downsample(wave, 120);
    expect(sampled).toHaveLength(120);
    expect(sampled[0]).toEqual(wave[0]);
    expect(sampled[119]).toEqual(wave[499]);
    expect(sampled).toContainEqual(wave[250]);
    for (let i = 1; i < sampled.length; i += 1) expect((sampled[i] as Point)[0]).toBeGreaterThan((sampled[i - 1] as Point)[0]);
  });
});

describe('time zones', () => {
  it('converts New York wall times on both sides of a daylight-saving change', () => {
    expect(zonedTimeToEpoch('2026-10-05T15:59:59', 'America/New_York')).toBe(Date.UTC(2026, 9, 5, 19, 59, 59) / 1000);
    expect(zonedTimeToEpoch('2026-12-01 09:30:00', 'America/New_York')).toBe(Date.UTC(2026, 11, 1, 14, 30, 0) / 1000);
    expect(zonedTimeToEpoch('yesterday', 'America/New_York')).toBeNull();
    expect(zonedTimeToEpoch('2026-10-05T15:59:59', 'Not/A_Zone')).toBeNull();
  });

  it('names US zones and gives up on GMT offsets', () => {
    expect(zoneAbbreviation('America/New_York', 1_791_230_400)).toBe('EDT');
    expect(zoneAbbreviation('America/New_York', Date.UTC(2026, 11, 1) / 1000)).toBe('EST');
    expect(zoneAbbreviation('Not/A_Zone', 0)).toBeNull();
  });
});
