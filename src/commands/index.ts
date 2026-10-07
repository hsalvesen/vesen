// The command catalogue: every spec file under src/commands/<category>/<name>.ts, found at build
// time and registered with the kernel, then the specs under src/commands/more/<category>/, which
// load after it in a chunk of their own, plus any extra specs the caller hands in (the stand-ins
// tests run against). A spec file replaces an extra of the same name; any other clash of names
// or aliases is a mistake and throws (F034).

import { CommandRegistry } from '../shell/registry';
import type { CatalogueLoader, CommandSpec } from '../shell/types';

// lib/ holds what the commands share, not commands. A `name.run.ts` holds the body of a command
// whose spec loads it lazily (`load: () => import('./name.run')`), with its long help as `doc`
// (description and man sections, which help fetches with the body), so it is not a spec file and
// stays out of the kernel's chunk; so does a `name.logos.ts`, art that a body loads in turn.
// more/ is the catalogue, which loadCatalogue() brings in.
const modules = import.meta.glob<{ default?: CommandSpec }>(['./*/*.ts', '!./*/*.test.ts', '!./*/*.run.ts', '!./*/*.logos.ts', '!./lib/*.ts', '!./more/**'], {
  eager: true,
});

/** The core specs: the spec files the kernel's chunk carries, in path order. */
export function specFiles(): CommandSpec[] {
  return Object.keys(modules)
    .sort()
    .map((path) => modules[path]?.default)
    .filter((spec): spec is CommandSpec => spec !== undefined);
}

/**
 * The catalogue's specs (src/commands/more/<category>/<name>.ts), from the one chunk they share
 * (more/catalogue.ts). Nothing of theirs is in the kernel's chunk: the registry asks for them
 * once the page is idle, or as soon as a name it does not have is looked up.
 */
export const loadCatalogue: CatalogueLoader = () => import('./more/catalogue').then(({ catalogueSpecs }) => catalogueSpecs());

/** Every spec file, the kernel's and the catalogue's, for the checks that run over them all. */
export async function allSpecFiles(): Promise<CommandSpec[]> {
  return [...specFiles(), ...(await loadCatalogue())];
}

/**
 * The registry: the spec files, then each extra spec whose name no spec file has taken, with the
 * catalogue to come (none with `catalogue: null`). Throws when two spec files clash, or an extra
 * clashes in part with a spec file (an alias). A catalogue spec replaces an extra of its name
 * when it arrives; any other clash fails that load (src/commands/index.test.ts checks there is
 * none).
 */
export function buildRegistry(
  extra: readonly CommandSpec[] = [],
  files: readonly CommandSpec[] = specFiles(),
  catalogue: CatalogueLoader | null = loadCatalogue,
): CommandRegistry {
  const registry = new CommandRegistry(files, { catalogue });
  for (const spec of extra) {
    if (registry.get(spec.name)?.name === spec.name) continue;
    registry.registerStandIn(spec);
  }
  return registry;
}
