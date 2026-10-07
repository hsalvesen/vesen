// Interfaces for the side-effecting services (docs/plan/02-architecture-and-contracts.md,
// sections 7 to 9). Commands and the shell kernel see only these interfaces, injected through
// the command context; app/bootstrap.ts is the one place the browser implementations are built.

import type { StorageArea, StorageKey, LegacyKey } from './storage-keys';

// ── Net ────────────────────────────────────────────────────────────────────────────────────

/**
 * Why a request failed. `cors` is a failed cross-origin request, which browsers do not explain
 * further; `network` is a failed same-origin request while the browser reports being online.
 */
export type NetErrorKind = 'offline' | 'timeout' | 'cors' | 'network' | 'http' | 'parse' | 'abort';

/** Per-request deadlines; the whole-command budget is separate (CommandSpec.budgetMs). */
export const REQUEST_TIMEOUT_MS = {
  default: 8000,
  geocoding: 6000,
  ipLookup: 4000,
} as const;

/** How long `memo` remembers a failure before it tries again. */
export const MEMO_FAILURE_COOLDOWN_MS = 30_000;

/** What every network failure looks like to a command. */
export interface NetError extends Error {
  readonly kind: NetErrorKind;
  /** The host the request went to, such as `api.open-meteo.com`. */
  readonly host: string;
  /** The response status, for kind `http`. */
  readonly status?: number | undefined;
  /** The deadline that passed, for kind `timeout`. */
  readonly timeoutMs?: number | undefined;
}

export interface NetInit {
  method?: string;
  headers?: Readonly<Record<string, string>>;
  body?: string;
  /** Milliseconds before the request fails with kind `timeout`; defaults to 8000. */
  timeoutMs?: number;
  /** Cancels the request, which then fails with kind `abort`. Pass the command's signal. */
  signal?: AbortSignal;
  /** When false, a non-2xx response is returned rather than failing with kind `http`. Defaults to true. */
  throwHttpErrors?: boolean;
}

export interface NetResponse {
  readonly url: string;
  readonly status: number;
  /** Header names in lower case. */
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
  /** Time from request to the last byte. */
  readonly ms: number;
}

export interface JsonInit<T> extends NetInit {
  /** Checks and narrows the parsed body; throwing here fails the request with kind `parse`. */
  parse?: (raw: unknown) => T;
}

export interface Net {
  /** Fetches and reads the body as text, all within one deadline. */
  text(url: string, init?: NetInit): Promise<NetResponse>;
  /** Fetches and parses JSON; malformed JSON or a failed `parse` is kind `parse`. */
  json<T = unknown>(url: string, init?: JsonInit<T>): Promise<T>;
  /**
   * Runs `load` once per key within `ttlMs`: concurrent callers share the request in flight,
   * and a failure is remembered for 30 s so a broken host is not hammered.
   */
  memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T>;
  isError(error: unknown): error is NetError;
  /** False only when the browser reports being offline. */
  online(): boolean;
}

// ── Storage ────────────────────────────────────────────────────────────────────────────────

/**
 * One storage area. Every access is wrapped in try/catch and falls back to memory, so a browser
 * that blocks storage still gets a working session.
 */
export interface KV<A extends StorageArea = StorageArea> {
  /** False once the memory fallback is in use; nothing will survive a reload. */
  readonly persistent: boolean;
  get(key: StorageKey<A>): string | null;
  /** False when the value could only be kept in memory, for example over quota. */
  set(key: StorageKey<A>, value: string): boolean;
  remove(key: StorageKey<A>): void;
  /** Parses JSON and checks it with `parse`; anything unreadable is `undefined`. */
  getJson<T>(key: StorageKey<A>, parse: (raw: unknown) => T | undefined): T | undefined;
  setJson(key: StorageKey<A>, value: unknown): boolean;
}

export interface StorageService {
  readonly local: KV<'local'>;
  readonly session: KV<'session'>;
  /** Reads a pre-overhaul key, for the one-time migration at boot. */
  readLegacy(key: LegacyKey): string | null;
  removeLegacy(key: LegacyKey): void;
}

// ── Bell ───────────────────────────────────────────────────────────────────────────────────

export interface Bell {
  /** Audible on desktop through one shared AudioContext; a visual flash on touch or when muted. */
  ring(): void;
  /** Called on each visual ring; the UI flashes the screen. Returns an unsubscribe function. */
  onFlash(listener: () => void): () => void;
}

// ── Opener ─────────────────────────────────────────────────────────────────────────────────

/**
 * How a URL opens (docs/plan/02-architecture-and-contracts.md, section 7):
 * - `window`: a desktop browser outside an in-app browser. The command's opens() URL opens in a
 *   new tab synchronously inside the Enter or tap gesture, and the card is printed too.
 * - `self`: an in-app browser (Instagram, Facebook, TikTok). Nothing navigates without a tap, and
 *   a tapped link opens in the same view, so Back comes back to the terminal.
 * - `card-only`: a phone or tablet browser, or a mailto link anywhere. Only the card is printed;
 *   a tapped link opens in a new tab.
 */
export type OpenMode = 'window' | 'self' | 'card-only';

export interface OpenPlan {
  readonly mode: OpenMode;
  /** Where a tapped link opens: '_self' inside an in-app browser, '_blank' everywhere else. */
  readonly target: '_blank' | '_self';
}

/** The in-app browser the page is in, as the link cards word it. */
export interface InAppInfo {
  /** 'Instagram'. */
  readonly label: string;
  /** The real browser an escape opens: 'Safari' on iOS, 'Chrome' on Android, else 'your browser'. */
  readonly browser: string;
  /** The manual instruction, always shown beside an escape: '••• → Open in browser'. */
  readonly menuHint: string;
}

/**
 * Opens links under the in-app browser policy. Every opener also prints a link card, which is
 * not this service's job.
 */
export interface Opener {
  /** True on a desktop browser outside an in-app browser: plan(url).mode is 'window' for web links. */
  readonly autoOpen: boolean;
  /** The in-app browser, or null in a real browser. */
  readonly inApp: InAppInfo | null;
  /** How `url` opens here. */
  plan(url: string): OpenPlan;
  /**
   * Must be called synchronously inside the user gesture. Opens `url` in a new tab with
   * `noopener,noreferrer` when the plan's mode is `window`, and `skipped` otherwise. A blocked or
   * failed window.open is `blocked`; null, which is what noopener returns, counts as opened.
   */
  preflight(url: string): 'opened' | 'blocked' | 'skipped';
  /** Opens `url` after a tap on a link or card: a new tab, or the same view in an in-app browser. */
  open(url: string): 'opened' | 'blocked';
  /**
   * The link that opens `url` in the real browser from an in-app browser: `instagram://extbrowser/`
   * on iOS Instagram, `intent://` on Android; null where there is none.
   */
  escapeHref(url: string): string | null;
  /**
   * Leaves the in-app browser for the real one, through escapeHref(url). Only ever from a tap,
   * and only beside the manual instruction. False when there is no escape here.
   */
  openExternal(url: string): boolean;
  /** The manual "••• → Open in browser" instruction for the current in-app browser, or null. */
  menuHint(): string | null;
  /** True when the system share sheet is available. */
  canShare(): boolean;
  share(data: { url: string; title?: string }): Promise<'shared' | 'cancelled' | 'unavailable'>;
}

// ── Clipboard ──────────────────────────────────────────────────────────────────────────────

export interface Clipboard {
  /** Writes text inside a user gesture, falling back to execCommand; false when both fail. */
  copy(text: string): Promise<boolean>;
}

// ── Clock ──────────────────────────────────────────────────────────────────────────────────

/** Time and randomness, injected so tests are deterministic. */
export interface Clock {
  /** Wall-clock milliseconds since the epoch. */
  now(): number;
  /** Wall-clock time the page booted, for uptime and /proc. */
  bootTime(): number;
  /** The IANA time zone, such as `Australia/Sydney`. */
  timeZone(): string;
  /** A number in [0, 1). */
  random(): number;
  /** Resolves after `ms`, or rejects with the signal's reason as soon as it aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

// ── SysInfo ────────────────────────────────────────────────────────────────────────────────

export type DeviceClass = 'desktop' | 'phone' | 'tablet';

/** Facts that are cheap and synchronous to read, gathered once at boot. */
export interface SysSnapshot {
  readonly userAgent: string;
  readonly os: { readonly name: string; readonly version: string | null; readonly arch: string | null };
  readonly browser: { readonly name: string; readonly version: string | null };
  readonly device: { readonly class: DeviceClass; readonly model: string | null };
  readonly cores: number | null;
  readonly memoryGB: number | null;
  readonly screen: {
    readonly width: number;
    readonly height: number;
    readonly colorDepth: number;
    readonly pixelRatio: number;
  };
  /** BCP 47 tags, preferred first. */
  readonly languages: readonly string[];
  readonly timeZone: string;
}

/** What `debug report` adds to the snapshot: the page as it is now, and what went wrong. */
export interface Diagnostics {
  /** The layout viewport, and the part of it the visitor sees where the browser says. */
  readonly viewport: { readonly width: number; readonly height: number; readonly visibleHeight: number | null; readonly scale: number | null };
  readonly online: boolean;
  /** Launched from the home screen. */
  readonly standalone: boolean;
  /** The newest uncaught errors and rejected promises, oldest first, one line each. */
  readonly errors: readonly string[];
}

/** The one source of system facts for fastfetch, uname, /proc, free, lscpu and locale. */
export interface SysInfo {
  /** For `debug report`; never sent anywhere, only copied when the visitor asks. */
  diagnostics(): Diagnostics;
  snapshot(): SysSnapshot;
  /** The WebGL renderer string, probed lazily; null when unavailable. */
  gpu(): string | null;
  battery(): Promise<{ readonly level: number; readonly charging: boolean } | null>;
  storage(): Promise<{ readonly usage: number; readonly quota: number } | null>;
  /** The visitor's public IP address, labelled "Public IP"; null on failure. */
  publicIp(signal?: AbortSignal): Promise<string | null>;
}

// ── Appearance ─────────────────────────────────────────────────────────────────────────────

/** The palette slots `theme ls` previews, in terminal order, one swatch each. */
export const SWATCH_SLOTS = ['foreground', 'red', 'green', 'yellow', 'blue', 'purple', 'cyan', 'brightBlack'] as const;

export interface ThemeInfo {
  readonly name: string;
  /** Hex colours for a swatch next to the name in completions and `theme ls`. */
  readonly background: string;
  readonly foreground: string;
  /** The theme's own hex colours for SWATCH_SLOTS, in that order. */
  readonly swatches: readonly string[];
}

export interface CathodeInfo {
  readonly name: string;
  readonly summary: string;
}

/** How much of the CRT effect the device draws, and why, in words for `cathode ls`. */
export interface CathodeTier {
  /** full, lite or off. */
  readonly tier: string;
  /** Such as "a touch screen", or "set with cathode quality full". */
  readonly reason: string;
  /** The quality setting the tier came from: auto, full, lite or off. */
  readonly quality: string;
}

/** The phone dock's key bar (`keys`): the setting, and what it comes to on this device. */
export interface KeyBarState {
  /** auto, on or off. */
  readonly mode: string;
  /** A hardware keyboard has been used on this touch screen, which hides the bar under auto. */
  readonly hardware: boolean;
  /** The bar shows above a soft keyboard: on, or auto with no hardware keyboard seen. */
  readonly shown: boolean;
}

/** Theme, CRT and key bar state, over the stores. Commands reach appearance only through this. */
export interface Appearance {
  themes(): readonly ThemeInfo[];
  currentTheme(): string;
  /** Case-insensitive; false when no theme has that name. */
  setTheme(name: string): boolean;
  cathodeModes(): readonly CathodeInfo[];
  currentCathode(): string;
  /** Case-insensitive; false when no mode has that name. */
  setCathode(mode: string): boolean;
  /** The quality settings: auto, then the tiers. */
  cathodeQualities(): readonly string[];
  /** Case-insensitive; false when it is not a quality. The tier follows at once. */
  setCathodeQuality(quality: string): boolean;
  /** The tier in force, and why. */
  cathodeTier(): CathodeTier;
  /** The phone dock's key bar. */
  keyBar(): KeyBarState;
  /** The key bar settings: auto, on, off. */
  keyBarModes(): readonly string[];
  /** Case-insensitive; false when it is not a setting. Saved, and the dock follows at once. */
  setKeyBar(mode: string): boolean;
  /** `reset`: restores the default theme, as reset always has; the CRT mode stays the visitor's choice. */
  resetDefaults(): void;
}
