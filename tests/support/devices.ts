// Deterministic browser profiles: what navigator, screen, WebGL and performance report.
// fastfetch reads all of these, and the legacy virtual file system reads navigator at import.
import { vi } from 'vitest';

export interface DeviceProfile {
  /** The navigator fields the legacy code reads; anything missing behaves as unsupported. */
  navigator: Record<string, unknown>;
  screen: { width: number; height: number; colorDepth: number };
  devicePixelRatio: number;
  /** What WEBGL_debug_renderer_info reports, or null when the extension is unavailable. */
  webglRenderer: string | null;
  /** Chrome's non-standard performance.memory; other engines leave it undefined. */
  memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
  /** performance.now() while a command runs, which fastfetch reports as uptime. */
  uptimeMs: number;
}

const GiB = 1024 ** 3;

/** Chrome on an Apple-silicon MacBook Pro running macOS 26. */
export const MAC_CHROME: DeviceProfile = {
  navigator: {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) ' +
      'Chrome/141.0.0.0 Safari/537.36',
    platform: 'MacIntel',
    language: 'en-AU',
    languages: ['en-AU', 'en'],
    hardwareConcurrency: 10,
    deviceMemory: 8,
    maxTouchPoints: 0,
    onLine: true,
    cookieEnabled: true,
    userAgentData: {
      platform: 'macOS',
      mobile: false,
      getHighEntropyValues: async () => ({ platform: 'macOS', platformVersion: '26.0.0' }),
    },
    getBattery: async () => ({ level: 0.87, charging: true }),
    storage: { estimate: async () => ({ quota: 296 * GiB, usage: 1.6 * GiB }) },
    mediaDevices: { getDisplayMedia: async () => undefined },
  },
  screen: { width: 1512, height: 982, colorDepth: 30 },
  devicePixelRatio: 2,
  webglRenderer: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)',
  memory: { usedJSHeapSize: 25_000_000, totalJSHeapSize: 40_000_000, jsHeapSizeLimit: 4_294_705_152 },
  uptimeMs: 3_723_000,
};

/** Instagram's in-app browser on an iPhone (WKWebView), the site's main audience. */
export const IPHONE_INSTAGRAM: DeviceProfile = {
  navigator: {
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) ' +
      'Mobile/15E148 Instagram 300.0.0.0.0 (iPhone14,5; iOS 17_5; en_US; en; scale=3.00; 1170x2532; 0)',
    platform: 'iPhone',
    language: 'en-AU',
    languages: ['en-AU'],
    hardwareConcurrency: 6,
    maxTouchPoints: 5,
    onLine: true,
    cookieEnabled: true,
    storage: { estimate: async () => ({ quota: 1 * GiB, usage: 50 * 1024 ** 2 }) },
    mediaDevices: {},
  },
  screen: { width: 390, height: 844, colorDepth: 24 },
  devicePixelRatio: 3,
  webglRenderer: 'Apple GPU',
  uptimeMs: 3_723_000,
};

const UNMASKED_VENDOR_WEBGL = 0x9245;
const UNMASKED_RENDERER_WEBGL = 0x9246;

function fakeWebGL(renderer: string | null) {
  const debugInfo = { UNMASKED_VENDOR_WEBGL, UNMASKED_RENDERER_WEBGL };
  return {
    getExtension: (name: string) => (name === 'WEBGL_debug_renderer_info' && renderer !== null ? debugInfo : null),
    getParameter: (parameter: number) => (parameter === UNMASKED_RENDERER_WEBGL ? renderer : null),
  };
}

/**
 * Makes the page look like `device` until vi.unstubAllGlobals() and vi.restoreAllMocks() run.
 * Returns a function that removes performance.memory, which neither of those can undo.
 */
export function installDevice(device: DeviceProfile): () => void {
  vi.stubGlobal('navigator', device.navigator);
  vi.stubGlobal('screen', device.screen);
  vi.stubGlobal('devicePixelRatio', device.devicePixelRatio);
  vi.spyOn(performance, 'now').mockReturnValue(device.uptimeMs);

  const gl = fakeWebGL(device.webglRenderer);
  const getContext = (type: string) => (type === 'webgl' || type === 'experimental-webgl' ? gl : null);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    getContext as unknown as HTMLCanvasElement['getContext'],
  );

  const target = performance as Performance & { memory?: DeviceProfile['memory'] };
  if (device.memory) {
    Object.defineProperty(target, 'memory', { value: device.memory, configurable: true });
  }
  return () => {
    delete target.memory;
  };
}
