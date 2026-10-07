// System facts (services/types.ts, SysInfo): one implementation for fastfetch, /proc and debug
// report (F041). The cheap facts come from the user agent, the navigator and the screen, read
// once (lib/sysfacts.ts reads them); what needs a probe is read when asked: the GPU from WebGL
// (once, and the context is let go at once), the real OS version from User-Agent Client Hints,
// the battery and the storage estimate. The public IP is asked of api.ipify.org only when a
// command asks for it (fastfetch --net), and then once a session.

import { macArch, readUserAgent } from '../lib/sysfacts';
import { fetchJson, memo, untilAborted } from './net';
import { REQUEST_TIMEOUT_MS, type ConnectionInfo, type PlatformHints, type SysInfo, type SysSnapshot } from './types';

/** The parts of a window the facts are read from; tests pass plain objects. */
export interface SysHost {
  readonly navigator: Pick<Navigator, 'userAgent' | 'languages' | 'hardwareConcurrency'> & {
    readonly deviceMemory?: number;
    readonly onLine?: boolean;
    readonly maxTouchPoints?: number;
    /** iOS: launched from the home screen. */
    readonly standalone?: boolean;
    readonly userAgentData?: { getHighEntropyValues?(hints: string[]): Promise<Record<string, unknown>> };
    readonly connection?: { readonly saveData?: boolean; readonly type?: string; readonly effectiveType?: string };
    getBattery?(): Promise<{ readonly level: number; readonly charging: boolean }>;
    readonly storage?: { estimate?(): Promise<{ readonly usage?: number; readonly quota?: number }> };
  };
  readonly screen: Pick<Screen, 'width' | 'height' | 'colorDepth'>;
  readonly devicePixelRatio: number;
  readonly innerWidth?: number;
  readonly innerHeight?: number;
  readonly visualViewport?: { readonly height: number; readonly scale: number } | null;
  readonly matchMedia?: (query: string) => { readonly matches: boolean };
  /** For the WebGL probe. */
  readonly document?: { createElement(tag: 'canvas'): { getContext(kind: string): unknown } };
  readonly performance?: { now(): number };
}

export interface SysInfoOptions {
  /** The page's recent errors (platform/errors.ts), for debug report. */
  readonly errors?: () => readonly string[];
}

/** Reads the renderer from a fresh WebGL context, then lets the context go. */
function probeGpu(host: SysHost | null): string | null {
  let gl: WebGLRenderingContext | null = null;
  try {
    const canvas = host?.document?.createElement('canvas');
    if (canvas === undefined) return null;
    gl = (canvas.getContext('webgl') ?? canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (gl === null || typeof gl.getExtension !== 'function') return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info') as { UNMASKED_RENDERER_WEBGL: number } | null;
    const renderer: unknown = info === null ? gl.getParameter(gl.RENDERER) : gl.getParameter(info.UNMASKED_RENDERER_WEBGL);
    // Without the extension Chrome says only "WebKit WebGL", which names no GPU.
    return typeof renderer === 'string' && renderer !== '' && renderer !== 'WebKit WebGL' ? renderer : null;
  } catch {
    return null;
  } finally {
    try {
      (gl?.getExtension('WEBGL_lose_context') as { loseContext(): void } | null | undefined)?.loseContext();
    } catch {
      // Gone already.
    }
  }
}

function standalone(host: SysHost): boolean {
  if (host.navigator.standalone === true) return true;
  try {
    return host.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    return false;
  }
}

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

const IPIFY = 'https://api.ipify.org?format=json';

/** One lookup a session, however often fastfetch --net runs. */
const IP_TTL_MS = 24 * 60 * 60 * 1000;

export function createSysInfo(host: SysHost | null, options: SysInfoOptions = {}): SysInfo {
  let gpu: string | null | undefined;
  let snapshot: SysSnapshot | undefined;
  let hints: Promise<PlatformHints | null> | undefined;

  const readGpu = (): string | null => {
    if (gpu === undefined) gpu = probeGpu(host);
    return gpu;
  };

  const askHints = async (): Promise<PlatformHints | null> => {
    const data = host?.navigator.userAgentData;
    if (typeof data?.getHighEntropyValues !== 'function') return null;
    try {
      const values = await data.getHighEntropyValues(['platformVersion', 'architecture', 'bitness', 'model']);
      return {
        platformVersion: text(values.platformVersion),
        architecture: text(values.architecture),
        bitness: text(values.bitness),
        model: text(values.model),
      };
    } catch {
      return null;
    }
  };

  return {
    snapshot() {
      if (snapshot !== undefined) return snapshot;
      const nav = host?.navigator;
      const userAgent = nav?.userAgent ?? '';
      const agent = readUserAgent(userAgent, nav?.maxTouchPoints ?? 0);
      // A Mac's user agent says Intel whatever the chip; its GPU tells.
      const arch = agent.os.name === 'macOS' ? macArch(readGpu()) : agent.os.arch;
      snapshot = {
        userAgent,
        os: { ...agent.os, arch },
        browser: agent.browser,
        device: agent.device,
        cores: nav?.hardwareConcurrency || null,
        memoryGB: typeof nav?.deviceMemory === 'number' && nav.deviceMemory > 0 ? nav.deviceMemory : null,
        screen: {
          width: host?.screen.width ?? 0,
          height: host?.screen.height ?? 0,
          colorDepth: host?.screen.colorDepth ?? 24,
          pixelRatio: host?.devicePixelRatio ?? 1,
        },
        languages: nav?.languages ?? [],
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };
      return snapshot;
    },
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
    gpu: readGpu,
    async battery() {
      try {
        const battery = await host?.navigator.getBattery?.();
        if (battery === undefined || !Number.isFinite(battery.level)) return null;
        return { level: battery.level, charging: battery.charging === true };
      } catch {
        return null;
      }
    },
    async storage() {
      try {
        const { usage, quota } = (await host?.navigator.storage?.estimate?.()) ?? {};
        return typeof usage === 'number' && typeof quota === 'number' && quota > 0 ? { usage, quota } : null;
      } catch {
        return null;
      }
    },
    async publicIp(signal) {
      if (host === null) return null;
      const lookup = memo(IPIFY, IP_TTL_MS, () => fetchJson<{ ip?: unknown } | null>(IPIFY, { timeoutMs: REQUEST_TIMEOUT_MS.ipLookup }));
      try {
        return text((await untilAborted(lookup, signal, 'api.ipify.org'))?.ip);
      } catch (error) {
        // ^C is the visitor's, and the shell says so; anything else is just no answer.
        if (signal?.aborted) throw error;
        return null;
      }
    },
    platform() {
      hints ??= askHints();
      return hints;
    },
    connection(): ConnectionInfo {
      const connection = host?.navigator.connection;
      return {
        saveData: connection?.saveData === true,
        cellular: connection?.type === 'cellular' || /^(?:slow-2g|2g|3g)$/.test(connection?.effectiveType ?? ''),
      };
    },
    uptimeMs: () => Math.max(0, host?.performance?.now() ?? 0),
  };
}
