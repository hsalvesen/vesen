// Builds the shell the app runs: the commands in the registry, the file system, and the
// transcript as the screen. The composition root (bootstrap.ts) passes in the browser services;
// tests pass in fakes.

import { buildRegistry } from '../commands/index';
import type { CommandOutput } from '../interfaces/command';
import { createAppearance } from '../services/appearance';
import { createClock } from '../services/clock';
import { createNet } from '../services/net';
import { createSysInfoStub } from '../services/sysinfo';
import type { Bell, Clipboard, Clock, KV, Net, Opener, SysInfo } from '../services/types';
import { createShell, type ScreenSink, type Shell, type ShellFs, type TerminalInfo } from '../shell/index';
import type { CommandSpec } from '../shell/types';
import { cathode, cathodeModeInfo } from '../stores/cathode';
import { commandHistory, history } from '../stores/history';
import { defaultTheme, theme, themes } from '../stores/theme';

export interface AppShellOptions {
  /** The welcome banner, which `reset` puts back. */
  readonly banner: () => CommandOutput;
  /** The file system: the legacy tree until the VFS lands. */
  readonly fs: ShellFs;
  /** Commands besides the spec files: the legacy table. */
  readonly specs?: readonly CommandSpec[];
  /** Keeps command history across reloads; null keeps it for the session. */
  readonly storage?: KV<'local'> | null;
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
  /** Disconnects the stores the shell keeps in step. */
  stop(): void;
}

/** The transcript as the shell's screen: each finished line becomes an entry. */
export function transcriptScreen(banner: () => CommandOutput): ScreenSink {
  return {
    commit({ line, blocks, screen }) {
      if (screen === 'clear') history.set([]);
      if (screen === 'reset') history.set([{ command: 'banner', outputs: [banner()] }]);
      if (screen === 'keep') history.update((entries) => [...entries, { command: line, outputs: [blocks] }]);
      else if (blocks.length > 0) history.update((entries) => [...entries, { command: line, echo: false, outputs: [blocks] }]);
    },
  };
}

export function createAppShell(options: AppShellOptions): AppShell {
  const shell = createShell({
    registry: buildRegistry(options.specs ?? []),
    fs: options.fs,
    storage: options.storage ?? null,
    net: options.net ?? createNet(),
    clock: options.clock ?? createClock(),
    sys: options.sys ?? createSysInfoStub(null),
    appearance: createAppearance({ theme, themes, defaultTheme, cathode, cathodeModes: cathodeModeInfo }),
    screen: transcriptScreen(options.banner),
    ...(options.terminal ? { terminal: options.terminal } : {}),
    ...(options.opener ? { opener: options.opener } : {}),
    ...(options.clipboard ? { clipboard: options.clipboard } : {}),
    ...(options.bell ? { bell: options.bell } : {}),
    ...(options.yieldToHost ? { yieldToHost: options.yieldToHost } : {}),
  });
  // The arrow keys and the legacy `history` read the shell's history through this store.
  const stop = shell.history.subscribe((entries) => commandHistory.set(entries.map((entry) => entry.line)));
  return { shell, stop };
}
