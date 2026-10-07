// The composition root (docs/plan/02-architecture-and-contracts.md): the one place the browser
// services are built and the stores are connected to the page. main.ts calls bootstrap() before
// it mounts the app; nothing else has side effects at import time.
import { get } from 'svelte/store';
import { outputBlocks, type CommandOutput } from '../interfaces/command';
import { out } from '../output/model';
import { applyCathode } from '../platform/crt';
import { installChunkReload } from '../platform/chunkReload';
import { applyTheme } from '../platform/head';
import { coarsePointer, readLinkEnv } from '../platform/env';
import { installErrorBuffer } from '../platform/errors';
import { decideTier, NO_SIGNALS, startPerf, type PerfSignals } from '../platform/perf';
import { applyRoles } from '../platform/theme-apply';
import { canonicalRedirect } from '../platform/hosts';
import { startMeasuring, transcriptColumns } from '../platform/measure';
import { startViewport } from '../platform/viewport';
import { createBell } from '../services/bell';
import { createClipboard } from '../services/clipboard';
import { provideMarket } from '../services/market/port';
import { createOpener } from '../services/opener';
import { pendingSnapshot, type SessionSnapshot } from '../services/session-snapshot';
import { createStorage, runMigrations } from '../services/storage';
import type { Clipboard, Opener, StorageService } from '../services/types';
import type { Shell, ShellPort, TerminalInfo } from '../shell/index';
import { promptLine } from '../shell/prompt';
import type { CommandSpec } from '../shell/types';
import { cathode, cathodeModes, cathodeQuality, crtTier, DEFAULT_CATHODE_MODE, persistCathode } from '../stores/cathode';
import { screen } from '../stores/screen';
import { columns } from '../stores/term';
import { persistPrefs } from '../stores/prefs';
import { DEFAULT_THEME_NAME, persistTheme, theme, themes } from '../stores/theme';
import { visibleArea } from '../stores/viewport';
import { loadLegacyShim } from '../ui/legacy-block';
import { loadRichBlock } from '../ui/rich-block';
import { playBeep } from '../utils/beep';
import { GUEST } from '../vfs/identity';
import type { VirtualFile } from '../vfs/types';
import type { Vfs } from '../vfs/vfs';
import { lazyShell } from './lazy-shell';
import { transcriptScreen } from './transcript';

export interface BootOptions {
  readonly window: Window;
  /** Identifies the running build: the entry chunk's URL, which changes with every deploy. */
  readonly build: string;
  /** The welcome banner that opens the transcript. */
  readonly banner: () => CommandOutput;
  /**
   * Migration only: loads legacy commands and the shim over the VFS. Every command is a spec now,
   * so main.ts hands in none and the shell has only the spec files; the option goes with the
   * adapter in the clean-up after the last port.
   */
  readonly legacy?: () => Promise<LegacyParts>;
}

/** The legacy commands as specs, and how the legacy code reaches the VFS and the shell. */
export interface LegacyParts {
  readonly specs: readonly CommandSpec[];
  /** The tree the legacy code walks, which the VFS fills. */
  readonly root: VirtualFile;
  readonly bind: (parts: { readonly vfs: Vfs; readonly shell: Shell }) => () => void;
}

export interface Booted {
  readonly storage: StorageService;
  /** The shell the terminal runs lines through; its kernel loads just after the first paint. */
  readonly shell: ShellPort;
  /** Links under the in-app browser policy, for taps on cards and links. */
  readonly opener: Opener;
  readonly clipboard: Clipboard;
  /**
   * After Back, the snapshot the screen is being restored from: its entries and folder come back
   * here, and the UI puts back the line and the scroll position. Null for a fresh start, and the
   * promise gives null when there was nothing usable to restore.
   */
  readonly restored: Promise<SessionSnapshot | null> | null;
  /** Disconnects the stores from storage and the page, and the chunk reload listener. */
  stop(): void;
}

/**
 * Prepares the page for the app. Returns null when the visitor is being sent to the canonical
 * origin, in which case nothing should mount.
 */
export function bootstrap({ window: win, build, banner, legacy }: BootOptions): Booted | null {
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
  // What went wrong recently, for debug report; first, so it hears about everything after.
  const errors = installErrorBuffer(win);
  const env = readLinkEnv(win);
  const opener = createOpener(win, env);
  const clipboard = createClipboard(win);
  // stock's market client, over this browser's storage; its chunk loads with the first quote.
  provideMarket(() => import('../services/market/client').then(({ createMarketClient }) => createMarketClient({ storage: storage.local })));

  // The CRT tier follows the quality setting and the device's own settings, which can change
  // while the page is open (reduced motion switched on, say).
  let signals: PerfSignals = NO_SIGNALS;
  const showCathode = () => {
    const decision = decideTier(signals, get(cathodeQuality));
    crtTier.set(decision);
    applyCathode(root, get(cathode), decision.tier);
  };

  const stops = [
    () => errors.stop(),
    () => provideMarket(null),
    installChunkReload(win, storage.session, build, (message) => {
      // A lines block, which the first paint's chunk draws itself: this build's other chunks are
      // the ones that just failed to load.
      screen.push({ prompt: shell.renderPrompt(), line: '', blocks: [out.text(message, { fg: 'warn', bold: true })] });
    }),
    persistTheme(storage.local),
    persistCathode(storage.local),
    persistPrefs(storage.local),
    // Both colour layers: the palette (--theme-*) and the roles (--role-*).
    theme.subscribe((value) => {
      applyTheme(doc, value);
      applyRoles(root, value);
    }),
    startPerf(win, (next) => {
      signals = next;
      showCathode();
    }),
    cathode.subscribe(showCathode),
    cathodeQuality.subscribe(showCathode),
    // The touch input's scale and the font's cell width, as CSS variables.
    startMeasuring(win),
    // The shell's height and position: the part of the page above the toolbars and keyboard.
    // The phone dock lays itself out by the same height.
    startViewport(win, { onChange: (area) => visibleArea.set(area) }),
    // The terminal's width in cells, for the prompt.
    trackColumns(win),
  ];

  // The kernel loads now, in its own chunk, so it is not in the way of the first paint; the
  // services only it uses (net, clock, system facts) are built in that chunk (app/shell.ts).
  const services = {
    banner,
    storage: storage.local,
    sessionStorage: storage.session,
    bell: createBell({ play: playBeep }),
    opener,
    clipboard,
    terminal: terminalInfo(win, env.inApp),
  };
  let stopped = false;
  const shell = lazyShell(
    async () => {
      // What the first help or ls draws with comes down beside the kernel, rather than after the
      // line has run: the help text and the layout-block renderer, and ls's body once the kernel
      // is here.
      void import('../shell/help').catch(() => {});
      void loadRichBlock().catch(() => {});
      const [{ createAppShell }, parts] = await Promise.all([import('./shell'), legacy?.() ?? Promise.resolve(null)]);
      const app = createAppShell({
        ...services,
        specs: parts?.specs ?? [],
        ...(parts ? { root: parts.root, bind: parts.bind } : {}),
        sysHost: win,
        errors: () => errors.recent(),
        // The weather service, its sources and the device's location load when weather first runs.
        weather: () =>
          Promise.all([import('../services/weather/service'), import('../platform/geolocation')]).then(
            ([{ createWeatherService }, { createGeolocator }]) =>
              createWeatherService({ kv: storage.local, geolocation: createGeolocator(win) }),
          ),
      });
      // A page put away or closed saves what is waiting to be saved.
      const flush = (): void => app.persistence.flush();
      win.addEventListener('pagehide', flush);
      const stop = (): void => {
        win.removeEventListener('pagehide', flush);
        app.stop();
      };
      if (stopped) stop();
      else stops.push(stop);
      // ls's body through its spec, so it shares the kernel's chunks rather than splitting them.
      void app.shell.registry.get('ls')?.load?.().catch(() => {});
      // ~/.bashrc first, so a line typed while the chunk loaded already has ll and la.
      await app.boot();
      // Then, once the page is idle, the commands that load lazily, so none waits on first use,
      // and the shim the legacy commands' HTML is drawn through. Not on Data Saver or mobile
      // data, where each command's code comes with its first run instead (app.prefetch).
      idle(win, () => {
        void app.prefetch().then((fetched) => {
          // The weather card too, so the first card draws at once rather than after its plain text.
          if (fetched) void import('../ui/components/registry').then(({ loadComponent }) => loadComponent('weather-card')).catch(() => {});
        });
        if (parts !== null) loadLegacyShim().catch(() => {});
      });
      return app.shell;
    },
    {
      // A line typed while the chunk loads shows at once; the kernel carries on with its entry.
      // If the chunk never arrives, the line says so there.
      screen: transcriptScreen(screen, banner, () => shell.renderPrompt()),
      columns: () => get(columns),
    },
  );

  // Back from a link opened in the same view (an in-app browser) brings the screen back as it
  // was, through a chunk loaded only then; anything else starts with the banner.
  const showBanner = (): void => {
    screen.push({
      prompt: promptLine({ cwd: GUEST.home, status: 0, columns: get(columns) }),
      line: 'banner',
      blocks: outputBlocks(banner()),
      origin: 'boot',
      status: 0,
    });
  };
  screen.clear();
  const pending = pendingSnapshot(win, storage.session);
  let restored: Promise<SessionSnapshot | null> | null = null;
  if (pending === null) showBanner();
  else {
    restored = import('../services/session-restore')
      .then(({ reviveSnapshot }) => reviveSnapshot(pending, Date.now()))
      .catch(() => null)
      .then((snapshot) => {
        if (snapshot === null || snapshot.entries.length === 0) {
          showBanner();
          return null;
        }
        // Anything typed while the chunk loaded stays, after what comes back.
        screen.replace([...snapshot.entries.map((entry) => ({ ...entry, origin: 'boot' as const })), ...screen.entries()]);
        if (snapshot.cwd !== '') shell.restoreCwd(snapshot.cwd);
        return snapshot;
      });
  }

  return {
    storage,
    shell,
    opener,
    clipboard,
    restored,
    stop: () => {
      stopped = true;
      for (const stop of stops) stop();
    },
  };
}

/** Runs `work` when the browser is idle, or after a second where it cannot say. */
function idle(win: Window, work: () => void): void {
  const request = (win as Window & { requestIdleCallback?: (run: () => void, options?: { timeout: number }) => number }).requestIdleCallback;
  if (typeof request === 'function') request.call(win, work, { timeout: 3000 });
  else win.setTimeout(work, 1000);
}

/** Keeps the columns store at the transcript's width, measured at most once a frame. */
function trackColumns(win: Window): () => void {
  let frame = 0;
  const measure = (): void => {
    frame = 0;
    columns.set(transcriptColumns(win));
  };
  const schedule = (): void => {
    if (frame === 0) frame = win.requestAnimationFrame(measure);
  };
  measure();
  win.addEventListener('resize', schedule);
  // Once the app has mounted, <main> can be measured rather than estimated.
  schedule();
  return () => {
    win.cancelAnimationFrame(frame);
    win.removeEventListener('resize', schedule);
  };
}

/** The terminal as the shell sees it: its size in cells, touch, and the in-app browser. */
function terminalInfo(win: Window, inApp: TerminalInfo['inApp']): TerminalInfo {
  return {
    size: () => ({
      cols: transcriptColumns(win),
      rows: Math.max(10, Math.floor((win.visualViewport?.height ?? win.innerHeight) / 20)),
    }),
    touch: coarsePointer(win),
    inApp,
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
