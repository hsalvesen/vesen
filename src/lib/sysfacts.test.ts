import { describe, expect, it } from 'vitest';
import { appleChip, macArch, readUserAgent } from './sysfacts';
import { darwinRelease, gpuName, macModel, macosName, windowsRelease } from './sysnames';

describe('readUserAgent', () => {
  it('leaves frozen versions unknown: macOS 10.15.7 and Chrome on Android', () => {
    const mac = readUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15');
    expect(mac).toEqual({ os: { name: 'macOS', version: null, arch: null }, browser: { name: 'Safari', version: '18.6' }, device: { class: 'desktop', model: null } });
    expect(readUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_14_6)').os.version).toBe('10.14.6');
    const android = readUserAgent('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36');
    expect(android).toMatchObject({ os: { name: 'Android', version: null }, device: { class: 'phone', model: null } });
  });

  it('reads the version and model an older Android user agent gives', () => {
    const facts = readUserAgent('Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 Chrome/116.0 Mobile Safari/537.36');
    expect(facts).toMatchObject({ os: { name: 'Android', version: '13' }, device: { model: 'Pixel 7' } });
    expect(readUserAgent('Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0')).toMatchObject({
      os: { version: '14' },
      browser: { name: 'Firefox' },
      device: { model: null },
    });
  });

  it("takes Instagram's own iOS version and model over the browser's", () => {
    const facts = readUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0.0 (iPhone14,5; iOS 17_5; en_US; en; scale=3.00; 1170x2532; 0)',
    );
    expect(facts).toEqual({
      os: { name: 'iOS', version: '17.5', arch: 'arm64' },
      browser: { name: 'Instagram', version: '300.0.0.0.0' },
      device: { class: 'phone', model: 'iPhone14,5' },
    });
  });

  it('sees an iPad asking for the desktop site by its touch points', () => {
    const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
    expect(readUserAgent(ua, 5)).toMatchObject({ os: { name: 'iPadOS', version: '17.5' }, device: { class: 'tablet' } });
    expect(readUserAgent(ua, 0).os.name).toBe('macOS');
  });

  it('reads Windows, Linux and ChromeOS, and their architecture', () => {
    expect(readUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0').os).toEqual({ name: 'Windows', version: null, arch: 'x86_64' });
    expect(readUserAgent('Mozilla/5.0 (Windows NT 6.1; WOW64) Firefox/115.0').os.version).toBe('7');
    expect(readUserAgent('Mozilla/5.0 (Windows NT 10.0; ARM64) Edg/141.0').os.arch).toBe('arm64');
    expect(readUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0')).toMatchObject({
      os: { name: 'Linux', arch: 'x86_64' },
      browser: { name: 'Firefox', version: '131.0' },
    });
    expect(readUserAgent('Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/141.0').os.name).toBe('ChromeOS');
    expect(readUserAgent('').os.name).toBe('unknown');
  });
});

describe('the GPU', () => {
  it('names the GPU without ANGLE and the driver', () => {
    expect(gpuName('ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)')).toBe('Apple M2 Pro');
    expect(gpuName('ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 (0x00002206) Direct3D11 vs_5_0 ps_5_0, D3D11)')).toBe('NVIDIA GeForce RTX 3080');
    expect(gpuName('ANGLE (Intel Inc., Intel(R) Iris(TM) Plus Graphics OpenGL Engine, OpenGL 4.1)')).toBe('Intel(R) Iris(TM) Plus Graphics');
    expect(gpuName('Apple GPU')).toBe('Apple GPU');
  });

  it("finds an Apple M chip, and a Mac's architecture from it", () => {
    expect(appleChip('ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)')).toBe('Apple M4 Max');
    expect(appleChip('Apple GPU')).toBeNull();
    expect(macArch('ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)')).toBe('arm64');
    expect(macArch('ANGLE (Intel Inc., Intel(R) UHD Graphics 630, OpenGL 4.1)')).toBe('x86_64');
    // Safari says Apple GPU on every Mac, Intel ones too.
    expect(macArch('Apple GPU')).toBeNull();
    expect(macArch(null)).toBeNull();
  });
});

describe('versions and models', () => {
  it('names macOS and its Darwin release', () => {
    expect(macosName(26)).toBe('Tahoe');
    expect(macosName(15)).toBe('Sequoia');
    expect(macosName(99)).toBeNull();
    expect(darwinRelease(26)).toBe(25);
    expect(darwinRelease(15)).toBe(24);
    expect(darwinRelease(11)).toBe(20);
    expect(darwinRelease(10)).toBeNull();
  });

  it("tells Windows 11 from 10 by the client hints' platform version", () => {
    expect(windowsRelease('15.0.0')).toBe('11');
    expect(windowsRelease('10.0.0')).toBe('10');
    expect(windowsRelease('0.3.0')).toBe('8.1 or older');
  });

  it("guesses a MacBook from its built-in display's default size, and nothing else", () => {
    expect(macModel(1512, 982)).toBe('MacBook Pro (14-inch)');
    expect(macModel(2560, 1440)).toBeNull();
  });
});
