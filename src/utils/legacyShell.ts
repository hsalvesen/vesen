// Migration only: the shim that let the legacy commands reach the VFS
// (src/utils/virtualFileSystem.ts). Every command is now a spec, so the app no longer loads this;
// tests that mount the terminal over the legacy tree still use it. Deleted with the adapter in the
// clean-up that follows the last port.

import { createAppShell, type AppShell, type AppShellOptions } from '../app/shell';
import type { Shell } from '../shell/index';
import type { CommandSpec } from '../shell/types';
import type { VirtualFile } from '../vfs/types';
import type { Vfs } from '../vfs/vfs';
import { bindLegacyVfs, mirrorCwd, virtualFileSystem } from './virtualFileSystem';

export interface LegacyBindings {
  /** The legacy commands as specs: none now. */
  readonly specs: CommandSpec[];
  /** The tree the legacy code walks, which the VFS fills. */
  readonly root: VirtualFile;
  /** Connects the legacy code to the built VFS and shell; returns a function that disconnects it. */
  bind(parts: { readonly vfs: Vfs; readonly shell: Shell }): () => void;
}

/** The hooks that keep the legacy tree in step with the shell. */
export function legacyBindings(): LegacyBindings {
  return {
    specs: [],
    root: virtualFileSystem,
    bind({ vfs, shell }) {
      bindLegacyVfs(vfs);
      const stops = [
        shell.cwd.subscribe((cwd) => mirrorCwd(cwd)),
        // A reset puts the seed back under the same cwd; the mirror resolves it again.
        vfs.onChange(() => mirrorCwd(shell.cwd.get())),
      ];
      return () => {
        for (const stop of stops) stop();
      };
    },
  };
}

/** The app's shell over the legacy commands, built at once: for tests that mount the terminal. */
export function legacyAppShell(options: Omit<AppShellOptions, 'specs' | 'root' | 'bind'> & { readonly specs?: readonly CommandSpec[] }): AppShell {
  const legacy = legacyBindings();
  return createAppShell({ ...options, root: legacy.root, bind: legacy.bind, specs: [...(options.specs ?? []), ...legacy.specs] });
}
