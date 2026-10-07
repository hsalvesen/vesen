// The one SysInfo (F041): what four kinds of device tell a page, read once, with the GPU probed
// once and its context let go, the client hints asked once, and the public IP asked only when
// a command asks, through a mocked fetch.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ANDROID_PHONE, APPLE_SILICON_MAC, IPHONE_SAFARI, WINDOWS_PC } from '../../tests/support/systems';
import { memo } from './net';
import { createSysInfo } from './sysinfo';

afterEach(() => {
  vi.unstubAllGlobals();
  memo.clear();
});

describe('createSysInfo', () => {
  it('reads an Apple-silicon Mac: arm64 from its GPU, whatever the user agent says', async () => {
    const mac = APPLE_SILICON_MAC();
    const sys = createSysInfo(mac.host);
    expect(sys.snapshot()).toMatchObject({
      os: { name: 'macOS', version: null, arch: 'arm64' },
      browser: { name: 'Chrome', version: '141.0.0.0' },
      device: { class: 'desktop', model: null },
      cores: 8,
      memoryGB: 8,
      screen: { width: 1470, height: 956, pixelRatio: 2 },
      languages: ['en-AU', 'en'],
    });
    expect(sys.gpu()).toBe('ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)');
    expect(await sys.platform()).toEqual({ platformVersion: '15.6.1', architecture: 'arm', bitness: '64', model: null });
    expect(await sys.battery()).toEqual({ level: 0.5, charging: false });
    expect(await sys.storage()).toEqual({ usage: 2 * 1024 ** 2, quota: 100 * 1024 ** 3 });
    expect(sys.uptimeMs()).toBe(90_000);
  });

  it('probes the GPU once, and lets the WebGL context go at once', () => {
    const mac = APPLE_SILICON_MAC();
    const sys = createSysInfo(mac.host);
    sys.snapshot();
    sys.gpu();
    sys.gpu();
    expect(mac.contexts.count).toBe(1);
    expect(mac.lost.count).toBe(1);
  });

  it('reads a Windows PC, with its GPU and the client hints', async () => {
    const sys = createSysInfo(WINDOWS_PC().host);
    expect(sys.snapshot()).toMatchObject({ os: { name: 'Windows', version: null, arch: 'x86_64' }, device: { class: 'desktop' }, cores: 16 });
    expect(sys.gpu()).toContain('NVIDIA GeForce RTX 3080');
    expect((await sys.platform())?.platformVersion).toBe('15.0.0');
    expect(sys.connection()).toEqual({ saveData: false, cellular: false });
  });

  it("reads an Android phone in Chrome, whose user agent hides the version and the model", async () => {
    const sys = createSysInfo(ANDROID_PHONE().host);
    expect(sys.snapshot()).toMatchObject({ os: { name: 'Android', version: null }, device: { class: 'phone', model: null }, memoryGB: 4 });
    expect(await sys.platform()).toMatchObject({ platformVersion: '14.0.0', model: 'Pixel 7', architecture: null });
    expect(sys.connection()).toEqual({ saveData: false, cellular: true });
    expect(await sys.battery()).toBeNull();
    expect(await sys.storage()).toBeNull();
  });

  it("reads an iPhone in Safari 26, whose user agent says iOS 18.6 whatever the system", async () => {
    const sys = createSysInfo(IPHONE_SAFARI().host);
    expect(sys.snapshot()).toMatchObject({
      os: { name: 'iOS', version: '26.0', arch: 'arm64' },
      browser: { name: 'Safari', version: '26.0' },
      device: { class: 'phone' },
      memoryGB: null,
    });
    expect(sys.gpu()).toBe('Apple GPU');
    expect(await sys.platform()).toBeNull();
    expect(sys.connection()).toEqual({ saveData: true, cellular: false });
  });

  it('reads the facts once: the snapshot is the same object every time', () => {
    const sys = createSysInfo(WINDOWS_PC().host);
    expect(sys.snapshot()).toBe(sys.snapshot());
  });

  it('asks api.ipify.org for the public IP only when asked, once a session', async () => {
    const fetchMock = vi.fn(async (_url: string) => Response.json({ ip: '203.0.113.7' }));
    vi.stubGlobal('fetch', fetchMock);
    const sys = createSysInfo(WINDOWS_PC().host);
    sys.snapshot();
    await sys.platform();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await sys.publicIp()).toBe('203.0.113.7');
    expect(await sys.publicIp()).toBe('203.0.113.7');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('https://api.ipify.org?format=json');
  });

  it('gives no public IP when the lookup fails, and passes ^C on', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    expect(await createSysInfo(WINDOWS_PC().host).publicIp()).toBeNull();
    memo.clear();
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    const stop = new AbortController();
    const asked = createSysInfo(WINDOWS_PC().host).publicIp(stop.signal);
    stop.abort();
    await expect(asked).rejects.toMatchObject({ kind: 'abort' });
  });

  it('knows nothing without a page', async () => {
    const sys = createSysInfo(null);
    expect(sys.snapshot().os.name).toBe('unknown');
    expect(sys.gpu()).toBeNull();
    expect(await sys.platform()).toBeNull();
    expect(await sys.publicIp()).toBeNull();
    expect(sys.connection()).toEqual({ saveData: false, cellular: false });
    expect(sys.uptimeMs()).toBe(0);
  });
});
