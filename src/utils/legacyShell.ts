// Migration only: what the shell needs from the legacy code in src/utils: the legacy commands as
// specs, through the DOM-free adapter (src/commands/legacy.ts), and the shim that lets them reach
// the VFS (src/utils/virtualFileSystem.ts). main.ts hands this to bootstrap, so the strictly
// typed app code never imports src/utils. Deleted with the adapter once the last command is
// ported.

import { createAppShell, type AppShell, type AppShellOptions } from '../app/shell';
import { LEGACY_NAMES, legacySpecs, type LegacyFn, type LegacyName, type LegacySource } from '../commands/legacy';
import { REPO_URL } from '../constants';
import type { Shell } from '../shell/index';
import type { CommandSpec, EnumValue } from '../shell/types';
import { cathodeModeInfo, crtQualities } from '../stores/cathode';
import { themes } from '../stores/theme';
import type { VirtualFile } from '../vfs/types';
import type { Vfs } from '../vfs/vfs';
import { commands, emailHref, legacyHelpHtml, setCommandCatalogue } from './commands';
import { LINKEDIN_URL } from './commands/system';
import { commandDescriptions } from './helpTexts';
import { commandHistory } from './legacyStores';
import { bindLegacyVfs, mirrorCwd, virtualFileSystem } from './virtualFileSystem';

export interface LegacyBindings {
  /** The legacy commands as specs. */
  readonly specs: CommandSpec[];
  /** The tree the legacy code walks, which the VFS fills. */
  readonly root: VirtualFile;
  /** Connects the legacy code to the built VFS and shell; returns a function that disconnects it. */
  bind(parts: { readonly vfs: Vfs; readonly shell: Shell }): () => void;
}

function legacyFunction(name: LegacyName): LegacyFn {
  const fn = commands[name];
  if (fn === undefined) throw new Error(`legacy command ${name} is missing from src/utils/commands.ts`);
  return fn;
}

export function legacySource(): LegacySource {
  const fns = Object.fromEntries(LEGACY_NAMES.map((name) => [name, legacyFunction(name)])) as Record<LegacyName, LegacyFn>;
  return {
    commands: fns,
    help: (name) => legacyHelpHtml(name),
    descriptions: commandDescriptions,
    opens: {
      whoami: () => LINKEDIN_URL,
      repo: () => REPO_URL,
      email: () => emailHref(),
    },
    themes: (): readonly EnumValue[] =>
      themes.map((theme) => ({ value: theme.name.toLowerCase(), summary: theme.name, swatch: theme.background })),
    cathodeModes: (): readonly EnumValue[] =>
      cathodeModeInfo.filter((info) => info.name !== 'off').map((info) => ({ value: info.name, summary: info.summary })),
    crtQualities: (): readonly EnumValue[] => crtQualities.map((quality) => ({ value: quality })),
  };
}

/** The legacy commands, and the hooks that keep the legacy code in step with the shell. */
export function legacyBindings(): LegacyBindings {
  return {
    specs: legacySpecs(legacySource()),
    root: virtualFileSystem,
    bind({ vfs, shell }) {
      bindLegacyVfs(vfs);
      // help, Tab and the suggestions list every registered command, ported ones included.
      setCommandCatalogue(() => shell.registry.names());
      const stops = [
        shell.cwd.subscribe((cwd) => mirrorCwd(cwd)),
        // A reset puts the seed back under the same cwd; the mirror resolves it again.
        vfs.onChange(() => mirrorCwd(shell.cwd.get())),
        shell.history.subscribe((entries) => commandHistory.set(entries.map((entry) => entry.line))),
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
