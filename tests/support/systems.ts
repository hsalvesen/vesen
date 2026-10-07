// What four kinds of device tell a page about themselves, as plain objects in the shape the
// sysinfo service reads (services/sysinfo.ts, SysHost): an Apple-silicon Mac in Chrome, a Windows
// PC in Chrome, an Android phone in Chrome and an iPhone in Safari 26. The user agents are as
// those browsers send them, frozen versions included.

import type { SysHost } from '../../src/services/sysinfo';

/** A WebGL context that names `renderer`, and counts how often it is let go. */
export function fakeGl(renderer: string | null) {
  const lost = { count: 0 };
  const gl = {
    RENDERER: 0x1f01,
    getExtension: (name: string) => {
      if (name === 'WEBGL_debug_renderer_info') return renderer === null ? null : { UNMASKED_RENDERER_WEBGL: 0x9246 };
      if (name === 'WEBGL_lose_context') return { loseContext: () => (lost.count += 1) };
      return null;
    },
    getParameter: (parameter: number) => (parameter === 0x9246 ? renderer : 'WebKit WebGL'),
  };
  return { gl, lost };
}

export interface System {
  readonly host: SysHost;
  /** How often the WebGL context was let go. */
  readonly lost: { count: number };
  /** How often a context was asked for. */
  readonly contexts: { count: number };
}

function system(
  navigator: SysHost['navigator'],
  screen: { width: number; height: number },
  devicePixelRatio: number,
  renderer: string | null,
): System {
  const { gl, lost } = fakeGl(renderer);
  const contexts = { count: 0 };
  const host: SysHost = {
    navigator,
    screen: { ...screen, colorDepth: 24 },
    devicePixelRatio,
    document: {
      createElement: () => ({
        getContext: (kind: string) => {
          contexts.count += 1;
          return kind === 'webgl' ? gl : null;
        },
      }),
    },
    performance: { now: () => 90_000 },
  };
  return { host, lost, contexts };
}

const hints = (values: Record<string, string>) => ({ getHighEntropyValues: async () => values });

export const APPLE_SILICON_MAC = (): System =>
  system(
    {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      languages: ['en-AU', 'en'],
      hardwareConcurrency: 8,
      deviceMemory: 8,
      maxTouchPoints: 0,
      userAgentData: hints({ platformVersion: '15.6.1', architecture: 'arm', bitness: '64', model: '' }),
      getBattery: async () => ({ level: 0.5, charging: false }),
      storage: { estimate: async () => ({ usage: 2 * 1024 ** 2, quota: 100 * 1024 ** 3 }) },
    },
    { width: 1470, height: 956 },
    2,
    'ANGLE (Apple, ANGLE Metal Renderer: Apple M3, Unspecified Version)',
  );

export const WINDOWS_PC = (): System =>
  system(
    {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
      languages: ['en-GB'],
      hardwareConcurrency: 16,
      deviceMemory: 8,
      userAgentData: hints({ platformVersion: '15.0.0', architecture: 'x86', bitness: '64', model: '' }),
      getBattery: async () => ({ level: 1, charging: true }),
    },
    { width: 2560, height: 1440 },
    1,
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 (0x00002206) Direct3D11 vs_5_0 ps_5_0, D3D11)',
  );

export const ANDROID_PHONE = (): System =>
  system(
    {
      userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
      languages: ['nb-NO', 'en'],
      hardwareConcurrency: 8,
      deviceMemory: 4,
      maxTouchPoints: 5,
      userAgentData: hints({ platformVersion: '14.0.0', architecture: '', bitness: '', model: 'Pixel 7' }),
      connection: { type: 'cellular', effectiveType: '4g', saveData: false },
    },
    { width: 412, height: 915 },
    2.625,
    'ANGLE (ARM, Mali-G710 MC10, OpenGL ES 3.2)',
  );

export const IPHONE_SAFARI = (): System =>
  system(
    {
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
      languages: ['en-AU'],
      hardwareConcurrency: 6,
      maxTouchPoints: 5,
      connection: { saveData: true },
    },
    { width: 393, height: 852 },
    3,
    'Apple GPU',
  );
