// Builds the shell the app runs: the commands in the registry, the VFS seeded from them with the
// visitor's saved files on top, and the transcript as the screen. The composition root
// (bootstrap.ts) passes in the browser services; tests pass in fakes.

import { buildRegistry } from '../commands/index';
import { outputBlocks, type CommandOutput } from '../interfaces/command';
import type { Block, Line } from '../output/model';
import { createAppearance } from '../services/appearance';
import { createClock } from '../services/clock';
import { createNet } from '../services/net';
import { createSysInfoStub } from '../services/sysinfo';
import type { Bell, Clipboard, Clock, KV, Net, Opener, SysInfo } from '../services/types';
import { createShell, type ScreenSink, type Shell, type TerminalInfo } from '../shell/index';
import type { CommandSpec } from '../shell/types';
import { cathode, cathodeModeInfo } from '../stores/cathode';
import { screen as appScreen, type ScreenStore } from '../stores/screen';
import { defaultTheme, theme, themes } from '../stores/theme';
import { GUEST } from '../vfs/identity';
import { createPersistence, type Persistence } from '../vfs/persist';
import { seedTree, seedVersion } from '../vfs/seed';
import type { VirtualFile } from '../vfs/types';
import { Vfs } from '../vfs/vfs';

/** Run at boot, quietly, as a login shell reads them: aliases such as ll, and exports (F072). */
export const BOOT_FILES = ['/etc/profile', `${GUEST.home}/.bashrc`] as const;

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
  /** The app's version, for /etc/os-release; defaults to the build's. */
  readonly version?: string;
  /** Where entries go; the app's transcript by default. */
  readonly screen?: ScreenStore;
  readonly net?: Net;
  readonly clock?: Clock;
  readonly sys?: SysInfo;
  readonly bell?: Bell;
  readonly opener?: Opener;
  readonly clipboard?: Clipboard;
  readonly terminal?: TerminalInfo;
  readonly yieldToHost?: () => Promise<void>;
}

export interface AppShell {
  readonly shell: Shell;
  readonly vfs: Vfs;
  readonly persistence: Persistence;
  /** Sources /etc/profile and ~/.bashrc, then starts saving changes under ~. */
  boot(): Promise<void>;
  /** Disconnects the stores the shell keeps in step, and stops saving. */
  stop(): void;
}

/** The banner entry, as boot and `reset` show it, typed at `prompt`. */
export function bannerEntry(screen: ScreenStore, banner: () => CommandOutput, prompt: Line): void {
  screen.push({ prompt, line: 'banner', blocks: outputBlocks(banner()), origin: 'boot', status: 0 });
}

/** The transcript as the shell's screen: each finished line becomes an entry. */
export function transcriptScreen(screen: ScreenStore, banner: () => CommandOutput, renderPrompt: () => Line): ScreenSink {
  return {
    commit({ line, blocks, screen: action, prompt: typedAt, status, interrupted, origin, startedAt, endedAt }) {
      if (action === 'clear') screen.clear();
      if (action === 'reset') {
        screen.clear();
        bannerEntry(screen, banner, renderPrompt());
      }
      const state = interrupted ? 'interrupted' : 'done';
      if (action === 'keep') screen.push({ prompt: typedAt, line, blocks, status, state, origin, startedAt, endedAt });
      // After a clear, the output stays and the prompt line it was typed at does not.
      else if (blocks.length > 0) screen.push({ prompt: null, line, blocks, status, state, origin, startedAt, endedAt });
    },
  };
}

/** A dim line on the screen, with no prompt: the one notice that storage is unavailable. */
function noticeBlocks(message: string): Block[] {
  return [{ type: 'lines', stream: 'stdout', lines: [[{ text: message, style: { fg: 'muted' } }]] }];
}

export function createAppShell(options: AppShellOptions): AppShell {
  const registry = buildRegistry(options.specs ?? []);
  const clock = options.clock ?? createClock();
  const sys = options.sys ?? createSysInfoStub(null);
  const screen = options.screen ?? appScreen;
  const storage = options.storage ?? null;
  const version = options.version ?? __APP_VERSION__;
  const commands = registry.list({ includeHidden: true }).map(({ name, summary }) => ({ name, summary }));
  const seed = (): VirtualFile => seedTree({ version, commands, timeZone: clock.timeZone() });

  const vfs = new Vfs({
    seed,
    ...(options.root ? { root: options.root } : {}),
    now: () => clock.now(),
    context: () => ({ now: clock.now(), bootTime: clock.bootTime(), sys: sys.snapshot(), random: () => clock.random() }),
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
    appearance: createAppearance({ theme, themes, defaultTheme, cathode, cathodeModes: cathodeModeInfo }),
    screen: transcriptScreen(screen, options.banner, renderPrompt),
    ...(options.terminal ? { terminal: options.terminal } : {}),
    ...(options.opener ? { opener: options.opener } : {}),
    ...(options.clipboard ? { clipboard: options.clipboard } : {}),
    ...(options.bell ? { bell: options.bell } : {}),
    ...(options.yieldToHost ? { yieldToHost: options.yieldToHost } : {}),
  });
  const built = shell;
  const unbind = options.bind?.({ vfs, shell: built }) ?? (() => {});

  return {
    shell: built,
    vfs,
    persistence,
    async boot() {
      for (const file of BOOT_FILES) await built.source(file, { quiet: true });
      persistence.start();
    },
    stop() {
      unbind();
      persistence.stop();
    },
  };
}
