import { get, writable } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAppearance } from './appearance';
import { createBell } from './bell';
import { createClock } from './clock';
import { createNet, NetError } from './net';
import { createSysInfo } from './sysinfo';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('clock', () => {
  it('reads the injected time and randomness, and remembers when it booted', () => {
    let now = 100;
    const clock = createClock({ now: () => now, random: () => 0.25, timeZone: 'Australia/Sydney' });
    now = 200;
    expect(clock.now()).toBe(200);
    expect(clock.bootTime()).toBe(100);
    expect(clock.random()).toBe(0.25);
    expect(clock.timeZone()).toBe('Australia/Sydney');
  });

  it('sleeps until the time is up, or rejects as soon as the signal aborts', async () => {
    vi.useFakeTimers();
    const clock = createClock();
    const slept = clock.sleep(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(slept).resolves.toBeUndefined();

    const controller = new AbortController();
    const cut = clock.sleep(1000, controller.signal);
    controller.abort('stop');
    await expect(cut).rejects.toBe('stop');
    await expect(clock.sleep(1, controller.signal)).rejects.toBe('stop');
  });
});

describe('bell', () => {
  it('plays the sound, or flashes when the sound is off', () => {
    const play = vi.fn();
    let audible = true;
    const bell = createBell({ play, audible: () => audible });
    const flashes = vi.fn();
    const stop = bell.onFlash(flashes);
    bell.ring();
    audible = false;
    bell.ring();
    stop();
    bell.ring();
    expect(play).toHaveBeenCalledTimes(1);
    expect(flashes).toHaveBeenCalledTimes(1);
  });
});

describe('appearance', () => {
  const palette = (base: string) => ({
    foreground: '#ffffff', red: '#ff0000', green: '#00ff00', yellow: '#ffff00', blue: '#0000ff', purple: '#ff00ff', cyan: '#00ffff',
    brightBlack: base,
  });
  const themes = [
    { name: 'swamphen', background: '#222235', ...palette('#555555') },
    { name: 'Wombat', background: '#1c1814', ...palette('#666666'), foreground: '#e6ddd4' },
  ];
  const first = themes[0] ?? themes[1];
  const make = () => {
    if (first === undefined) throw new Error('no themes');
    const theme = writable(first);
    const cathode = writable<'off' | 'vintage'>('off');
    const cathodeQuality = writable<'auto' | 'full' | 'lite' | 'off'>('auto');
    const crtTier = writable({ tier: 'full', reason: 'a desktop', quality: 'auto' });
    const appearance = createAppearance({
      theme,
      themes,
      defaultTheme: first,
      cathode,
      cathodeModes: [
        { name: 'off', summary: 'none' },
        { name: 'vintage', summary: 'all of it' },
      ],
      cathodeQuality,
      cathodeQualities: ['auto', 'full', 'lite', 'off'],
      crtTier,
    });
    return { theme, cathode, cathodeQuality, crtTier, appearance };
  };

  it('reads and sets the key bar, which a hardware keyboard hides under auto', () => {
    const { appearance } = make();
    // Without the stores, the bar is auto and cannot be changed.
    expect(appearance.keyBar()).toEqual({ mode: 'auto', hardware: false, shown: true });
    expect(appearance.setKeyBar('on')).toBe(false);

    const keyBar = writable<'auto' | 'on' | 'off'>('auto');
    const hardwareKeyboard = writable(false);
    const first = themes[0];
    if (first === undefined) throw new Error('no themes');
    const keys = createAppearance({
      theme: writable(first),
      themes,
      defaultTheme: first,
      cathode: writable('off'),
      cathodeModes: [{ name: 'off', summary: 'none' }],
      keyBar,
      keyBarModes: ['auto', 'on', 'off'],
      hardwareKeyboard,
    });
    expect(keys.keyBarModes()).toEqual(['auto', 'on', 'off']);
    hardwareKeyboard.set(true);
    expect(keys.keyBar()).toEqual({ mode: 'auto', hardware: true, shown: false });
    expect(keys.setKeyBar(' ON ')).toBe(true);
    expect(get(keyBar)).toBe('on');
    expect(keys.keyBar()).toEqual({ mode: 'on', hardware: true, shown: true });
    expect(keys.setKeyBar('sometimes')).toBe(false);
    expect(keys.setKeyBar('off')).toBe(true);
    expect(keys.keyBar().shown).toBe(false);
  });

  it('sets the theme by name, ignoring case', () => {
    const { theme, appearance } = make();
    expect(appearance.setTheme('WOMBAT')).toBe(true);
    expect(get(theme).name).toBe('Wombat');
    expect(appearance.currentTheme()).toBe('Wombat');
    expect(appearance.setTheme('nope')).toBe(false);
    expect(appearance.themes().map(({ name, background, foreground }) => ({ name, background, foreground }))).toEqual([
      { name: 'swamphen', background: '#222235', foreground: '#ffffff' },
      { name: 'Wombat', background: '#1c1814', foreground: '#e6ddd4' },
    ]);
  });

  it("lists each theme's eight swatch colours, in terminal order", () => {
    const { appearance } = make();
    expect(appearance.themes()[1]?.swatches).toEqual(['#e6ddd4', '#ff0000', '#00ff00', '#ffff00', '#0000ff', '#ff00ff', '#00ffff', '#666666']);
  });

  it('sets the CRT mode, and reset restores only the theme', () => {
    const { cathode, appearance } = make();
    expect(appearance.setCathode('VINTAGE')).toBe(true);
    expect(appearance.setCathode('neon')).toBe(false);
    appearance.setTheme('wombat');
    appearance.resetDefaults();
    expect(appearance.currentTheme()).toBe('swamphen');
    expect(get(cathode)).toBe('vintage');
    expect(appearance.cathodeModes().map((mode) => mode.name)).toEqual(['off', 'vintage']);
    expect(appearance.currentCathode()).toBe('vintage');
  });

  it('sets the CRT quality, ignoring case, and reports the tier in force', () => {
    const { cathodeQuality, crtTier, appearance } = make();
    expect(appearance.cathodeQualities()).toEqual(['auto', 'full', 'lite', 'off']);
    expect(appearance.setCathodeQuality('LITE')).toBe(true);
    expect(get(cathodeQuality)).toBe('lite');
    expect(appearance.setCathodeQuality('ultra')).toBe(false);
    crtTier.set({ tier: 'lite', reason: 'set with cathode quality lite', quality: 'lite' });
    expect(appearance.cathodeTier()).toEqual({ tier: 'lite', reason: 'set with cathode quality lite', quality: 'lite' });
  });
});

describe('sysinfo', () => {
  it('reports the cheap facts, and nothing it has no way to probe', async () => {
    const sys = createSysInfo({
      navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X)', languages: ['en-AU'], hardwareConcurrency: 6, deviceMemory: 4 },
      screen: { width: 390, height: 844, colorDepth: 24 },
      devicePixelRatio: 3,
    });
    expect(sys.snapshot()).toMatchObject({ device: { class: 'phone' }, cores: 6, memoryGB: 4, languages: ['en-AU'], screen: { pixelRatio: 3 } });
    expect(createSysInfo(null).snapshot().device.class).toBe('desktop');
    expect(sys.gpu()).toBeNull();
    expect(await createSysInfo(null).publicIp()).toBeNull();
  });
});

describe('createNet', () => {
  it('reads text with the status, lower-case headers and the time taken', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('hello', { status: 200, headers: { 'X-Thing': 'yes' } })));
    const net = createNet();
    const response = await net.text('https://example.com/');
    expect(response).toMatchObject({ status: 200, body: 'hello', headers: { 'x-thing': 'yes' } });
    expect(response.ms).toBeGreaterThanOrEqual(0);
    expect(net.online()).toBe(true);
  });

  it('parses JSON, and a failed check is a parse error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"n":1}')));
    const net = createNet();
    expect(await net.json('https://example.com/')).toEqual({ n: 1 });
    const failed = net.json('https://example.com/', {
      parse: () => {
        throw new Error('bad');
      },
    });
    await expect(failed).rejects.toMatchObject({ kind: 'parse', host: 'example.com' });
  });

  it('times out after 8 s by default, as a NetError the shell can word', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const net = createNet();
    const request = net.text('https://example.com/');
    const caught = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(8000);
    const error = await caught;
    expect(net.isError(error)).toBe(true);
    expect(error).toBeInstanceOf(NetError);
    expect(error).toMatchObject({ kind: 'timeout', timeoutMs: 8000 });
  });

  it('shares one request per key through memo', async () => {
    const net = createNet();
    const load = vi.fn(async () => 42);
    expect(await Promise.all([net.memo('k', 1000, load), net.memo('k', 1000, load)])).toEqual([42, 42]);
    expect(load).toHaveBeenCalledTimes(1);
  });
});
