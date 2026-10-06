// How much of the CRT effect this device gets (docs/plan/09-visual-and-accessibility.md,
// deliverable 3). The mode (scanlines, phosphor, vintage) is the visitor's taste; the tier is what
// the device and its settings call for:
//   off   reduced motion, increased contrast, forced colours or reduced transparency
//   lite  touch screens, in-app browsers, Save-Data and low memory: a static vignette and fine
//         scanlines, no filter, sweep or flicker, and a small glow
//   full  everything else, a desktop with a fine pointer
// `cathode quality` overrides the choice. decideTier is pure; startPerf watches the settings.
import type { CrtQuality, CrtTier, TierDecision } from '../stores/cathode';

export interface PerfSignals {
  readonly reducedMotion: boolean;
  readonly moreContrast: boolean;
  readonly forcedColors: boolean;
  readonly reducedTransparency: boolean;
  readonly coarsePointer: boolean;
  /** The app whose in-app browser this is, or null. */
  readonly inApp: string | null;
  readonly saveData: boolean;
  /** navigator.deviceMemory in GB, where the browser reports it. */
  readonly deviceMemory: number | null;
}

/** A desktop with nothing asked for: the full effect. */
export const NO_SIGNALS: PerfSignals = {
  reducedMotion: false,
  moreContrast: false,
  forcedColors: false,
  reducedTransparency: false,
  coarsePointer: false,
  inApp: null,
  saveData: false,
  deviceMemory: null,
};

/** In-app browsers by the token their apps add to the user agent. */
const IN_APP_BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bInstagram\b/, 'Instagram'],
  [/\bFBA[NV]\//, 'Facebook'],
  [/musical_ly/, 'TikTok'],
];

export function inAppBrowser(userAgent: string): string | null {
  for (const [token, app] of IN_APP_BROWSERS) if (token.test(userAgent)) return app;
  return null;
}

/** Devices at or under this much memory get the lite tier. */
const LOW_MEMORY_GB = 2;

/** The tier for these signals, and why, in words for `cathode ls`. */
export function decideTier(signals: PerfSignals, quality: CrtQuality = 'auto'): TierDecision {
  if (quality !== 'auto') return { tier: quality, reason: `set with cathode quality ${quality}`, quality };
  const decide = (tier: CrtTier, reason: string): TierDecision => ({ tier, reason, quality });

  if (signals.reducedMotion) return decide('off', 'the system asks for reduced motion');
  if (signals.moreContrast) return decide('off', 'the system asks for more contrast');
  if (signals.forcedColors) return decide('off', 'forced colours are on');
  if (signals.reducedTransparency) return decide('off', 'the system asks for reduced transparency');

  if (signals.inApp !== null) return decide('lite', `in ${signals.inApp}'s in-app browser`);
  if (signals.saveData) return decide('lite', 'Data Saver is on');
  if (signals.deviceMemory !== null && signals.deviceMemory <= LOW_MEMORY_GB) {
    return decide('lite', `the device has ${signals.deviceMemory} GB of memory`);
  }
  if (signals.coarsePointer) return decide('lite', 'a touch screen');
  return decide('full', 'a desktop with a mouse or trackpad');
}

const QUERIES = {
  reducedMotion: '(prefers-reduced-motion: reduce)',
  moreContrast: '(prefers-contrast: more)',
  forcedColors: '(forced-colors: active)',
  reducedTransparency: '(prefers-reduced-transparency: reduce)',
  coarsePointer: '(pointer: coarse)',
} as const;

type QueryName = keyof typeof QUERIES;

interface NetworkInformationLike extends EventTarget {
  readonly saveData?: boolean;
}

function connectionOf(win: Window): NetworkInformationLike | undefined {
  return (win.navigator as Navigator & { connection?: NetworkInformationLike }).connection;
}

function mediaQuery(win: Window, query: string): MediaQueryList | null {
  try {
    return typeof win.matchMedia === 'function' ? win.matchMedia(query) : null;
  } catch {
    return null;
  }
}

/** The signals as the browser reports them now. Anything it cannot answer counts as not asked for. */
export function readSignals(win: Window): PerfSignals {
  const matches = (name: QueryName) => mediaQuery(win, QUERIES[name])?.matches === true;
  const memory = (win.navigator as Navigator & { deviceMemory?: unknown }).deviceMemory;
  return {
    reducedMotion: matches('reducedMotion'),
    moreContrast: matches('moreContrast'),
    forcedColors: matches('forcedColors'),
    reducedTransparency: matches('reducedTransparency'),
    coarsePointer: matches('coarsePointer'),
    inApp: inAppBrowser(win.navigator.userAgent ?? ''),
    saveData: connectionOf(win)?.saveData === true,
    deviceMemory: typeof memory === 'number' && Number.isFinite(memory) ? memory : null,
  };
}

/**
 * The lite scanlines as whole device pixels: a period of about 3 CSS px and a dark line of about
 * half that, so phones with a fractional pixel ratio (2.625 on a Pixel 7) draw even lines rather
 * than a shimmering moiré.
 */
export function scanlineGeometry(devicePixelRatio: number): { period: string; line: string } {
  const dpr = Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1;
  const period = Math.max(2, Math.round(3 * dpr));
  const line = Math.max(1, Math.round(period / 2));
  const px = (devicePixels: number) => `${Number((devicePixels / dpr).toFixed(4))}px`;
  return { period: px(period), line: px(line) };
}

/**
 * Watches the settings behind the tier and reports each change, sizes the lite scanlines to the
 * screen's pixels, and pauses the CRT animations (the `crt-paused` class) while the page is
 * hidden. Returns a function that stops all of it.
 */
export function startPerf(win: Window, onChange: (signals: PerfSignals) => void): () => void {
  const root = win.document.documentElement;
  const stops: (() => void)[] = [];
  const report = () => onChange(readSignals(win));

  for (const query of Object.values(QUERIES)) {
    const list = mediaQuery(win, query);
    if (list && typeof list.addEventListener === 'function') {
      list.addEventListener('change', report);
      stops.push(() => list.removeEventListener('change', report));
    }
  }
  const connection = connectionOf(win);
  if (connection && typeof connection.addEventListener === 'function') {
    connection.addEventListener('change', report);
    stops.push(() => connection.removeEventListener('change', report));
  }

  const sizeScanlines = () => {
    const { period, line } = scanlineGeometry(win.devicePixelRatio);
    root.style.setProperty('--crt-scan-period', period);
    root.style.setProperty('--crt-scan-line', line);
  };
  sizeScanlines();
  win.addEventListener('resize', sizeScanlines);
  stops.push(() => win.removeEventListener('resize', sizeScanlines));

  const doc = win.document;
  const pause = () => root.classList.toggle('crt-paused', doc.visibilityState === 'hidden');
  pause();
  doc.addEventListener('visibilitychange', pause);
  stops.push(() => doc.removeEventListener('visibilitychange', pause));

  report();
  return () => {
    for (const stop of stops) stop();
    root.classList.remove('crt-paused');
  };
}
