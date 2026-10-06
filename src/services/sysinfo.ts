// System facts (services/types.ts, SysInfo). A stub for now: the cheap synchronous facts from the
// navigator and the screen, and nulls for what needs a probe. fastfetch, uname and /proc move onto
// it as they are ported, and the probes land with them.

import type { DeviceClass, SysInfo, SysSnapshot } from './types';

export interface SysHost {
  readonly navigator: Pick<Navigator, 'userAgent' | 'languages' | 'hardwareConcurrency'> & { readonly deviceMemory?: number };
  readonly screen: Pick<Screen, 'width' | 'height' | 'colorDepth'>;
  readonly devicePixelRatio: number;
}

function deviceClass(userAgent: string): DeviceClass {
  if (/iPad|Tablet/i.test(userAgent)) return 'tablet';
  if (/Mobi|iPhone|Android/i.test(userAgent)) return 'phone';
  return 'desktop';
}

export function createSysInfoStub(host: SysHost | null): SysInfo {
  const snapshot = (): SysSnapshot => {
    const userAgent = host?.navigator.userAgent ?? '';
    return {
      userAgent,
      os: { name: 'unknown', version: null, arch: null },
      browser: { name: 'unknown', version: null },
      device: { class: deviceClass(userAgent), model: null },
      cores: host?.navigator.hardwareConcurrency || null,
      memoryGB: host?.navigator.deviceMemory ?? null,
      screen: {
        width: host?.screen.width ?? 0,
        height: host?.screen.height ?? 0,
        colorDepth: host?.screen.colorDepth ?? 24,
        pixelRatio: host?.devicePixelRatio ?? 1,
      },
      languages: host?.navigator.languages ?? [],
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
  };
  return {
    snapshot,
    gpu: () => null,
    battery: () => Promise.resolve(null),
    storage: () => Promise.resolve(null),
    publicIp: () => Promise.resolve(null),
  };
}
