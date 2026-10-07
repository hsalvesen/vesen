// System facts (services/types.ts, SysInfo). A stub for now: the cheap synchronous facts from the
// navigator and the screen, and nulls for what needs a probe. fastfetch, uname and /proc move onto
// it as they are ported, and the probes land with them.

import type { DeviceClass, SysInfo, SysSnapshot } from './types';

export interface SysHost {
  readonly navigator: Pick<Navigator, 'userAgent' | 'languages' | 'hardwareConcurrency'> & {
    readonly deviceMemory?: number;
    readonly onLine?: boolean;
    /** iOS: launched from the home screen. */
    readonly standalone?: boolean;
  };
  readonly screen: Pick<Screen, 'width' | 'height' | 'colorDepth'>;
  readonly devicePixelRatio: number;
  readonly innerWidth?: number;
  readonly innerHeight?: number;
  readonly visualViewport?: { readonly height: number; readonly scale: number } | null;
  readonly matchMedia?: (query: string) => { readonly matches: boolean };
}

export interface SysInfoOptions {
  /** The page's recent errors (platform/errors.ts), for debug report. */
  readonly errors?: () => readonly string[];
}

function deviceClass(userAgent: string): DeviceClass {
  if (/iPad|Tablet/i.test(userAgent)) return 'tablet';
  if (/Mobi|iPhone|Android/i.test(userAgent)) return 'phone';
  return 'desktop';
}

function standalone(host: SysHost): boolean {
  if (host.navigator.standalone === true) return true;
  try {
    return host.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    return false;
  }
}

export function createSysInfoStub(host: SysHost | null, options: SysInfoOptions = {}): SysInfo {
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
    diagnostics: () => ({
      viewport: {
        width: host?.innerWidth ?? 0,
        height: host?.innerHeight ?? 0,
        visibleHeight: host?.visualViewport?.height ?? null,
        scale: host?.visualViewport?.scale ?? null,
      },
      online: host?.navigator.onLine !== false,
      standalone: host === null ? false : standalone(host),
      errors: options.errors?.() ?? [],
    }),
    gpu: () => null,
    battery: () => Promise.resolve(null),
    storage: () => Promise.resolve(null),
    publicIp: () => Promise.resolve(null),
  };
}
