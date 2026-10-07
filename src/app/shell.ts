// Builds the shell the app runs: the commands in the registry, the VFS seeded from them with the
// visitor's saved files on top, and the transcript as the screen. The composition root
// (bootstrap.ts) passes in the browser services; tests pass in fakes.

import { buildRegistry } from '../commands/index';
import { forgetWeather, provideWeather, type WeatherLoader } from '../commands/lib/weather';
import type { CommandOutput } from '../interfaces/command';
import type { Block, Line } from '../output/model';
import { createAppearance } from '../services/appearance';
import { createClock } from '../services/clock';
import { createNet } from '../services/net';
import { STORAGE_KEYS } from '../services/storage-keys';
import { createSysInfo, type SysHost } from '../services/sysinfo';
import type { Bell, Clipboard, Clock, KV, Net, Opener, SysInfo } from '../services/types';
import { loadArith } from '../shell/expand';
import { createShell, type Shell, type TerminalInfo } from '../shell/index';
import { loginFiles } from '../shell/session';
import type { CommandSpec } from '../shell/types';
import { cathode, cathodeModeInfo, cathodeQuality, crtQualities, crtTier } from '../stores/cathode';
import { hardwareKeyboard, keyBar, keyBarModes } from '../stores/prefs';
import { screen as appScreen, type ScreenStore } from '../stores/screen';
import { defaultTheme, theme, themes } from '../stores/theme';
import { GUEST } from '../vfs/identity';
import { createPersistence, type Persistence } from '../vfs/persist';
import { seedTree, seedVersion } from '../vfs/seed';
import type { VirtualFile } from '../vfs/types';
import { Vfs } from '../vfs/vfs';
import { transcriptScreen, type FrameScheduler } from './transcript';

export { bannerEntry, transcriptScreen } from './transcript';

/** Run at boot, quietly, as a login shell reads them: aliases such as ll, and exports (F072). */
export const BOOT_FILES = loginFiles(GUEST.home);

/** Said when the last load never finished reading ~/.bashrc, so this one skips it. */
export const SAFE_MODE_NOTICE =
  "vesen: ~/.bashrc did not finish loading last time, so it was skipped. Fix it with 'cat ~/.bashrc', run it with 'source ~/.bashrc', or put the original files back with 'reset'.";

export interface AppShellOptions {
  /** The welcome banner, which `reset` puts back. */
  readonly banner: () => CommandOutput;
  /** Commands besides the spec files: the legacy table. */
  readonly specs?: readonly CommandSpec[];
  /** The object the VFS keeps its tree in; the legacy shim hands in its own. */
  readonly root?: VirtualFile;
  /** Connects the legacy code to the VFS and the shell; returns a function that disconnects it. */
  readonly bind?: (parts: { readonly vfs: Vfs; readonly shell: Shell }) => () => void;
  /** Keeps files under ~ and command history across reloads; null keeps them for the session. */
  readonly storage?: KV<'local'> | null;
  /**
   * The tab's session storage, for boot's safe mode: a marker set while ~/.bashrc is read, which
   * a load that finds it still set takes to mean the last one never finished, and skips it.
   */
  readonly sessionStorage?: KV<'session'> | null;
  /** The app's version, for /etc/os-release; defaults to the build's. */
  readonly version?: string;
  /** Where entries go; the app's transcript by default. */
  readonly screen?: ScreenStore;
  readonly net?: Net;
  readonly clock?: Clock;
  readonly sys?: SysInfo;
  /** Where the system facts are read from when `sys` is not given: the page's window. */
  readonly sysHost?: SysHost | null;
  /** The page's recent errors (platform/errors.ts), for debug report. */
  readonly errors?: () => readonly string[];
  readonly bell?: Bell;
  readonly opener?: Opener;
  readonly clipboard?: Clipboard;
  readonly terminal?: TerminalInfo;
  readonly yieldToHost?: () => Promise<void>;
  /** When a running line's output is drawn; the next animation frame by default. */
  readonly frame?: FrameScheduler;
  /**
   * Builds the page's weather service the first time weather runs (bootstrap gives the browser's;
   * tests give one over fixtures). Without it, weather says there is none.
   */
  readonly weather?: WeatherLoader;
}

export interface AppShell {
  readonly shell: Shell;
  readonly vfs: Vfs;
  readonly persistence: Persistence;
  /** Sources /etc/profile and ~/.bashrc, then starts saving changes under ~. */
  boot(): Promise<void>;
  /**
   * Loads the bodies of the commands that load lazily, and the parts of the kernel that do, so
   * none of them waits for the network the first time it runs. Settles when all have loaded or
   * failed.
   */
  prefetch(): Promise<void>;
  /** Disconnects the stores the shell keeps in step, and stops saving. */
  stop(): void;
}

/** A dim line on the screen, with no prompt: the one notice that storage is unavailable. */
function noticeBlocks(message: string): Block[] {
  return [{ type: 'lines', stream: 'stdout', lines: [[{ text: message, style: { fg: 'muted' } }]] }];
}

export function createAppShell(options: AppShellOptions): AppShell {
  const registry = buildRegistry(options.specs ?? []);
  provideWeather(options.weather ?? null);
  const clock = options.clock ?? createClock();
  const sys = options.sys ?? createSysInfo(options.sysHost ?? null, options.errors ? { errors: options.errors } : {});
  const screen = options.screen ?? appScreen;
  const storage = options.storage ?? null;
  const version = options.version ?? __APP_VERSION__;
  const commands = registry.list({ includeHidden: true }).map(({ name, summary }) => ({ name, summary }));
  const seed = (): VirtualFile => seedTree({ version, commands, timeZone: clock.timeZone() });

  const vfs = new Vfs({
    seed,
    ...(options.root ? { root: options.root } : {}),
    now: () => clock.now(),
    // /proc/uptime counts from when the page started, as fastfetch's Uptime does.
    context: () => {
      const now = clock.now();
      const up = sys.uptimeMs();
      return { now, bootTime: up > 0 ? now - up : clock.bootTime(), sys: sys.snapshot(), random: () => clock.random() };
    },
  });
  const persistence = createPersistence({
    vfs,
    storage,
    seed,
    seedVersion: seedVersion(seed()),
    now: () => clock.now(),
    onNotice: (message) => screen.push({ prompt: null, line: '', blocks: noticeBlocks(message), origin: 'boot' }),
  });
  persistence.load();

  let shell: Shell | undefined;
  const renderPrompt = (): Line => shell?.renderPrompt() ?? [];
  shell = createShell({
    registry,
    fs: vfs,
    storage,
    net: options.net ?? createNet(),
    clock,
    sys,
    appearance: createAppearance({
      theme,
      themes,
      defaultTheme,
      cathode,
      cathodeModes: cathodeModeInfo,
      cathodeQuality,
      cathodeQualities: crtQualities,
      crtTier,
      keyBar,
      keyBarModes,
      hardwareKeyboard,
    }),
    screen: transcriptScreen(screen, options.banner, renderPrompt, options.frame ? { frame: options.frame } : {}),
    ...(options.terminal ? { terminal: options.terminal } : {}),
    ...(options.opener ? { opener: options.opener } : {}),
    ...(options.clipboard ? { clipboard: options.clipboard } : {}),
    ...(options.bell ? { bell: options.bell } : {}),
    ...(options.yieldToHost ? { yieldToHost: options.yieldToHost } : {}),
    onReset: forgetWeather,
  });
  const built = shell;
  const unbind = options.bind?.({ vfs, shell: built }) ?? (() => {});

  return {
    shell: built,
    vfs,
    persistence,
    async boot() {
      const marker = options.sessionStorage ?? null;
      const key = STORAGE_KEYS.boot.key;
      // Still set: the last load froze or crashed while reading ~/.bashrc, so this one skips it.
      const safeMode = marker?.get(key) !== null && marker !== null;
      marker?.set(key, String(clock.now()));
      for (const file of BOOT_FILES) {
        if (safeMode && file !== '/etc/profile') {
          screen.push({ prompt: null, line: '', blocks: noticeBlocks(SAFE_MODE_NOTICE), origin: 'boot' });
          continue;
        }
        await built.source(file, { quiet: true });
      }
      marker?.remove(key);
      persistence.start();
    },
    async prefetch() {
      const loads: Promise<unknown>[] = registry.list({ includeHidden: true }).flatMap((spec) => (spec.load === undefined ? [] : [spec.load()]));
      // And what the kernel itself loads on first use: $(( )) arithmetic.
      loads.push(loadArith());
      await Promise.allSettled(loads);
    },
    stop() {
      unbind();
      persistence.stop();
    },
  };
}
