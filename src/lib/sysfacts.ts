// Reading what a browser says about its system: the user agent string and the WebGL renderer.
// Pure functions, for services/sysinfo.ts, which reads them from the page, and fastfetch;
// lib/sysnames.ts words them the way fastfetch does.
//
// A browser hides a lot. macOS and Windows report a frozen version in the user agent, Chrome on
// Android reports "Android 10; K", and Safari 26 reports iOS 18.6 whatever the system. Frozen
// versions are left unknown here, for the client hints to fill where the browser has them.

import type { SysSnapshot } from '../services/types';

/** What the user agent string says, before any probe. */
export interface AgentFacts {
  readonly os: SysSnapshot['os'];
  readonly browser: SysSnapshot['browser'];
  readonly device: SysSnapshot['device'];
}

const dotted = (...parts: (string | undefined)[]): string => parts.filter((part): part is string => part !== undefined && part !== '').join('.');

function browserOf(ua: string): SysSnapshot['browser'] {
  const found = (name: string, pattern: RegExp): SysSnapshot['browser'] | null => {
    const match = pattern.exec(ua);
    return match ? { name, version: match[1] ?? null } : null;
  };
  return (
    found('Instagram', /\bInstagram (\d[\d.]*)/) ??
    found('Facebook', /\bFBAV\/(\d[\d.]*)/) ??
    found('Edge', /\bEdgA?\/(\d[\d.]*)/) ??
    found('Opera', /\bOPR\/(\d[\d.]*)/) ??
    found('Firefox', /\b(?:Firefox|FxiOS)\/(\d[\d.]*)/) ??
    found('Samsung Internet', /\bSamsungBrowser\/(\d[\d.]*)/) ??
    found('Chrome', /\b(?:Chrome|CriOS)\/(\d[\d.]*)/) ??
    found('Safari', /\bVersion\/(\d[\d.]*).*\bSafari\//) ?? { name: 'unknown', version: null }
  );
}

function archOf(ua: string): string | null {
  if (/\b(?:aarch64|arm64|ARM64|armv8)/.test(ua)) return 'arm64';
  if (/\b(?:x86_64|x64|Win64|WOW64|amd64)\b/i.test(ua)) return 'x86_64';
  if (/\barmv7/.test(ua)) return 'arm';
  if (/\bi[3-6]86\b/.test(ua)) return 'x86';
  return null;
}

/**
 * The OS, browser and device as the user agent string tells them. An iPad asking for the desktop
 * site says Macintosh, and only its touch points give it away.
 */
export function readUserAgent(ua: string, maxTouchPoints = 0): AgentFacts {
  const browser = browserOf(ua);
  const desktop = (os: SysSnapshot['os']): AgentFacts => ({ os, browser, device: { class: 'desktop', model: null } });

  if (/\b(?:iPhone|iPod|iPad)\b/.test(ua) || (/\bMacintosh\b/.test(ua) && maxTouchPoints > 1)) {
    const ipad = !/\b(?:iPhone|iPod)\b/.test(ua);
    // Safari ships with the system, so its version is the system's: the one fact left when
    // Safari 26 says iOS 18.6, or an iPad asks for the desktop site.
    const safari = /\bVersion\/(\d+(?:\.\d+)*)/.exec(ua)?.[1] ?? null;
    // Instagram's in-app browser adds the real version and the model: (iPhone14,5; iOS 17_5; …).
    const app = /\((i(?:Phone|Pad)\d+,\d+); iOS (\d+)_(\d+)(?:_(\d+))?/.exec(ua);
    const os = /\bOS (\d+)_(\d+)(?:_(\d+))?/.exec(ua);
    let version = app ? dotted(app[2], app[3], app[4]) : os ? dotted(os[1], os[2], os[3]) : null;
    if (!app && (version === null || (version.startsWith('18.6') && safari !== null && Number.parseInt(safari, 10) >= 26))) version = safari;
    return {
      os: { name: ipad ? 'iPadOS' : 'iOS', version, arch: 'arm64' },
      browser,
      device: { class: ipad ? 'tablet' : 'phone', model: app?.[1] ?? null },
    };
  }
  if (/\bAndroid\b/.test(ua)) {
    const match = /\bAndroid (\d+(?:\.\d+)*)(?:; ([^;)]+))?/.exec(ua);
    // Chrome's reduced agent always says "Android 10; K".
    const reduced = match?.[1] === '10' && match[2]?.trim() === 'K';
    const model = reduced ? null : match?.[2]?.replace(/\s+Build\/.*$/, '').trim() || null;
    return {
      os: { name: 'Android', version: reduced ? null : (match?.[1] ?? null), arch: archOf(ua) },
      browser,
      device: { class: /\bMobile\b/.test(ua) ? 'phone' : 'tablet', model: model === null || /^(?:Linux|U|Mobile|Tablet|wv)$/.test(model) ? null : model },
    };
  }
  if (/\bMacintosh\b|\bMac OS X\b/.test(ua)) {
    const os = /Mac OS X (\d+)[_.](\d+)(?:[_.](\d+))?/.exec(ua);
    const version = os ? dotted(os[1], os[2], os[3]) : null;
    return desktop({ name: 'macOS', version: version === '10.15.7' ? null : version, arch: null });
  }
  if (/\bCrOS\b/.test(ua)) return desktop({ name: 'ChromeOS', version: null, arch: archOf(ua) });
  const windows = /\bWindows NT (\d+\.\d+)/.exec(ua);
  if (windows) {
    const names: Readonly<Record<string, string>> = { '6.1': '7', '6.2': '8', '6.3': '8.1' };
    return desktop({ name: 'Windows', version: names[windows[1] ?? ''] ?? null, arch: archOf(ua) ?? 'x86_64' });
  }
  if (/\bLinux\b|\bX11\b/.test(ua)) return desktop({ name: 'Linux', version: null, arch: archOf(ua) });
  return desktop({ name: 'unknown', version: null, arch: null });
}

// ── The GPU ────────────────────────────────────────────────────────────────────────────────

/** `Apple M2 Pro` from a renderer such as `ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, …)`. */
export function appleChip(renderer: string | null): string | null {
  const match = /\bApple (M\d+(?: (?:Pro|Max|Ultra))?)\b/.exec(renderer ?? '');
  return match ? `Apple ${match[1]}` : null;
}

/**
 * The architecture a Mac's GPU implies: an Apple M chip is arm64; Intel, AMD or NVIDIA, x86_64.
 * Safari says only "Apple GPU" on every Mac, which implies nothing.
 */
export function macArch(renderer: string | null): string | null {
  if (appleChip(renderer) !== null) return 'arm64';
  if (/\b(?:Intel|AMD|Radeon|NVIDIA)\b/i.test(renderer ?? '')) return 'x86_64';
  return null;
}
