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
 * Opens links under the in-app browser policy. On a desktop browser a command's `opens()` URL
 * opens synchronously inside the Enter or tap gesture; inside Instagram, Facebook or TikTok
 * nothing navigates without a tap. Every opener also prints a link card, which is not this
 * service's job.
 */
export interface Opener {
  /** True on a desktop browser outside an in-app browser. */
  readonly autoOpen: boolean;
  /**
   * Must be called synchronously inside the user gesture. Opens `url` in a new tab when
   * `autoOpen` allows it; `skipped` when the policy says to wait for a tap.
   */
  preflight(url: string): 'opened' | 'blocked' | 'skipped';
  /** Opens `url` after a tap on a link or card; in an in-app browser it navigates in place. */
  open(url: string): 'opened' | 'blocked';
  /** An `instagram://extbrowser/` or `intent://` link to offer behind a tap, or null. */
  escapeHref(url: string): string | null;
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

/** The one source of system facts for fastfetch, uname, /proc, free, lscpu and locale. */
export interface SysInfo {
  snapshot(): SysSnapshot;
  /** The WebGL renderer string, probed lazily; null when unavailable. */
  gpu(): string | null;
  battery(): Promise<{ readonly level: number; readonly charging: boolean } | null>;
  storage(): Promise<{ readonly usage: number; readonly quota: number } | null>;
  /** The visitor's public IP address, labelled "Public IP"; null on failure. */
  publicIp(signal?: AbortSignal): Promise<string | null>;
}

// ── Appearance ─────────────────────────────────────────────────────────────────────────────

export interface ThemeInfo {
  readonly name: string;
  /** Hex colours for a swatch next to the name in completions and `theme ls`. */
  readonly background: string;
  readonly foreground: string;
}

export interface CathodeInfo {
  readonly name: string;
  readonly summary: string;
}

/** Theme and CRT state, over the stores. Commands reach appearance only through this. */
export interface Appearance {
  themes(): readonly ThemeInfo[];
  currentTheme(): string;
  /** Case-insensitive; false when no theme has that name. */
  setTheme(name: string): boolean;
  cathodeModes(): readonly CathodeInfo[];
  currentCathode(): string;
  setCathode(mode: string): boolean;
  /** Restores the default theme and the CRT default for this device. */
  resetDefaults(): void;
}
