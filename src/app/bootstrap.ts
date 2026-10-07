// The composition root (docs/plan/02-architecture-and-contracts.md): the one place the browser
// services are built and the stores are connected to the page. main.ts calls bootstrap() before
// it mounts the app; nothing else has side effects at import time.
import { get } from 'svelte/store';
import { outputBlocks, type CommandOutput } from '../interfaces/command';
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
import { createOpener } from '../services/opener';
import { pendingSnapshot, type SessionSnapshot } from '../services/session-snapshot';
import { createStorage, runMigrations } from '../services/storage';
import { createSysInfoStub } from '../services/sysinfo';
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
import { markCurrentThemeName } from '../ui/legacy-highlights';
import { loadRichBlock } from '../ui/rich-block';
import { playBeep } from '../utils/beep';
import { notice } from '../utils/notice';
import { GUEST } from '../vfs/identity';
import type { VirtualFile } from '../vfs/types';
import type { Vfs } from '../vfs/vfs';
import { lazyShell } from './lazy-shell';

export interface BootOptions {
  readonly window: Window;
  /** Identifies the running build: the entry chunk's URL, which changes with every deploy. */
  readonly build: string;
  /** The welcome banner that opens the transcript. */
  readonly banner: () => CommandOutput;
  /**
   * Migration only: loads the legacy commands and the shim over the VFS
   * (src/utils/legacyShell.ts). main.ts hands it in, so this strictly typed module never imports
   * src/utils. Without it the shell has only the spec files.
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
    installChunkReload(win, storage.session, build, (message) => {
      screen.push({ prompt: shell.renderPrompt(), line: '', blocks: outputBlocks(notice(message)) });
    }),
    persistTheme(storage.local),
    persistCathode(storage.local),
    persistPrefs(storage.local),
    // Both colour layers: the palette (--theme-*) and the roles (--role-*).
    theme.subscribe((value) => {
      applyTheme(doc, value);
      applyRoles(root, value);
      markCurrentThemeName(doc, value.name);
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

  // The kernel loads now, in its own chunk, so it is not in the way of the first paint.
  const services = {
    banner,
    storage: storage.local,
    sessionStorage: storage.session,
    bell: createBell({ play: playBeep }),
    opener,
    clipboard,
    terminal: terminalInfo(win, env.inApp),
    sys: createSysInfoStub(win, { errors: () => errors.recent() }),
  };
  let stopped = false;
  const shell = lazyShell(
    async () => {
      // What the first help or ls draws with comes down beside the kernel, rather than after the
      // line has run: the help text and the layout-block renderer.
      void import('../shell/help').catch(() => {});
      void loadRichBlock().catch(() => {});
      const [{ createAppShell }, { createNet }, { createClock }, parts] = await Promise.all([
        import('./shell'),
        import('../services/net'),
        import('../services/clock'),
        legacy?.() ?? Promise.resolve(null),
      ]);
      const app = createAppShell({
        ...services,
        specs: parts?.specs ?? [],
        ...(parts ? { root: parts.root, bind: parts.bind } : {}),
        net: createNet(),
        clock: createClock(),
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
      // ~/.bashrc first, so a line typed while the chunk loaded already has ll and la.
      await app.boot();
      // Then, once the page is idle, the commands that load lazily, so none waits on first use.
      idle(win, () => void app.prefetch());
      return app.shell;
    },
    {
      // Only if the kernel's chunk never arrives: the line that waited for it says so.
      screen: {
        commit: ({ line, blocks, prompt, status, origin, startedAt, endedAt }) =>
          screen.push({ prompt, line, blocks, status, origin, startedAt, endedAt }),
      },
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
