// Migration only: what the shell needs from the legacy code in src/utils: the 26 commands as
// specs, through the DOM-free adapter (src/commands/legacy.ts), and the legacy file tree behind
// the Vfs contract (src/vfs/legacy-tree.ts). main.ts hands this to bootstrap, so the strictly
// typed app code never imports src/utils. Deleted with the adapter once the last command is
// ported and the VFS has landed.

import { createAppShell, type AppShell, type AppShellOptions } from '../app/shell';
import { LEGACY_NAMES, legacySpecs, type LegacyFn, type LegacyName, type LegacySource } from '../commands/legacy';
import { REPO_URL } from '../constants';
import type { CommandSpec, EnumValue } from '../shell/types';
import { cathodeModeInfo, crtQualities } from '../stores/cathode';
import { themes } from '../stores/theme';
import { addGuestHome, LegacyTreeFs } from '../vfs/legacy-tree';
import { commands, emailHref, legacyHelpHtml } from './commands';
import { LINKEDIN_URL } from './commands/system';
import { commandDescriptions } from './helpTexts';
import { createInitialFileSystem, currentPath, virtualFileSystem } from './virtualFileSystem';

export interface LegacyBindings {
  /** The 26 legacy commands as specs. */
  readonly specs: CommandSpec[];
  /** The legacy file tree, with /home/guest as the visitor's home. */
  readonly fs: LegacyTreeFs;
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

/** The legacy commands and file tree, ready for createAppShell. */
export function legacyBindings(): LegacyBindings {
  // The visitor's home is /home/guest; until the VFS lands it shares the legacy /home/user.
  addGuestHome(virtualFileSystem);
  const fs = new LegacyTreeFs({
    root: virtualFileSystem,
    cwd: currentPath,
    restore: () => {
      virtualFileSystem.children = createInitialFileSystem().children;
      addGuestHome(virtualFileSystem);
    },
  });
  return { specs: legacySpecs(legacySource()), fs };
}

/** The app's shell over the legacy commands, built at once: for tests that mount the terminal. */
export function legacyAppShell(options: Omit<AppShellOptions, 'fs' | 'specs'> & { readonly specs?: readonly CommandSpec[] }): AppShell {
  const legacy = legacyBindings();
  return createAppShell({ ...options, fs: legacy.fs, specs: [...(options.specs ?? []), ...legacy.specs] });
}
