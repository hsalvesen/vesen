// The command catalogue: every spec file under src/commands/<category>/<name>.ts, found at build
// time, plus any extra specs the caller hands in (the stand-ins tests run against). A spec file
// replaces an extra of the same name; any other clash of names or aliases is a mistake and
// throws (F034).

import { CommandRegistry } from '../shell/registry';
import type { CommandSpec } from '../shell/types';

// lib/ holds what the commands share, not commands. A `name.run.ts` holds the body of a command
// whose spec loads it lazily (`load: () => import('./name.run')`), with its long help as `doc`
// (description and man sections, which help fetches with the body), so it is not a spec file and
// stays out of the kernel's chunk; so does a `name.logos.ts`, art that a body loads in turn.
const modules = import.meta.glob<{ default?: CommandSpec }>(['./*/*.ts', '!./*/*.test.ts', '!./*/*.run.ts', '!./*/*.logos.ts', '!./lib/*.ts'], { eager: true });

/** The specs exported by default from the spec files, in path order. */
export function specFiles(): CommandSpec[] {
  return Object.keys(modules)
    .sort()
    .map((path) => modules[path]?.default)
    .filter((spec): spec is CommandSpec => spec !== undefined);
}

/**
 * The registry: the spec files, then each extra spec whose name no spec file has taken. Throws
 * when two spec files clash, or an extra clashes in part with a spec file (an alias).
 */
export function buildRegistry(extra: readonly CommandSpec[] = [], files: readonly CommandSpec[] = specFiles()): CommandRegistry {
  const registry = new CommandRegistry(files);
  for (const spec of extra) {
    if (registry.get(spec.name)?.name === spec.name) continue;
    registry.register(spec);
  }
  return registry;
}
