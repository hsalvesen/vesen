// The command catalogue: every spec file under src/commands/<category>/<name>.ts, found at build
// time, plus the legacy table while the old commands are being ported. A spec file replaces the
// legacy command of the same name, so a port is one new file; any other clash of names or
// aliases is a mistake and throws (F034).

import { CommandRegistry } from '../shell/registry';
import type { CommandSpec } from '../shell/types';

// lib/ holds what the commands share, not commands. A `name.run.ts` holds the body of a command
// whose spec loads it lazily (`load: () => import('./name.run')`), so it is not a spec file and
// stays out of the kernel's chunk.
const modules = import.meta.glob<{ default?: CommandSpec }>(['./*/*.ts', '!./*/*.test.ts', '!./*/*.run.ts', '!./lib/*.ts'], { eager: true });

/** The specs exported by default from the spec files, in path order. */
export function specFiles(): CommandSpec[] {
  return Object.keys(modules)
    .sort()
    .map((path) => modules[path]?.default)
    .filter((spec): spec is CommandSpec => spec !== undefined);
}

/**
 * The registry: the spec files, then each legacy spec whose name and aliases no spec file has
 * taken. Throws when two spec files clash, or a legacy spec clashes in part with a spec file.
 */
export function buildRegistry(legacy: readonly CommandSpec[] = [], files: readonly CommandSpec[] = specFiles()): CommandRegistry {
  const registry = new CommandRegistry(files);
  for (const spec of legacy) {
    if (registry.get(spec.name)?.name === spec.name) continue;
    registry.register(spec);
  }
  return registry;
}
