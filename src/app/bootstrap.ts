// The composition root (docs/plan/02-architecture-and-contracts.md): the one place the browser
// services are built and the stores are connected to the page. main.ts calls bootstrap() before
// it mounts the app; nothing else has side effects at import time.
import { get } from 'svelte/store';
import type { CommandOutput } from '../interfaces/command';
import { applyCathode } from '../platform/crt';
import { installChunkReload } from '../platform/chunkReload';
import { applyTheme } from '../platform/head';
import { decideTier, NO_SIGNALS, startPerf, type PerfSignals } from '../platform/perf';
import { applyRoles } from '../platform/theme-apply';
import { canonicalRedirect } from '../platform/hosts';
import { startMeasuring } from '../platform/measure';
import { startViewport } from '../platform/viewport';
import { createStorage, runMigrations } from '../services/storage';
import type { StorageService } from '../services/types';
import { cathode, cathodeModes, cathodeQuality, crtTier, DEFAULT_CATHODE_MODE, persistCathode } from '../stores/cathode';
import { history } from '../stores/history';
import { DEFAULT_THEME_NAME, persistTheme, theme, themes } from '../stores/theme';
import { markCurrentCathode, markCurrentTheme } from '../ui/legacy-highlights';
import { notice } from '../utils/notice';

export interface BootOptions {
  readonly window: Window;
  /** Identifies the running build: the entry chunk's URL, which changes with every deploy. */
  readonly build: string;
  /** The welcome banner that opens the transcript. */
  readonly banner: () => CommandOutput;
}

export interface Booted {
  readonly storage: StorageService;
  /** Disconnects the stores from storage and the page, and the chunk reload listener. */
  stop(): void;
}

/**
 * Prepares the page for the app. Returns null when the visitor is being sent to the canonical
 * origin, in which case nothing should mount.
 */
export function bootstrap({ window: win, build, banner }: BootOptions): Booted | null {
  // The apex and the two Firebase hostnames serve the same build; send visitors to the one
  // origin so storage and the prompt are the same everywhere.
  const canonical = canonicalRedirect(new URL(win.location.href));
  if (canonical) {
    win.location.replace(canonical);
    return null;
  }

  const storage = createStorage(win);
  runMigrations(storage, {
    themes: themes.map((t) => t.name),
    defaultTheme: DEFAULT_THEME_NAME,
    cathodeModes,
    defaultCathode: DEFAULT_CATHODE_MODE,
  });

  const doc = win.document;
  const root = doc.documentElement;

  // The CRT tier follows the quality setting and the device's own settings, which can change
  // while the page is open (reduced motion switched on, say).
  let signals: PerfSignals = NO_SIGNALS;
  const showCathode = () => {
    const decision = decideTier(signals, get(cathodeQuality));
    crtTier.set(decision);
    applyCathode(root, get(cathode), decision.tier);
  };

  const stops = [
    installChunkReload(win, storage.session, build, (message) => {
      history.update((entries) => [...entries, { command: '', outputs: [notice(message)] }]);
    }),
    persistTheme(storage.local),
    persistCathode(storage.local),
    // Both colour layers: the palette (--theme-*) and the roles (--role-*).
    theme.subscribe((value) => {
      applyTheme(doc, value);
      applyRoles(root, value);
      markCurrentTheme(doc, value.name);
    }),
    startPerf(win, (next) => {
      signals = next;
      showCathode();
    }),
    cathode.subscribe((mode) => {
      showCathode();
      markCurrentCathode(doc, mode);
    }),
    cathodeQuality.subscribe(showCathode),
    // The touch input's scale and the font's cell width, as CSS variables.
    startMeasuring(win),
    // The shell's height and position: the part of the page above the toolbars and keyboard.
    startViewport(win),
  ];

  history.set([{ command: 'banner', outputs: [banner()] }]);

  return {
    storage,
    stop: () => {
      for (const stop of stops) stop();
    },
  };
}

/**
 * Replaces whatever is in `target` with a plain-text explanation, for when the app cannot
 * start. It uses no styles, stores or components, any of which may be what failed.
 */
export function renderBootError(doc: Document, target: HTMLElement | null, error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  const message = doc.createElement('pre');
  message.setAttribute('role', 'alert');
  message.style.cssText = 'margin:0;padding:1rem;white-space:pre-wrap;font-family:monospace';
  message.textContent = `vesen: failed to start\n${detail}\n\nReload the page to try again.`;
  (target ?? doc.body).replaceChildren(message);
}
